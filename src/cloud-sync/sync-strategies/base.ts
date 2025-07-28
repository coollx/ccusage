import type { SyncResult } from '../_types.ts';
import type { FirebaseClient } from '../firebase-client.ts';
import { Result } from '@praha/byethrow';

/**
 * Command execution context
 */
export type CommandContext = {
	command: string;
	options: {
		cloud?: boolean;
		live?: boolean;
		watch?: boolean;
		[key: string]: unknown;
	};
	userId: string;
	deviceId: string;
	deviceName: string;
};

/**
 * Sync strategy interface
 */
export type SyncStrategy = {
	/**
	 * Strategy name for identification
	 */
	readonly name: 'realtime' | 'periodic' | 'onetime';

	/**
	 * Initialize the sync strategy
	 */
	initialize: (firebase: FirebaseClient, context: CommandContext) => Promise<Result<void, Error>>;

	/**
	 * Start syncing
	 */
	start: () => Promise<Result<SyncResult, Error>>;

	/**
	 * Stop syncing and cleanup
	 */
	stop: () => Promise<Result<void, Error>>;

	/**
	 * Force a sync operation
	 */
	forceSync: () => Promise<Result<SyncResult, Error>>;

	/**
	 * Check if strategy is active
	 */
	isActive: () => boolean;
};

/**
 * Base sync strategy with common functionality
 */
export abstract class BaseSyncStrategy implements SyncStrategy {
	protected firebase: FirebaseClient | null = null;
	protected context: CommandContext | null = null;
	protected active = false;

	abstract readonly name: 'realtime' | 'periodic' | 'onetime';

	async initialize(firebase: FirebaseClient, context: CommandContext): Promise<Result<void, Error>> {
		this.firebase = firebase;
		this.context = context;
		return Result.succeed(undefined);
	}

	abstract start(): Promise<Result<SyncResult, Error>>;
	abstract stop(): Promise<Result<void, Error>>;
	abstract forceSync(): Promise<Result<SyncResult, Error>>;

	isActive(): boolean {
		return this.active;
	}

	protected validateInitialized(): Result<{ firebase: FirebaseClient; context: CommandContext }, Error> {
		if (!this.firebase || !this.context) {
			return Result.fail(new Error('Strategy not initialized'));
		}
		return Result.succeed({ firebase: this.firebase, context: this.context });
	}
}
