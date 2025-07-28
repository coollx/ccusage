import type { SyncResult } from '../_types.ts';
import type { CommandContext } from './base.ts';
import { Result } from '@praha/byethrow';
import { logger } from '../../logger.ts';
import { BaseSyncStrategy } from './base.ts';

/**
 * Realtime sync strategy using WebSocket connections
 * Used for live monitoring commands
 */
export class RealtimeSync extends BaseSyncStrategy {
	readonly name = 'realtime' as const;
	private listeners: Map<string, any> = new Map();
	private syncInterval: NodeJS.Timeout | null = null;

	async start(): Promise<Result<SyncResult, Error>> {
		const initResult = this.validateInitialized();
		if (Result.isFailure(initResult)) {
			return Result.fail(initResult.error);
		}

		const { firebase, context } = initResult.value;

		try {
			this.active = true;

			// Set up realtime listeners for active blocks
			if (context.command === 'blocks' && context.options.live) {
				const activeBlocksPath = `users/${context.userId}/activeBlocks`;

				// Subscribe to active blocks updates
				const listener = await firebase.subscribeToRealtimeUpdates(
					activeBlocksPath,
					(data) => {
						// Handle realtime updates
						logger.debug('Received realtime update for active blocks');
					},
				);

				if (Result.isFailure(listener)) {
					return Result.fail(listener.error);
				}

				this.listeners.set(activeBlocksPath, listener.value);
			}

			// Set up periodic sync every 30 seconds for current device data
			this.syncInterval = setInterval(async () => {
				await this.syncCurrentDeviceData();
			}, 30000);

			// Initial sync
			const syncResult = await this.syncCurrentDeviceData();

			return Result.succeed({
				success: true,
				recordsSynced: syncResult.recordsSynced || 0,
				duration: syncResult.duration,
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

			// Unsubscribe from all listeners
			for (const [path, unsubscribe] of this.listeners) {
				if (typeof unsubscribe === 'function') {
					unsubscribe();
				}
				logger.debug(`Unsubscribed from realtime updates at ${path}`);
			}
			this.listeners.clear();

			// Final sync before stopping
			await this.syncCurrentDeviceData();

			return Result.succeed(undefined);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	async forceSync(): Promise<Result<SyncResult, Error>> {
		return this.syncCurrentDeviceData();
	}

	private async syncCurrentDeviceData(): Promise<SyncResult> {
		const initResult = this.validateInitialized();
		if (Result.isFailure(initResult)) {
			return {
				success: false,
				error: initResult.error.message,
			};
		}

		const { firebase, context } = initResult.value;

		try {
			logger.debug('Syncing current device data in realtime mode');

			// Get sync engine from firebase client
			const syncEngine = firebase.getSyncEngine();
			if (!syncEngine) {
				return {
					success: false,
					error: 'Sync engine not available',
				};
			}

			// Sync new data from current device
			const result = await syncEngine.syncNewData();

			if (Result.isFailure(result)) {
				return {
					success: false,
					error: result.error.message,
				};
			}

			return {
				success: true,
				recordsSynced: result.value.recordsSynced,
				duration: result.value.duration,
			};
		}
		catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}
}

// In-source tests
if (import.meta.vitest != null) {
	const { describe, it, expect, vi, beforeEach } = import.meta.vitest;

	describe('RealtimeSync', () => {
		let strategy: RealtimeSync;
		let mockFirebase: any;
		let mockContext: CommandContext;

		beforeEach(() => {
			strategy = new RealtimeSync();
			mockFirebase = {
				subscribeToRealtimeUpdates: vi.fn(),
				getSyncEngine: vi.fn(),
			};
			mockContext = {
				command: 'blocks',
				options: { live: true },
				userId: 'test-user',
				deviceId: 'test-device',
				deviceName: 'Test Device',
			};
		});

		it('should have realtime as name', () => {
			expect(strategy.name).toBe('realtime');
		});

		it('should initialize successfully', async () => {
			const result = await strategy.initialize(mockFirebase, mockContext);
			expect(Result.isSuccess(result)).toBe(true);
		});

		it('should fail to start without initialization', async () => {
			const result = await strategy.start();
			expect(Result.isFailure(result)).toBe(true);
			expect(result.error.message).toBe('Strategy not initialized');
		});

		it('should set up realtime listeners for blocks --live', async () => {
			await strategy.initialize(mockFirebase, mockContext);

			mockFirebase.subscribeToRealtimeUpdates.mockResolvedValue(
				Result.succeed(() => {}),
			);
			mockFirebase.getSyncEngine.mockReturnValue({
				syncNewData: vi.fn().mockResolvedValue(Result.succeed({ recordsSynced: 5, duration: 100 })),
			});

			const result = await strategy.start();

			expect(Result.isSuccess(result)).toBe(true);
			expect(result.value.recordsSynced).toBe(5);
			expect(mockFirebase.subscribeToRealtimeUpdates).toHaveBeenCalledWith(
				'users/test-user/activeBlocks',
				expect.any(Function),
			);
		});

		it('should clean up listeners on stop', async () => {
			await strategy.initialize(mockFirebase, mockContext);

			const unsubscribe = vi.fn();
			mockFirebase.subscribeToRealtimeUpdates.mockResolvedValue(
				Result.succeed(unsubscribe),
			);
			mockFirebase.getSyncEngine.mockReturnValue({
				syncNewData: vi.fn().mockResolvedValue(Result.succeed({ recordsSynced: 5, duration: 100 })),
			});

			await strategy.start();
			const stopResult = await strategy.stop();

			expect(Result.isSuccess(stopResult)).toBe(true);
			expect(unsubscribe).toHaveBeenCalled();
			expect(strategy.isActive()).toBe(false);
		});
	});
}
