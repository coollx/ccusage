import type { CommandContext } from './sync-strategies/base.ts';
import { Result } from '@praha/byethrow';
import { logger } from '../logger.ts';
import { loadSyncSettings } from './config-manager.ts';
import { getFirebaseClient } from './firebase-client.ts';
import { getEnhancedSyncEngine } from './sync-engine-v2.ts';

/**
 * Command execution wrapper that handles sync lifecycle
 * Ensures sync happens at start, periodically, and on exit
 */
export class CommandExecutor {
	private syncEngine = getEnhancedSyncEngine();
	private firebaseClient = getFirebaseClient();
	private syncEnabled = false;
	private commandContext: CommandContext | null = null;

	/**
	 * Execute a command with sync lifecycle management
	 */
	async execute<T>(
		commandName: string,
		options: Record<string, any>,
		commandFn: () => Promise<T>,
	): Promise<T> {
		// Check if sync is enabled
		const syncSettings = await loadSyncSettings();
		this.syncEnabled = Result.isSuccess(syncSettings) && syncSettings.value.enabled;

		if (!this.syncEnabled) {
			// If sync is not enabled, just run the command
			return commandFn();
		}

		// Initialize sync components
		const initResult = await this.initializeSync();
		if (Result.isFailure(initResult)) {
			logger.warn('Failed to initialize sync:', initResult.error.message);
			// Continue without sync
			return commandFn();
		}

		// Create command context
		this.commandContext = {
			command: commandName,
			options,
			userId: this.firebaseClient.getUserId().value!,
			deviceId: syncSettings.value.deviceId!,
			deviceName: syncSettings.value.deviceName!,
		};

		try {
			// Step 1: Sync on start
			logger.debug('Performing sync on command start');
			await this.performSync('start');

			// Step 2: Start unified sync engine for the command
			const unifiedEngine = this.firebaseClient.getUnifiedSyncEngine();
			if (unifiedEngine) {
				const syncResult = await unifiedEngine.syncForCommand(this.commandContext);
				if (Result.isFailure(syncResult)) {
					logger.warn('Failed to start unified sync:', syncResult.error.message);
				}
			}

			// Step 3: Run the actual command
			const result = await commandFn();

			// Step 4: Final sync on exit
			logger.debug('Performing sync on command exit');
			await this.performSync('exit');

			return result;
		}
		finally {
			// Always stop unified sync engine
			const unifiedEngine = this.firebaseClient.getUnifiedSyncEngine();
			if (unifiedEngine) {
				await unifiedEngine.stop();
			}
		}
	}

	/**
	 * Execute a long-running command with periodic sync
	 */
	async executeLongRunning<T>(
		commandName: string,
		options: Record<string, any>,
		commandFn: (syncIndicator: () => void) => Promise<T>,
	): Promise<T> {
		// Check if sync is enabled
		const syncSettings = await loadSyncSettings();
		this.syncEnabled = Result.isSuccess(syncSettings) && syncSettings.value.enabled;

		if (!this.syncEnabled) {
			// If sync is not enabled, just run the command
			return commandFn(() => {});
		}

		// Initialize sync components
		const initResult = await this.initializeSync();
		if (Result.isFailure(initResult)) {
			logger.warn('Failed to initialize sync:', initResult.error.message);
			// Continue without sync
			return commandFn(() => {});
		}

		// Create command context
		this.commandContext = {
			command: commandName,
			options,
			userId: this.firebaseClient.getUserId().value!,
			deviceId: syncSettings.value.deviceId!,
			deviceName: syncSettings.value.deviceName!,
		};

		let syncInterval: NodeJS.Timeout | null = null;
		let isSyncing = false;

		// Sync indicator function
		const syncIndicator = () => {
			if (isSyncing) {
				process.stdout.write(' ↑');
			}
		};

		try {
			// Step 1: Sync on start
			logger.debug('Performing sync on command start');
			await this.performSync('start');

			// Step 2: Start unified sync engine for the command
			const unifiedEngine = this.firebaseClient.getUnifiedSyncEngine();
			if (unifiedEngine) {
				const syncResult = await unifiedEngine.syncForCommand(this.commandContext);
				if (Result.isFailure(syncResult)) {
					logger.warn('Failed to start unified sync:', syncResult.error.message);
				}
			}

			// Step 3: Set up periodic sync for long-running commands
			if (options.live || options.watch) {
				syncInterval = setInterval(async () => {
					isSyncing = true;
					await this.performSync('periodic');
					isSyncing = false;
				}, 30000); // 30 seconds
			}

			// Step 4: Run the actual command
			const result = await commandFn(syncIndicator);

			// Step 5: Final sync on exit
			logger.debug('Performing sync on command exit');
			await this.performSync('exit');

			return result;
		}
		finally {
			// Clean up
			if (syncInterval) {
				clearInterval(syncInterval);
			}

			// Always stop unified sync engine
			const unifiedEngine = this.firebaseClient.getUnifiedSyncEngine();
			if (unifiedEngine) {
				await unifiedEngine.stop();
			}
		}
	}

