import type { SyncResult, SyncStatus } from './_types.ts';
import type { FirebaseClient } from './firebase-client.ts';
import type { CommandContext, SyncStrategy } from './sync-strategies/base.ts';
import { Result } from '@praha/byethrow';
import { logger } from '../logger.ts';
import { OnetimeSync } from './sync-strategies/onetime-sync.ts';
import { PeriodicSync } from './sync-strategies/periodic-sync.ts';
import { RealtimeSync } from './sync-strategies/realtime-sync.ts';

/**
 * Unified sync engine with intelligent sync mode selection
 * Manages sync strategies and WebSocket connections
 */
export class UnifiedSyncEngine {
	private currentStrategy: SyncStrategy | null = null;
	private firebase: FirebaseClient | null = null;
	private syncInProgress = false;

	/**
	 * Initialize the sync engine with Firebase client
	 */
	initialize(firebase: FirebaseClient): Result<void, Error> {
		try {
			this.firebase = firebase;
			return Result.succeed(undefined);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Start syncing for a command with intelligent strategy selection
	 */
	async syncForCommand(context: CommandContext): Promise<Result<SyncResult, Error>> {
		if (!this.firebase) {
			return Result.fail(new Error('Sync engine not initialized'));
		}

		if (this.syncInProgress) {
			return Result.fail(new Error('Sync already in progress'));
		}

		try {
			this.syncInProgress = true;

			// Select the appropriate sync strategy
			const strategy = this.selectStrategy(context);
			logger.debug(`Selected ${strategy.name} sync strategy for ${context.command}`);

			// Initialize the strategy
			const initResult = await strategy.initialize(this.firebase, context);
			if (Result.isFailure(initResult)) {
				this.syncInProgress = false;
				return Result.fail(initResult.error);
			}

			this.currentStrategy = strategy;

			// Start the sync
			const syncResult = await strategy.start();
			if (Result.isFailure(syncResult)) {
				this.syncInProgress = false;
				this.currentStrategy = null;
				return Result.fail(syncResult.error);
			}

			// For one-time sync, we can clear the strategy immediately
			if (strategy.name === 'onetime') {
				this.currentStrategy = null;
				this.syncInProgress = false;
			}

			return Result.succeed(syncResult.value);
		}
		catch (error) {
			this.syncInProgress = false;
			this.currentStrategy = null;
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Stop the current sync operation
	 */
	async stop(): Promise<Result<void, Error>> {
		if (!this.currentStrategy) {
			return Result.succeed(undefined);
		}

		try {
			logger.debug(`Stopping ${this.currentStrategy.name} sync strategy`);
			const result = await this.currentStrategy.stop();

			this.currentStrategy = null;
			this.syncInProgress = false;

			return result;
		}
		catch (error) {
			this.currentStrategy = null;
			this.syncInProgress = false;
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Force a sync operation
	 */
	async forceSync(): Promise<Result<SyncResult, Error>> {
		if (!this.currentStrategy) {
			return Result.fail(new Error('No active sync strategy'));
		}

		try {
			return await this.currentStrategy.forceSync();
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Get current sync status
	 */
	getStatus(): SyncStatus {
		return {
			enabled: this.firebase != null,
			connected: this.currentStrategy?.isActive() ?? false,
			error: undefined,
		};
	}

	/**
	 * Check if sync is currently active
	 */
	isActive(): boolean {
		return this.currentStrategy?.isActive() ?? false;
	}

	/**
	 * Get the current strategy name
	 */
	getCurrentStrategyName(): string | null {
		return this.currentStrategy?.name ?? null;
	}

	/**
	 * Select the appropriate sync strategy based on command and options
	 */
	private selectStrategy(context: CommandContext): SyncStrategy {
		// Real-time for live monitoring commands
		if (context.options.live || context.options.watch) {
			return new RealtimeSync();
		}

		// Periodic for frequently accessed data commands
		if (['daily', 'session', 'blocks'].includes(context.command) && context.options.cloud) {
			return new PeriodicSync();
		}

		// One-time for everything else (historical queries, monthly reports, etc.)
		return new OnetimeSync();
	}
}

// In-source tests
if (import.meta.vitest != null) {
	const { describe, it, expect, vi, beforeEach } = import.meta.vitest;

	// Mock sync strategies
	vi.mock('./sync-strategies/realtime-sync.ts', () => ({
		RealtimeSync: vi.fn().mockImplementation(() => ({
			name: 'realtime',
			initialize: vi.fn().mockResolvedValue(Result.succeed(undefined)),
			start: vi.fn().mockResolvedValue(Result.succeed({ recordsSynced: 0, duration: 0 })),
			stop: vi.fn().mockResolvedValue(Result.succeed(undefined)),
			forceSync: vi.fn().mockResolvedValue(Result.succeed({ recordsSynced: 0, duration: 0 })),
			isActive: vi.fn().mockReturnValue(true),
		})),
	}));

	vi.mock('./sync-strategies/periodic-sync.ts', () => ({
		PeriodicSync: vi.fn().mockImplementation(() => ({
			name: 'periodic',
			initialize: vi.fn().mockResolvedValue(Result.succeed(undefined)),
			start: vi.fn().mockResolvedValue(Result.succeed({ recordsSynced: 0, duration: 0 })),
			stop: vi.fn().mockResolvedValue(Result.succeed(undefined)),
			forceSync: vi.fn().mockResolvedValue(Result.succeed({ recordsSynced: 0, duration: 0 })),
			isActive: vi.fn().mockReturnValue(true),
		})),
	}));

	vi.mock('./sync-strategies/onetime-sync.ts', () => ({
		OnetimeSync: vi.fn().mockImplementation(() => ({
			name: 'onetime',
			initialize: vi.fn().mockResolvedValue(Result.succeed(undefined)),
			start: vi.fn().mockResolvedValue(Result.succeed({ recordsSynced: 0, duration: 0 })),
			stop: vi.fn().mockResolvedValue(Result.succeed(undefined)),
			forceSync: vi.fn().mockResolvedValue(Result.succeed({ recordsSynced: 0, duration: 0 })),
			isActive: vi.fn().mockReturnValue(false),
		})),
	}));

	describe('UnifiedSyncEngine', () => {
		let engine: UnifiedSyncEngine;
		let mockFirebase: any;

		beforeEach(() => {
			engine = new UnifiedSyncEngine();
			mockFirebase = {
				getSyncEngine: vi.fn().mockReturnValue({
					syncNewData: vi.fn().mockResolvedValue(Result.succeed({ recordsSynced: 5, duration: 100 })),
				}),
				subscribeToRealtimeUpdates: vi.fn().mockResolvedValue(Result.succeed(() => {})),
			};
		});

		it('should initialize successfully', () => {
			const result = engine.initialize(mockFirebase);
			expect(Result.isSuccess(result)).toBe(true);
		});

		it('should fail to sync without initialization', async () => {
			const context: CommandContext = {
				command: 'daily',
				options: {},
				userId: 'test-user',
				deviceId: 'test-device',
				deviceName: 'Test Device',
			};

			const result = await engine.syncForCommand(context);
			expect(Result.isFailure(result)).toBe(true);
			expect(result.error.message).toBe('Sync engine not initialized');
		});

		it('should select realtime strategy for live commands', async () => {
			engine.initialize(mockFirebase);

			const context: CommandContext = {
				command: 'blocks',
				options: { live: true },
				userId: 'test-user',
				deviceId: 'test-device',
				deviceName: 'Test Device',
			};

			const result = await engine.syncForCommand(context);
			expect(Result.isSuccess(result)).toBe(true);
			expect(engine.getCurrentStrategyName()).toBe('realtime');
		});

		it('should select periodic strategy for cloud-enabled frequent commands', async () => {
			engine.initialize(mockFirebase);

			const context: CommandContext = {
				command: 'daily',
				options: { cloud: true },
				userId: 'test-user',
				deviceId: 'test-device',
				deviceName: 'Test Device',
			};

			const result = await engine.syncForCommand(context);
			expect(Result.isSuccess(result)).toBe(true);
			expect(engine.getCurrentStrategyName()).toBe('periodic');
		});

		it('should select onetime strategy for other commands', async () => {
			engine.initialize(mockFirebase);

			const context: CommandContext = {
				command: 'monthly',
				options: { cloud: true },
				userId: 'test-user',
				deviceId: 'test-device',
				deviceName: 'Test Device',
			};

			const result = await engine.syncForCommand(context);
			expect(Result.isSuccess(result)).toBe(true);
			expect(engine.getCurrentStrategyName()).toBe(null); // Cleared after onetime sync
		});

		it('should prevent concurrent sync operations', async () => {
			engine.initialize(mockFirebase);

			const context: CommandContext = {
				command: 'blocks',
				options: { live: true },
				userId: 'test-user',
				deviceId: 'test-device',
				deviceName: 'Test Device',
			};

			// Start first sync
			const firstSync = engine.syncForCommand(context);

			// Try to start second sync
			const secondSync = await engine.syncForCommand(context);
			expect(Result.isFailure(secondSync)).toBe(true);
			expect(secondSync.error.message).toBe('Sync already in progress');

			await firstSync; // Wait for first to complete
		});

		it('should stop active sync strategy', async () => {
			engine.initialize(mockFirebase);

			const context: CommandContext = {
				command: 'blocks',
				options: { live: true },
				userId: 'test-user',
				deviceId: 'test-device',
				deviceName: 'Test Device',
			};

			await engine.syncForCommand(context);
			expect(engine.isActive()).toBe(true);

			const stopResult = await engine.stop();
			expect(Result.isSuccess(stopResult)).toBe(true);
			expect(engine.isActive()).toBe(false);
			expect(engine.getCurrentStrategyName()).toBe(null);
		});

		it('should return correct sync status', () => {
			// Before initialization
			let status = engine.getStatus();
			expect(status.enabled).toBe(false);
			expect(status.connected).toBe(false);

			// After initialization
			engine.initialize(mockFirebase);
			status = engine.getStatus();
			expect(status.enabled).toBe(true);
			expect(status.connected).toBe(false);
		});

		it('should handle force sync with active strategy', async () => {
			engine.initialize(mockFirebase);

			const context: CommandContext = {
				command: 'daily',
				options: { cloud: true },
				userId: 'test-user',
				deviceId: 'test-device',
				deviceName: 'Test Device',
			};

			await engine.syncForCommand(context);

			const forceResult = await engine.forceSync();
			expect(Result.isSuccess(forceResult)).toBe(true);
		});

		it('should fail force sync without active strategy', async () => {
			engine.initialize(mockFirebase);

			const forceResult = await engine.forceSync();
			expect(Result.isFailure(forceResult)).toBe(true);
			expect(forceResult.error.message).toBe('No active sync strategy');
		});
	});
}
