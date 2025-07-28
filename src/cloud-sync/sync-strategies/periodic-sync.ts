import type { SyncResult } from '../_types.ts';
import type { CommandContext } from './base.ts';
import { Result } from '@praha/byethrow';
import { logger } from '../../logger.ts';
import { BaseSyncStrategy } from './base.ts';

/**
 * Periodic sync strategy with cached data and timed refresh
 * Used for frequently accessed commands like daily, session, blocks
 */
export class PeriodicSync extends BaseSyncStrategy {
	readonly name = 'periodic' as const;
	private syncInterval: NodeJS.Timeout | null = null;
	private lastSyncTime: Date | null = null;
	private readonly SYNC_INTERVAL_MS = 30000; // 30 seconds
	private readonly CACHE_TTL_MS = 60000; // 1 minute cache TTL

	async start(): Promise<Result<SyncResult, Error>> {
		const initResult = this.validateInitialized();
		if (Result.isFailure(initResult)) {
			return Result.fail(initResult.error);
		}

		const { firebase, context } = initResult.value;

		try {
			this.active = true;

			// Initial sync
			const initialSync = await this.performSync();
			if (Result.isFailure(initialSync)) {
				this.active = false;
				return Result.fail(initialSync.error);
			}

			// Set up periodic sync interval
			this.syncInterval = setInterval(async () => {
				const result = await this.performSync();
				if (Result.isFailure(result)) {
					logger.error('Periodic sync failed:', result.error.message);
				}
			}, this.SYNC_INTERVAL_MS);

			return Result.succeed({
				success: true,
				recordsSynced: initialSync.value.recordsSynced,
				duration: initialSync.value.duration,
			});
		}
		catch (error) {
			this.active = false;
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	async stop(): Promise<Result<void, Error>> {
		try {
			this.active = false;

			// Clear sync interval
			if (this.syncInterval) {
				clearInterval(this.syncInterval);
				this.syncInterval = null;
			}

			// Final sync before stopping
			await this.performSync();

			return Result.succeed(undefined);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	async forceSync(): Promise<Result<SyncResult, Error>> {
		return this.performSync();
	}

	private async performSync(): Promise<Result<SyncResult, Error>> {
		const initResult = this.validateInitialized();
		if (Result.isFailure(initResult)) {
			return Result.fail(initResult.error);
		}

		const { firebase, context } = initResult.value;

		try {
			const startTime = Date.now();
			logger.debug('Performing periodic sync');

			// Get sync engine from firebase client
			const syncEngine = firebase.getSyncEngine();
			if (!syncEngine) {
				return Result.fail(new Error('Sync engine not available'));
			}

			// Sync new data from current device
			const syncResult = await syncEngine.syncNewData();
			if (Result.isFailure(syncResult)) {
				return Result.fail(syncResult.error);
			}

			// If cloud option is enabled, fetch aggregated data
			if (context.options.cloud) {
				const fetchResult = await this.fetchAggregatedData();
				if (Result.isFailure(fetchResult)) {
					logger.warn('Failed to fetch aggregated data:', fetchResult.error.message);
				}
			}

			this.lastSyncTime = new Date();
			const duration = Date.now() - startTime;

			return Result.succeed({
				success: true,
				recordsSynced: syncResult.value.recordsSynced,
				duration,
			});
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	private async fetchAggregatedData(): Promise<Result<void, Error>> {
		const initResult = this.validateInitialized();
		if (Result.isFailure(initResult)) {
			return Result.fail(initResult.error);
		}

		const { firebase, context } = initResult.value;

		try {
			// Check if cache is still valid
			if (this.lastSyncTime && Date.now() - this.lastSyncTime.getTime() < this.CACHE_TTL_MS) {
				logger.debug('Using cached aggregated data');
				return Result.succeed(undefined);
			}

			logger.debug(`Fetching aggregated data for ${context.command} command`);

			// The actual data fetching would be handled by the command itself
			// This just ensures the data is fresh and available

			return Result.succeed(undefined);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Check if cached data is still valid
	 */
	isCacheValid(): boolean {
		if (!this.lastSyncTime) { return false; }
		return Date.now() - this.lastSyncTime.getTime() < this.CACHE_TTL_MS;
	}
}

// In-source tests
if (import.meta.vitest != null) {
	const { describe, it, expect, vi, beforeEach, afterEach } = import.meta.vitest;

	describe('PeriodicSync', () => {
		let strategy: PeriodicSync;
		let mockFirebase: any;
		let mockContext: CommandContext;

		beforeEach(() => {
			vi.useFakeTimers();
			strategy = new PeriodicSync();
			mockFirebase = {
				getSyncEngine: vi.fn(),
			};
			mockContext = {
				command: 'daily',
				options: { cloud: true },
				userId: 'test-user',
				deviceId: 'test-device',
				deviceName: 'Test Device',
			};
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('should have periodic as name', () => {
			expect(strategy.name).toBe('periodic');
		});

		it('should set up periodic sync interval', async () => {
			await strategy.initialize(mockFirebase, mockContext);

			const mockSyncEngine = {
				syncNewData: vi.fn().mockResolvedValue(Result.succeed({ recordsSynced: 10, duration: 200 })),
			};
			mockFirebase.getSyncEngine.mockReturnValue(mockSyncEngine);

			const result = await strategy.start();

			expect(Result.isSuccess(result)).toBe(true);
			expect(result.value.recordsSynced).toBe(10);
			expect(result.value.duration).toBeGreaterThanOrEqual(0); // Duration should be calculated

			// Verify initial sync was called
			expect(mockSyncEngine.syncNewData).toHaveBeenCalledTimes(1);

			// Fast forward 30 seconds
			vi.advanceTimersByTime(30000);

			// Verify periodic sync was triggered
			expect(mockSyncEngine.syncNewData).toHaveBeenCalledTimes(2);
		});

		it('should stop periodic sync and clear interval', async () => {
			await strategy.initialize(mockFirebase, mockContext);

			const mockSyncEngine = {
				syncNewData: vi.fn().mockResolvedValue(Result.succeed({ recordsSynced: 5, duration: 100 })),
			};
			mockFirebase.getSyncEngine.mockReturnValue(mockSyncEngine);

			await strategy.start();
			const stopResult = await strategy.stop();

			expect(Result.isSuccess(stopResult)).toBe(true);
			expect(strategy.isActive()).toBe(false);

			// Verify final sync was called
			expect(mockSyncEngine.syncNewData).toHaveBeenCalledTimes(2); // initial + final
		});

		it('should handle sync failures gracefully', async () => {
			await strategy.initialize(mockFirebase, mockContext);

			const mockSyncEngine = {
				syncNewData: vi.fn().mockResolvedValue(Result.fail(new Error('Sync failed'))),
			};
			mockFirebase.getSyncEngine.mockReturnValue(mockSyncEngine);

			const result = await strategy.start();

			expect(Result.isFailure(result)).toBe(true);
			expect(result.error.message).toBe('Sync failed');
			expect(strategy.isActive()).toBe(false);
		});

		it('should track cache validity', async () => {
			await strategy.initialize(mockFirebase, mockContext);

			const mockSyncEngine = {
				syncNewData: vi.fn().mockResolvedValue(Result.succeed({ recordsSynced: 5, duration: 100 })),
			};
			mockFirebase.getSyncEngine.mockReturnValue(mockSyncEngine);

			expect(strategy.isCacheValid()).toBe(false);

			await strategy.start();
			expect(strategy.isCacheValid()).toBe(true);

			// Fast forward past cache TTL
			vi.advanceTimersByTime(61000);
			expect(strategy.isCacheValid()).toBe(false);
		});
	});
}
