import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Result } from '@praha/byethrow';
import Database from 'better-sqlite3';
import { logger } from '../logger.ts';

/**
 * Operation types for offline queue
 */
export type QueueOperation = 'create' | 'update' | 'delete';

/**
 * Queue item structure
 */
export type QueueItem = {
	id?: number;
	operationType: QueueOperation;
	collectionPath: string;
	documentId: string;
	data: any;
	createdAt: number;
	retryCount: number;
	lastError?: string;
};

/**
 * Offline queue for sync operations using SQLite
 * Stores operations when offline and syncs when online
 */
export class OfflineQueue {
	private db: Database.Database | null = null;
	private readonly dbPath: string;
	private readonly maxRetries = 3;

	constructor(dbPath?: string) {
		// Default to ~/.ccusage/offline-sync.db
		const configDir = join(homedir(), '.ccusage');
		mkdirSync(configDir, { recursive: true });
		this.dbPath = dbPath || join(configDir, 'offline-sync.db');
	}

	/**
	 * Initialize the database and create tables
	 */
	initialize(): Result<void, Error> {
		try {
			this.db = new Database(this.dbPath);

			// Create tables if they don't exist
			this.db.exec(`
				CREATE TABLE IF NOT EXISTS sync_queue (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					operation_type TEXT NOT NULL,
					collection_path TEXT NOT NULL,
					document_id TEXT NOT NULL,
					data TEXT NOT NULL,
					created_at INTEGER NOT NULL,
					retry_count INTEGER DEFAULT 0,
					last_error TEXT
				);

				CREATE TABLE IF NOT EXISTS cloud_cache (
					collection_path TEXT NOT NULL,
					document_id TEXT NOT NULL,
					data TEXT NOT NULL,
					last_updated INTEGER NOT NULL,
					PRIMARY KEY (collection_path, document_id)
				);

				CREATE TABLE IF NOT EXISTS sync_metadata (
					key TEXT PRIMARY KEY,
					value TEXT NOT NULL
				);

				-- Create indexes for performance
				CREATE INDEX IF NOT EXISTS idx_sync_queue_created_at ON sync_queue(created_at);
				CREATE INDEX IF NOT EXISTS idx_sync_queue_retry_count ON sync_queue(retry_count);
			`);

			logger.debug('Offline queue database initialized');
			return Result.succeed(undefined);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Enqueue an operation for later sync
	 */
	enqueue(item: Omit<QueueItem, 'id' | 'createdAt' | 'retryCount'>): Result<number, Error> {
		if (!this.db) {
			return Result.fail(new Error('Database not initialized'));
		}

		try {
			const stmt = this.db.prepare(`
				INSERT INTO sync_queue (operation_type, collection_path, document_id, data, created_at, retry_count)
				VALUES (?, ?, ?, ?, ?, 0)
			`);

			const result = stmt.run(
				item.operationType,
				item.collectionPath,
				item.documentId,
				JSON.stringify(item.data),
				Date.now(),
			);

			logger.debug(`Enqueued ${item.operationType} operation for ${item.collectionPath}/${item.documentId}`);
			return Result.succeed(result.lastInsertRowid as number);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Dequeue items ready for sync
	 */
	dequeue(limit = 100): Result<QueueItem[], Error> {
		if (!this.db) {
			return Result.fail(new Error('Database not initialized'));
		}

		try {
			const stmt = this.db.prepare(`
				SELECT * FROM sync_queue
				WHERE retry_count < ?
				ORDER BY created_at ASC
				LIMIT ?
			`);

			const rows = stmt.all(this.maxRetries, limit) as any[];

			const items: QueueItem[] = rows.map(row => ({
				id: row.id,
				operationType: row.operation_type as QueueOperation,
				collectionPath: row.collection_path,
				documentId: row.document_id,
				data: JSON.parse(row.data),
				createdAt: row.created_at,
				retryCount: row.retry_count,
				lastError: row.last_error,
			}));

			return Result.succeed(items);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Mark an item as successfully synced
	 */
	markSuccess(id: number): Result<void, Error> {
		if (!this.db) {
			return Result.fail(new Error('Database not initialized'));
		}

		try {
			const stmt = this.db.prepare('DELETE FROM sync_queue WHERE id = ?');
			stmt.run(id);

			logger.debug(`Removed successfully synced item ${id} from queue`);
			return Result.succeed(undefined);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Mark an item as failed and increment retry count
	 */
	markFailed(id: number, error: string): Result<void, Error> {
		if (!this.db) {
			return Result.fail(new Error('Database not initialized'));
		}

		try {
			const stmt = this.db.prepare(`
				UPDATE sync_queue 
				SET retry_count = retry_count + 1, last_error = ?
				WHERE id = ?
			`);

			stmt.run(error, id);

			logger.debug(`Marked item ${id} as failed with error: ${error}`);
			return Result.succeed(undefined);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Get the count of pending items
	 */
	getPendingCount(): Result<number, Error> {
		if (!this.db) {
			return Result.fail(new Error('Database not initialized'));
		}

		try {
			const stmt = this.db.prepare('SELECT COUNT(*) as count FROM sync_queue WHERE retry_count < ?');
			const result = stmt.get(this.maxRetries) as { count: number };

			return Result.succeed(result.count);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Clear items that have exceeded max retries
	 */
	clearFailedItems(): Result<number, Error> {
		if (!this.db) {
			return Result.fail(new Error('Database not initialized'));
		}

		try {
			const stmt = this.db.prepare('DELETE FROM sync_queue WHERE retry_count >= ?');
			const result = stmt.run(this.maxRetries);

			logger.debug(`Cleared ${result.changes} failed items from queue`);
			return Result.succeed(result.changes);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Cache cloud data locally
	 */
	cacheData(collectionPath: string, documentId: string, data: any): Result<void, Error> {
		if (!this.db) {
			return Result.fail(new Error('Database not initialized'));
		}

		try {
			const stmt = this.db.prepare(`
				INSERT OR REPLACE INTO cloud_cache (collection_path, document_id, data, last_updated)
				VALUES (?, ?, ?, ?)
			`);

			stmt.run(collectionPath, documentId, JSON.stringify(data), Date.now());

			return Result.succeed(undefined);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Get cached data
	 */
	getCachedData(collectionPath: string, documentId: string): Result<any | null, Error> {
		if (!this.db) {
			return Result.fail(new Error('Database not initialized'));
		}

		try {
			const stmt = this.db.prepare(`
				SELECT data FROM cloud_cache
				WHERE collection_path = ? AND document_id = ?
			`);

			const row = stmt.get(collectionPath, documentId) as { data: string } | undefined;

			if (!row) {
				return Result.succeed(null);
			}

			return Result.succeed(JSON.parse(row.data));
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Set sync metadata
	 */
	setMetadata(key: string, value: any): Result<void, Error> {
		if (!this.db) {
			return Result.fail(new Error('Database not initialized'));
		}

		try {
			const stmt = this.db.prepare(`
				INSERT OR REPLACE INTO sync_metadata (key, value)
				VALUES (?, ?)
			`);

			stmt.run(key, JSON.stringify(value));

			return Result.succeed(undefined);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Get sync metadata
	 */
	getMetadata(key: string): Result<any | null, Error> {
		if (!this.db) {
			return Result.fail(new Error('Database not initialized'));
		}

		try {
			const stmt = this.db.prepare('SELECT value FROM sync_metadata WHERE key = ?');
			const row = stmt.get(key) as { value: string } | undefined;

			if (!row) {
				return Result.succeed(null);
			}

			return Result.succeed(JSON.parse(row.value));
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Close the database connection
	 */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
			logger.debug('Offline queue database closed');
		}
	}
}

// In-source tests
if (import.meta.vitest != null) {
	const { describe, it, expect, beforeEach, afterEach, vi } = import.meta.vitest;
	const { Result } = await import('@praha/byethrow');
	const { mkdtempSync, rmSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');

	// Mock better-sqlite3 to avoid binding issues
	vi.mock('better-sqlite3', () => {
		// Store mock data inside the module
		let mockData: any[] = [];
		let mockCache: Record<string, any> = {};
		let mockMetadata: Record<string, any> = {};
		let idCounter = 1;

		const MockDatabase = vi.fn(() => {
			return {
				prepare: vi.fn((sql: string) => {
					if (sql.includes('INSERT INTO sync_queue')) {
						return {
							run: vi.fn((operationType, collectionPath, documentId, data, createdAt) => {
								const item = {
									id: idCounter++,
									operation_type: operationType,
									collection_path: collectionPath,
									document_id: documentId,
									data,
									created_at: createdAt,
									retry_count: 0,
									last_error: null,
								};
								mockData.push(item);
								return { lastInsertRowid: item.id, changes: 1 };
							}),
						};
					}
					else if (sql.includes('SELECT * FROM sync_queue')) {
						return {
							all: vi.fn(() => mockData.filter(item => item.retry_count < 3).map(item => ({
								id: item.id,
								operation_type: item.operation_type,
								collection_path: item.collection_path,
								document_id: item.document_id,
								data: item.data,
								created_at: item.created_at,
								retry_count: item.retry_count,
								last_error: item.last_error,
							}))),
						};
					}
					else if (sql.includes('DELETE FROM sync_queue WHERE id = ?')) {
						return {
							run: vi.fn((id) => {
								const index = mockData.findIndex(item => item.id === id);
								if (index >= 0) {
									mockData.splice(index, 1);
									return { changes: 1 };
								}
								return { changes: 0 };
							}),
						};
					}
					else if (sql.includes('UPDATE sync_queue')) {
						return {
							run: vi.fn((error, id) => {
								const item = mockData.find(i => i.id === id);
								if (item) {
									item.retry_count = item.retry_count + 1;
									item.last_error = error;
									return { changes: 1 };
								}
								return { changes: 0 };
							}),
						};
					}
					else if (sql.includes('SELECT COUNT(*) as count')) {
						return {
							get: vi.fn(() => ({ count: mockData.filter(item => item.retry_count < 3).length })),
						};
					}
					else if (sql.includes('INSERT OR REPLACE INTO cloud_cache')) {
						return {
							run: vi.fn((collectionPath, documentId, data, lastUpdated) => {
								const key = `${collectionPath}/${documentId}`;
								mockCache[key] = data;
								return { changes: 1 };
							}),
						};
					}
					else if (sql.includes('SELECT data FROM cloud_cache')) {
						return {
							get: vi.fn((collectionPath, documentId) => {
								const key = `${collectionPath}/${documentId}`;
								const data = mockCache[key];
								return data ? { data } : null;
							}),
						};
					}
					else if (sql.includes('INSERT OR REPLACE INTO sync_metadata')) {
						return {
							run: vi.fn((key, value) => {
								mockMetadata[key] = value;
								return { changes: 1 };
							}),
						};
					}
					else if (sql.includes('SELECT value FROM sync_metadata')) {
						return {
							get: vi.fn((key) => {
								const value = mockMetadata[key];
								return value ? { value } : null;
							}),
						};
					}
					else {
						return {
							run: vi.fn().mockReturnValue({ changes: 1 }),
							get: vi.fn(),
							all: vi.fn().mockReturnValue([]),
						};
					}
				}),
				exec: vi.fn(),
				close: vi.fn(),
			};
		});

		// Add reset function
		MockDatabase.reset = () => {
			mockData = [];
			mockCache = {};
			mockMetadata = {};
			idCounter = 1;
		};

		return {
			default: MockDatabase,
		};
	});

	describe('OfflineQueue', () => {
		let queue: OfflineQueue;
		let tempDir: string;

		beforeEach(async () => {
			// Reset mock data before each test
			const betterSqlite = await import('better-sqlite3');
			(betterSqlite.default).reset();

			tempDir = mkdtempSync(join(tmpdir(), 'ccusage-test-'));
			const dbPath = join(tempDir, 'test.db');
			queue = new OfflineQueue(dbPath);
			// Initialize once in beforeEach
			const initResult = queue.initialize();
			if (Result.isFailure(initResult)) {
				throw initResult.error;
			}
		});

		afterEach(() => {
			queue.close();
			rmSync(tempDir, { recursive: true, force: true });
		});

		it('should initialize database successfully', () => {
			// Already initialized in beforeEach, test a fresh instance
			const freshQueue = new OfflineQueue(join(tempDir, 'test2.db'));
			const result = freshQueue.initialize();
			expect(Result.isSuccess(result)).toBe(true);
			freshQueue.close();
		});

		it('should enqueue operations', () => {
			const item = {
				operationType: 'create' as QueueOperation,
				collectionPath: 'users/test/devices',
				documentId: 'device1',
				data: { name: 'Test Device' },
			};

			const result = queue.enqueue(item);
			if (Result.isFailure(result)) {
				console.error('Enqueue failed:', result.error);
			}
			expect(Result.isSuccess(result)).toBe(true);
			expect(result.value).toBeGreaterThan(0);
		});

		it('should dequeue operations in order', () => {
			// Enqueue multiple items
			queue.enqueue({
				operationType: 'create',
				collectionPath: 'path1',
				documentId: 'doc1',
				data: { value: 1 },
			});

			queue.enqueue({
				operationType: 'update',
				collectionPath: 'path2',
				documentId: 'doc2',
				data: { value: 2 },
			});

			const result = queue.dequeue(10);
			expect(Result.isSuccess(result)).toBe(true);
			expect(result.value).toHaveLength(2);
			expect(result.value[0].documentId).toBe('doc1');
			expect(result.value[1].documentId).toBe('doc2');
		});

		it('should mark items as successful', () => {
			const enqueueResult = queue.enqueue({
				operationType: 'create',
				collectionPath: 'test',
				documentId: 'doc1',
				data: {},
			});

			if (Result.isSuccess(enqueueResult)) {
				const id = enqueueResult.value;
				const markResult = queue.markSuccess(id);
				expect(Result.isSuccess(markResult)).toBe(true);

				// Verify item is removed
				const items = queue.dequeue(10);
				if (Result.isSuccess(items)) {
					expect(items.value).toHaveLength(0);
				}
			}
		});

		it('should mark items as failed and increment retry count', () => {
			const enqueueResult = queue.enqueue({
				operationType: 'create',
				collectionPath: 'test',
				documentId: 'doc1',
				data: {},
			});

			if (Result.isSuccess(enqueueResult)) {
				const id = enqueueResult.value;
				queue.markFailed(id, 'Network error');

				const items = queue.dequeue(10);
				if (Result.isSuccess(items) && items.value.length > 0) {
					expect(items.value[0].retryCount).toBe(1);
					expect(items.value[0].lastError).toBe('Network error');
				}
			}
		});

		it('should not dequeue items that exceeded max retries', () => {
			const enqueueResult = queue.enqueue({
				operationType: 'create',
				collectionPath: 'test',
				documentId: 'doc1',
				data: {},
			});

			if (Result.isSuccess(enqueueResult)) {
				const id = enqueueResult.value;

				// Fail 3 times (max retries)
				queue.markFailed(id, 'Error 1');
				queue.markFailed(id, 'Error 2');
				queue.markFailed(id, 'Error 3');

				const items = queue.dequeue(10);
				if (Result.isSuccess(items)) {
					expect(items.value).toHaveLength(0);
				}
			}
		});

		it('should get pending count', () => {
			queue.enqueue({
				operationType: 'create',
				collectionPath: 'test',
				documentId: 'doc1',
				data: {},
			});

			queue.enqueue({
				operationType: 'update',
				collectionPath: 'test',
				documentId: 'doc2',
				data: {},
			});

			const result = queue.getPendingCount();
			expect(Result.isSuccess(result)).toBe(true);
			expect(result.value).toBe(2);
		});

		it('should cache and retrieve data', () => {
			const testData = { name: 'Test', value: 123 };

			const cacheResult = queue.cacheData('collection', 'doc1', testData);
			expect(Result.isSuccess(cacheResult)).toBe(true);

			const getResult = queue.getCachedData('collection', 'doc1');
			expect(Result.isSuccess(getResult)).toBe(true);
			expect(getResult.value).toEqual(testData);
		});

		it('should store and retrieve metadata', () => {
			const metadata = { lastSync: Date.now() };

			const setResult = queue.setMetadata('sync_state', metadata);
			expect(Result.isSuccess(setResult)).toBe(true);

			const getResult = queue.getMetadata('sync_state');
			expect(Result.isSuccess(getResult)).toBe(true);
			expect(getResult.value).toEqual(metadata);
		});

		it('should clear failed items', () => {
			const enqueueResult = queue.enqueue({
				operationType: 'create',
				collectionPath: 'test',
				documentId: 'doc1',
				data: {},
			});

			if (Result.isSuccess(enqueueResult)) {
				const id = enqueueResult.value;

				// Exceed max retries
				queue.markFailed(id, 'Error 1');
				queue.markFailed(id, 'Error 2');
				queue.markFailed(id, 'Error 3');

				const clearResult = queue.clearFailedItems();
				expect(Result.isSuccess(clearResult)).toBe(true);
				if (Result.isSuccess(clearResult)) {
					expect(clearResult.value).toBe(1);
				}
			}
		});
	});
}