	/**
	 * Initialize sync components
	 */
	private async initializeSync(): Promise<Result<void, Error>> {
		// Initialize Firebase client
		const firebaseInit = await this.firebaseClient.initialize();
		if (Result.isFailure(firebaseInit)) {
			return firebaseInit;
		}

		// Set sync engine on firebase client
		this.firebaseClient.setSyncEngine(this.syncEngine);

		// Initialize sync engine
		const syncEngineInit = await this.syncEngine.initialize();
		if (Result.isFailure(syncEngineInit)) {
			return syncEngineInit;
		}

		return Result.succeed(undefined);
	}

	/**
	 * Perform sync operation
	 */
	private async performSync(phase: 'start' | 'periodic' | 'exit'): Promise<void> {
		try {
			const result = await this.syncEngine.syncNewData();

			if (result.success) {
				if (result.offline) {
					logger.info(`Offline sync completed (${phase}): ${result.recordsSynced} operations queued`);
				}
				else {
					logger.debug(`Sync completed (${phase}): ${result.recordsSynced} records synced`);
				}
			}
			else {
				logger.warn(`Sync failed (${phase}):`, result.error);
			}
		}
		catch (error) {
			logger.error(`Sync error (${phase}):`, error);
		}
	}
}

// Singleton instance
let commandExecutor: CommandExecutor | null = null;

/**
 * Get the command executor instance
 */
export function getCommandExecutor(): CommandExecutor {
	if (!commandExecutor) {
		commandExecutor = new CommandExecutor();
	}
	return commandExecutor;
}

// In-source tests
if (import.meta.vitest != null) {
	const { describe, it, expect, vi, beforeEach } = import.meta.vitest;

	describe('CommandExecutor', () => {
		let executor: CommandExecutor;

		beforeEach(() => {
			commandExecutor = null;
			executor = getCommandExecutor();
		});

		it('should execute command without sync when disabled', async () => {
			const commandFn = vi.fn().mockResolvedValue('result');

			const result = await executor.execute('test', {}, commandFn);

			expect(result).toBe('result');
			expect(commandFn).toHaveBeenCalledOnce();
		});

		it('should handle long-running commands', async () => {
			const commandFn = vi.fn().mockImplementation(async (syncIndicator) => {
				syncIndicator();
				return 'long-result';
			});

			const result = await executor.executeLongRunning('blocks', { live: true }, commandFn);

			expect(result).toBe('long-result');
			expect(commandFn).toHaveBeenCalledOnce();
		});

		it('should provide sync indicator function', async () => {
			let indicatorCalled = false;
			const commandFn = async (syncIndicator: () => void) => {
				syncIndicator();
				indicatorCalled = true;
				return 'result';
			};

			await executor.executeLongRunning('test', {}, commandFn);

			expect(indicatorCalled).toBe(true);
		});
	});
}
