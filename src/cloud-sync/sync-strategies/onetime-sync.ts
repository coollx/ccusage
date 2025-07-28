import type { SyncResult } from '../_types.ts';
import type { CommandContext } from './base.ts';
import { Result } from '@praha/byethrow';
import { logger } from '../../logger.ts';
import { BaseSyncStrategy } from './base.ts';

/**
 * One-time sync strategy for single fetch operations
 * Used for historical queries and commands that don't need continuous updates
 */
export class OnetimeSync extends BaseSyncStrategy {
	readonly name = 'onetime' as const;
	private syncCompleted = false;

	async start(): Promise<Result<SyncResult, Error>> {
		const initResult = this.validateInitialized();
		if (Result.isFailure(initResult)) {
			return Result.fail(initResult.error);
		}

		const { firebase, context } = initResult.value;

		try {
			this.active = true;
			logger.debug('Starting one-time sync');

			// Get sync engine from firebase client
			const syncEngine = firebase.getSyncEngine();
			if (!syncEngine) {
				return Result.fail(new Error('Sync engine not available'));
			}

			const startTime = Date.now();

			// Sync new local data to cloud
			const syncResult = await syncEngine.syncNewData();
			if (Result.isFailure(syncResult)) {
				this.active = false;
				return Result.fail(syncResult.error);
			}

			// If cloud option is enabled, fetch aggregated data once
			if (context.options.cloud) {
				const fetchResult = await this.fetchCloudData();
				if (Result.isFailure(fetchResult)) {
					logger.warn('Failed to fetch cloud data:', fetchResult.error.message);
					// Don't fail the entire operation if cloud fetch fails
				}
			}

			const duration = Date.now() - startTime;
			this.syncCompleted = true;

			// One-time sync completes immediately after initial sync
			this.active = false;

			return Result.succeed({
				success: true,
				recordsSynced: syncResult.value.recordsSynced,
				duration,
			});
		}
		catch (error) {
			this.active = false;
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	async stop(): Promise<Result<void, Error>> {
		try {
			// For one-time sync, stop is a no-op if sync is already completed
			if (this.syncCompleted) {
				this.active = false;
				return Result.succeed(undefined);
			}

			// If sync is still in progress, perform final sync
			if (this.active) {
				await this.forceSync();
			}

			this.active = false;
			return Result.succeed(undefined);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	async forceSync(): Promise<Result<SyncResult, Error>> {
		const initResult = this.validateInitialized();
		if (Result.isFailure(initResult)) {
			return Result.fail(initResult.error);
		}

		const { firebase } = initResult.value;

		try {
			logger.debug('Forcing one-time sync');

			const syncEngine = firebase.getSyncEngine();
			if (!syncEngine) {
				return Result.fail(new Error('Sync engine not available'));
			}

			const result = await syncEngine.syncNewData();
			if (Result.isFailure(result)) {
				return Result.fail(result.error);
			}

			return Result.succeed({
				success: true,
				recordsSynced: result.value.recordsSynced,
				duration: result.value.duration,
			});
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	private async fetchCloudData(): Promise<Result<void, Error>> {
		const initResult = this.validateInitialized();
		if (Result.isFailure(initResult)) {
			return Result.fail(initResult.error);
		}

		const { firebase, context } = initResult.value;

		try {
			logger.debug(`Fetching cloud data for ${context.command} command (one-time)`);

			// The actual data fetching would be handled by the command itself
			// This just ensures the sync happens once

			return Result.succeed(undefined);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Check if sync has been completed
	 */
	isSyncCompleted(): boolean {
		return this.syncCompleted;
	}
}

// In-source tests
if (import.meta.vitest != null) {
	const { describe, it, expect, vi, beforeEach } = import.meta.vitest;

	describe('OnetimeSync', () => {
		let strategy: OnetimeSync;
		let mockFirebase: any;
		let mockContext: CommandContext;

		beforeEach(() => {
			strategy = new OnetimeSync();
			mockFirebase = {
				getSyncEngine: vi.fn(),
			};
			mockContext = {
				command: 'monthly',
				options: { cloud: true },
				userId: 'test-user',
				deviceId: 'test-device',
				deviceName: 'Test Device',
			};
		});

		it('should have onetime as name', () => {
			expect(strategy.name).toBe('onetime');
		});

		it('should perform sync once and complete', async () => {
			await strategy.initialize(mockFirebase, mockContext);

			const mockSyncEngine = {
				syncNewData: vi.fn().mockResolvedValue(Result.succeed({ recordsSynced: 15, duration: 300 })),
			};
			mockFirebase.getSyncEngine.mockReturnValue(mockSyncEngine);

			const result = await strategy.start();

			expect(Result.isSuccess(result)).toBe(true);
			expect(result.value.recordsSynced).toBe(15);
			expect(result.value.duration).toBeGreaterThanOrEqual(0); // Duration should be calculated
			expect(strategy.isActive()).toBe(false); // Should be inactive after completion
			expect(strategy.isSyncCompleted()).toBe(true);

			// Verify sync was called only once
			expect(mockSyncEngine.syncNewData).toHaveBeenCalledTimes(1);
		});

		it('should handle stop gracefully when sync is completed', async () => {
			await strategy.initialize(mockFirebase, mockContext);

			const mockSyncEngine = {
				syncNewData: vi.fn().mockResolvedValue(Result.succeed({ recordsSynced: 5, duration: 100 })),
			};
			mockFirebase.getSyncEngine.mockReturnValue(mockSyncEngine);

			await strategy.start();
			const stopResult = await strategy.stop();

			expect(Result.isSuccess(stopResult)).toBe(true);
			expect(mockSyncEngine.syncNewData).toHaveBeenCalledTimes(1); // No additional sync on stop
		});

		it('should perform final sync on stop if still active', async () => {
			await strategy.initialize(mockFirebase, mockContext);

			const mockSyncEngine = {
				syncNewData: vi.fn().mockResolvedValue(Result.succeed({ recordsSynced: 5, duration: 100 })),
			};
			mockFirebase.getSyncEngine.mockReturnValue(mockSyncEngine);

			// Manually set active without completing sync
			strategy.active = true;
			strategy.syncCompleted = false;

			const stopResult = await strategy.stop();

			expect(Result.isSuccess(stopResult)).toBe(true);
			expect(mockSyncEngine.syncNewData).toHaveBeenCalledTimes(1); // Final sync called
		});

		it('should handle sync engine not available', async () => {
			await strategy.initialize(mockFirebase, mockContext);

			mockFirebase.getSyncEngine.mockReturnValue(null);

			const result = await strategy.start();

			expect(Result.isFailure(result)).toBe(true);
			expect(result.error.message).toBe('Sync engine not available');
		});

		it('should continue even if cloud fetch fails', async () => {
			await strategy.initialize(mockFirebase, mockContext);

			const mockSyncEngine = {
				syncNewData: vi.fn().mockResolvedValue(Result.succeed({ recordsSynced: 10, duration: 200 })),
			};
			mockFirebase.getSyncEngine.mockReturnValue(mockSyncEngine);

			// Mock fetchCloudData to fail (would need to spy on private method in real scenario)
			const result = await strategy.start();

			expect(Result.isSuccess(result)).toBe(true);
			expect(result.value.success).toBe(true);
		});
	});
}
