import type { Database, DatabaseReference } from 'firebase/database';
import { Result } from '@praha/byethrow';
import { logger } from '../logger.ts';

/**
 * Manages WebSocket connections for realtime updates
 * Ensures single connection per path and proper cleanup
 */
export class RealtimeManager {
	private connections: Map<string, DatabaseReference> = new Map();
	private listeners: Map<string, () => void> = new Map();
	private database: Database | null = null;

	/**
	 * Initialize with Firebase database instance
	 */
	initialize(database: Database): void {
		this.database = database;
	}

	/**
	 * Subscribe to realtime updates at a specific path
	 */
	async subscribe(
		path: string,
		callback: (data: any) => void,
	): Promise<Result<() => void, Error>> {
		if (!this.database) {
			return Result.fail(new Error('Realtime manager not initialized'));
		}

		try {
			// Check if we already have a connection to this path
			if (this.connections.has(path)) {
				logger.debug(`Reusing existing connection for ${path}`);
				const ref = this.connections.get(path)!;

				// Add new listener
				ref.on('value', callback);

				// Return unsubscribe function
				return Result.succeed(() => {
					ref.off('value', callback);
				});
			}

			// Create new connection
			logger.debug(`Creating new realtime connection for ${path}`);
			const { ref } = await import('firebase/database');
			const reference = ref(this.database, path);

			// Store the reference
			this.connections.set(path, reference);

			// Set up the listener
			reference.on('value', (snapshot) => {
				callback(snapshot.val());
			}, (error) => {
				logger.error(`Realtime error for ${path}:`, error);
			});

			// Store cleanup function
			const unsubscribe = () => {
				reference.off('value', callback);
				this.checkAndCleanupConnection(path);
			};

			this.listeners.set(`${path}:${callback.toString()}`, unsubscribe);

			return Result.succeed(unsubscribe);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Unsubscribe from all listeners at a path
	 */
	unsubscribeAll(path: string): void {
		const ref = this.connections.get(path);
		if (ref) {
			ref.off(); // Remove all listeners
			this.connections.delete(path);

			// Clean up related listeners
			for (const [key, unsubscribe] of this.listeners.entries()) {
				if (key.startsWith(`${path}:`)) {
					this.listeners.delete(key);
				}
			}

			logger.debug(`Unsubscribed from all listeners at ${path}`);
		}
	}

	/**
	 * Update data at a specific path
	 */
	async update(path: string, data: any): Promise<Result<void, Error>> {
		if (!this.database) {
			return Result.fail(new Error('Realtime manager not initialized'));
		}

		try {
			const { ref, set } = await import('firebase/database');
			const reference = ref(this.database, path);
			await set(reference, data);

			logger.debug(`Updated realtime data at ${path}`);
			return Result.succeed(undefined);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Push data to a list at a specific path
	 */
	async push(path: string, data: any): Promise<Result<string, Error>> {
		if (!this.database) {
			return Result.fail(new Error('Realtime manager not initialized'));
		}

		try {
			const { ref, push } = await import('firebase/database');
			const reference = ref(this.database, path);
			const newRef = await push(reference, data);

			if (!newRef.key) {
				return Result.fail(new Error('Failed to get push key'));
			}

			logger.debug(`Pushed data to ${path}, key: ${newRef.key}`);
			return Result.succeed(newRef.key);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Disconnect all connections and clean up
	 */
	async disconnect(): Promise<void> {
		logger.debug('Disconnecting all realtime connections');

		// Unsubscribe from all paths
		for (const path of this.connections.keys()) {
			this.unsubscribeAll(path);
		}

		// Clear all maps
		this.connections.clear();
		this.listeners.clear();

		// Go offline
		if (this.database) {
			const { goOffline } = await import('firebase/database');
			goOffline(this.database);
		}

		this.database = null;
	}

	/**
	 * Get the number of active connections
	 */
	getConnectionCount(): number {
		return this.connections.size;
	}

	/**
	 * Check if a path has active listeners
	 */
	hasActiveListeners(path: string): boolean {
		return this.connections.has(path);
	}

	/**
	 * Check and cleanup connection if no more listeners
	 */
	private checkAndCleanupConnection(path: string): void {
		const ref = this.connections.get(path);
		if (ref) {
			// Check if there are any remaining listeners
			let hasListeners = false;
			for (const key of this.listeners.keys()) {
				if (key.startsWith(`${path}:`)) {
					hasListeners = true;
					break;
				}
			}

			if (!hasListeners) {
				logger.debug(`No more listeners for ${path}, cleaning up connection`);
				this.connections.delete(path);
			}
		}
	}
}

// In-source tests
if (import.meta.vitest != null) {
	const { describe, it, expect, vi, beforeEach } = import.meta.vitest;
	const { Result } = await import('@praha/byethrow');

	describe('RealtimeManager', () => {
		let manager: RealtimeManager;
		let mockDatabase: any;
		let mockRef: any;

		beforeEach(() => {
			manager = new RealtimeManager();
			mockRef = {
				on: vi.fn(),
				off: vi.fn(),
			};
			mockDatabase = {};

			// Mock firebase imports
			vi.doMock('firebase/database', () => ({
				ref: vi.fn(() => mockRef),
				set: vi.fn(),
				push: vi.fn(() => ({ key: 'test-key' })),
				goOffline: vi.fn(),
			}));
		});

		it('should initialize with database', () => {
			manager.initialize(mockDatabase);
			expect(manager.getConnectionCount()).toBe(0);
		});

		it('should fail to subscribe without initialization', async () => {
			const result = await manager.subscribe('test/path', () => {});
			expect(Result.isFailure(result)).toBe(true);
			expect(result.error.message).toBe('Realtime manager not initialized');
		});

		it('should create new connection on first subscribe', async () => {
			manager.initialize(mockDatabase);

			const callback = vi.fn();
			const result = await manager.subscribe('test/path', callback);

			expect(Result.isSuccess(result)).toBe(true);
			expect(mockRef.on).toHaveBeenCalledWith('value', expect.any(Function), expect.any(Function));
			expect(manager.hasActiveListeners('test/path')).toBe(true);
			expect(manager.getConnectionCount()).toBe(1);
		});

		it('should reuse existing connection for same path', async () => {
			manager.initialize(mockDatabase);

			const callback1 = vi.fn();
			const callback2 = vi.fn();

			await manager.subscribe('test/path', callback1);
			await manager.subscribe('test/path', callback2);

			expect(manager.getConnectionCount()).toBe(1); // Still only one connection
			expect(mockRef.on).toHaveBeenCalledTimes(2); // But two listeners
		});

		it('should unsubscribe specific callback', async () => {
			manager.initialize(mockDatabase);

			const callback = vi.fn();
			const result = await manager.subscribe('test/path', callback);

			expect(Result.isSuccess(result)).toBe(true);
			const unsubscribe = result.value;

			unsubscribe();
			expect(mockRef.off).toHaveBeenCalledWith('value', callback);
		});

		it('should unsubscribe all listeners at path', async () => {
			manager.initialize(mockDatabase);

			const callback1 = vi.fn();
			const callback2 = vi.fn();

			await manager.subscribe('test/path', callback1);
			await manager.subscribe('test/path', callback2);

			manager.unsubscribeAll('test/path');

			expect(mockRef.off).toHaveBeenCalled();
			expect(manager.hasActiveListeners('test/path')).toBe(false);
			expect(manager.getConnectionCount()).toBe(0);
		});

		it('should update data at path', async () => {
			manager.initialize(mockDatabase);

			const testData = { value: 123 };
			const result = await manager.update('test/path', testData);

			expect(Result.isSuccess(result)).toBe(true);
		});

		it('should push data to path', async () => {
			manager.initialize(mockDatabase);

			const testData = { value: 456 };
			const result = await manager.push('test/list', testData);

			expect(Result.isSuccess(result)).toBe(true);
			expect(result.value).toBe('test-key');
		});

		it('should disconnect all connections', async () => {
			manager.initialize(mockDatabase);

			await manager.subscribe('test/path1', vi.fn());
			await manager.subscribe('test/path2', vi.fn());

			expect(manager.getConnectionCount()).toBe(2);

			await manager.disconnect();

			expect(manager.getConnectionCount()).toBe(0);
		});
	});
}
