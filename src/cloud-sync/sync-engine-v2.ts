/**
 * Enhanced sync engine with deduplication, aggregation, and conflict resolution
 * This is a new implementation that integrates Phase 2 functionality
 */

import type { DailyDate } from '../_types.ts';
import type { DailyUsage, ModelBreakdown, UsageData } from '../data-loader.ts';
import type {
	DeviceUsageDocument,
	SyncCheckpoint,
	SyncResult,
} from './_types.ts';
import type { AggregationOptions } from './aggregation.ts';
import type { VersionedDocument } from './conflict-resolution.ts';
import type { DeduplicationEntry } from './deduplication.ts';
import { Result } from '@praha/byethrow';
import {
	createDailyDate,
	createISOTimestamp,

} from '../_types.ts';
import { loadUsageData } from '../data-loader.ts';
import { logger } from '../logger.ts';
import { getCloudAggregator } from './aggregation.ts';
import { loadSyncSettings, updateSyncSettings } from './config-manager.ts';
import {
	ConflictQueue,
	ConflictResolver,
	ResolutionStrategy,

} from './conflict-resolution.ts';
import {
	BatchDeduplicator,
} from './deduplication.ts';
import { getFirebaseClient } from './firebase-client.ts';
import { OfflineQueue } from './offline-queue.ts';

/**
 * Enhanced sync engine with full Phase 2 functionality
 */
export class EnhancedSyncEngine {
	private client = getFirebaseClient();
	private aggregator = getCloudAggregator();
	private deviceName: string | null = null;
	private deviceId: string | null = null;
	private userId: string | null = null;
	private deduplicationStore = new Map<string, DeduplicationEntry>();
	private conflictQueue = new ConflictQueue();
	private deduplicator: BatchDeduplicator | null = null;
	private offlineQueue: OfflineQueue | null = null;

	/**
	 * Initialize the sync engine
	 */
	async initialize(): Promise<Result<void, Error>> {
		// Initialize Firebase client
		const initResult = await this.client.initialize();
		if (Result.isFailure(initResult)) {
			return initResult;
		}

		// Get user ID
		const userIdResult = this.client.getUserId();
		if (Result.isFailure(userIdResult)) {
			return userIdResult;
		}
		this.userId = userIdResult.value;

		// Initialize aggregator
		const aggregatorInit = await this.aggregator.initialize();
		if (Result.isFailure(aggregatorInit)) {
			return aggregatorInit;
		}

		// Load sync settings
		const settingsResult = await loadSyncSettings();
		if (Result.isFailure(settingsResult)) {
			return settingsResult;
		}

		const settings = settingsResult.value;
		if (!settings.enabled || !settings.deviceName || !settings.deviceId) {
			return Result.fail(new Error('Sync not enabled or device not configured'));
		}

		this.deviceName = settings.deviceName;
		this.deviceId = settings.deviceId;

		// Initialize deduplicator
		this.deduplicator = new BatchDeduplicator(this.deduplicationStore, this.deviceId);

		// Initialize offline queue
		this.offlineQueue = new OfflineQueue();
		const queueInitResult = this.offlineQueue.initialize();
		if (Result.isFailure(queueInitResult)) {
			return queueInitResult;
		}

		// Load deduplication store
		const deduplicationResult = await this.loadDeduplicationStore();
		if (Result.isFailure(deduplicationResult)) {
			logger.warn('Failed to load deduplication store:', deduplicationResult.value.message);
			// Continue anyway - we'll build it as we go
		}

		// Process any pending offline operations
		await this.processPendingOfflineOperations();

		return Result.succeed(undefined);
	}

	/**
	 * Load deduplication store from Firestore
	 */
	private async loadDeduplicationStore(): Promise<Result<void, Error>> {
		try {
			const deduplicationPath = `users/${this.userId}/deduplication`;

			// Query recent entries (last 30 days)
			const thirtyDaysAgo = new Date();
			thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

			const entriesResult = await this.client.queryCollection<DeduplicationEntry>(
				deduplicationPath,
				{
					where: [
						{ field: 'lastSeenAt', operator: '>=', value: thirtyDaysAgo.toISOString() },
					],
					limit: 10000,
				},
			);

			if (Result.isSuccess(entriesResult)) {
				for (const entry of entriesResult.value) {
					this.deduplicationStore.set(entry.hash, entry);
				}
				logger.info(`Loaded ${entriesResult.value.length} deduplication entries`);
			}

			return Result.succeed(undefined);
		}
		catch (error) {
			return Result.fail(
				error instanceof Error
					? error
					: new Error('Failed to load deduplication store'),
			);
		}
	}

	/**
	 * Save deduplication entries to Firestore
	 */
	private async saveDeduplicationEntries(
		entries: DeduplicationEntry[],
	): Promise<Result<void, Error>> {
		if (entries.length === 0) { return Result.succeed(undefined); }

		const operations = entries.map(entry => ({
			path: `users/${this.userId}/deduplication/${entry.hash}`,
			data: entry,
		}));

		const result = await this.client.batchWrite(operations);
		if (Result.isSuccess(result)) {
			logger.info(`Saved ${entries.length} deduplication entries`);
		}
		return result;
	}

	/**
	 * Sync new local data with deduplication and conflict resolution
	 */
	async syncNewData(): Promise<SyncResult> {
		const startTime = Date.now();
		const newDeduplicationEntries: DeduplicationEntry[] = [];

		// Ensure initialized
		if (!this.userId || !this.deviceName || !this.deviceId || !this.deduplicator) {
			const initResult = await this.initialize();
			if (Result.isFailure(initResult)) {
				return { success: false, error: initResult.value.message };
			}
		}

		try {
			// Load raw usage data for deduplication
			const rawData = await loadUsageData({
				mode: 'auto',
				order: 'asc',
				offline: true,
			});

			if (rawData.length === 0) {
				return { success: true, recordsSynced: 0, duration: Date.now() - startTime };
			}

			// Get last sync checkpoint
			const checkpointPath = `users/${this.userId}/sync_checkpoints/${this.deviceId}`;
			const checkpointResult = await this.client.getDoc<SyncCheckpoint>(checkpointPath);
			const lastSync = Result.isSuccess(checkpointResult) && checkpointResult.value
				? new Date(checkpointResult.value.lastSyncTimestamp)
				: new Date(0);

			// Filter data that needs syncing
			const dataToSync = rawData.filter((entry) => {
				if (!entry.timestamp) { return true; }
				const entryDate = new Date(entry.timestamp);
				return entryDate > lastSync;
			});

			if (dataToSync.length === 0) {
				return { success: true, recordsSynced: 0, duration: Date.now() - startTime };
			}

			// Perform batch deduplication
			const currentTime = createISOTimestamp(new Date().toISOString());
			const deduplicationResult = await this.deduplicator!.processBatch(
				dataToSync,
				currentTime,
			);

			if (Result.isFailure(deduplicationResult)) {
				return {
					success: false,
					error: `Deduplication failed: ${deduplicationResult.value.message}`,
					duration: Date.now() - startTime,
				};
			}

			const uniqueData = deduplicationResult.value;
			logger.info(`Deduplication: ${dataToSync.length} entries -> ${uniqueData.length} unique`);

			if (uniqueData.length === 0) {
				// All data was duplicates
				return {
					success: true,
					recordsSynced: 0,
					duration: Date.now() - startTime,
				};
			}

			// Group unique data by date for aggregation
			const dailyGroups = this.groupUsageByDate(uniqueData);

			// Prepare versioned documents with conflict detection
			const operations: Array<{
				path: string;
				data: VersionedDocument<DeviceUsageDocument>;
				existingDoc?: VersionedDocument<DeviceUsageDocument>;
			}> = [];

			for (const [date, entries] of dailyGroups.entries()) {
				const aggregated = this.aggregateUsageData(entries);
				const docPath = `users/${this.userId}/devices/${this.deviceName}/usage/${date}`;

				// Check for existing document
				const existingResult = await this.client.getDoc<
					VersionedDocument<DeviceUsageDocument>
				>(docPath);

				const versionedDoc: VersionedDocument<DeviceUsageDocument> = {
					data: {
						date,
						deviceName: this.deviceName!,
						models: aggregated.models,
						totalCost: aggregated.totalCost,
						totalTokens: aggregated.totalTokens,
						inputTokens: aggregated.inputTokens,
						outputTokens: aggregated.outputTokens,
						cachedTokens: aggregated.cachedTokens,
						lastUpdated: currentTime,
					},
					versionVector: ConflictResolver.createInitialVersionVector(this.deviceId!),
					lastModified: currentTime,
					lastModifiedBy: this.deviceId!,
					revision: 1,
				};

				if (Result.isSuccess(existingResult) && existingResult.value) {
					// Handle potential conflicts
					const conflictResult = await this.handleConflict(
						versionedDoc,
						existingResult.value,
						docPath,
					);

					if (conflictResult) {
						operations.push({
							path: docPath,
							data: conflictResult,
							existingDoc: existingResult.value,
						});
					}
				}
				else {
					// New document
					operations.push({
						path: docPath,
						data: versionedDoc,
					});
				}
			}

			// Execute batch write with conflict-aware updates
			const writeOperations = operations.map(op => ({
				path: op.path,
				data: op.data,
			}));

			const batchResult = await this.client.batchWrite(writeOperations);
			if (Result.isFailure(batchResult)) {
				// If offline, queue operations
				if (this.isOfflineError(batchResult.error)) {
					logger.info('Offline detected, queueing operations');
					for (const op of writeOperations) {
						const parts = op.path.split('/');
						const collectionPath = parts.slice(0, -1).join('/');
						const documentId = parts[parts.length - 1];
						this.offlineQueue?.enqueue({
							operationType: 'update',
							collectionPath,
							documentId,
							data: op.data,
						});
					}
					// Still return success since we queued the operations
					return {
						success: true,
						recordsSynced: writeOperations.length,
						duration: Date.now() - startTime,
						offline: true,
					};
				}
				return {
					success: false,
					error: batchResult.error.message,
					duration: Date.now() - startTime,
				};
			}

			// Save new deduplication entries
			const deduplicationStats = this.deduplicator!.getStatistics();
			const newEntries = Array.from(this.deduplicationStore.values())
				.filter(entry => entry.firstSeenAt === currentTime);

			if (newEntries.length > 0) {
				await this.saveDeduplicationEntries(newEntries);
			}

			// Update sync checkpoint
			const newCheckpoint: SyncCheckpoint = {
				deviceId: this.deviceId!,
				lastProcessedFile: '', // TODO: Track actual files
				lastProcessedLine: uniqueData.length,
				lastSyncTimestamp: currentTime,
				filesProcessed: [], // TODO: Track actual files
			};

			await this.client.setDoc(checkpointPath, newCheckpoint);

			// Update local sync settings
			await updateSyncSettings({
				lastSync: new Date().toISOString(),
			});

			// Log statistics
			logger.info('Sync completed:', {
				totalProcessed: dataToSync.length,
				uniqueEntries: uniqueData.length,
				duplicatesSkipped: dataToSync.length - uniqueData.length,
				documentsWritten: operations.length,
				deduplicationRate: deduplicationStats.duplicateRate,
				duration: Date.now() - startTime,
			});

			return {
				success: true,
				recordsSynced: operations.length,
				duration: Date.now() - startTime,
			};
		}
		catch (error) {
			logger.error('Sync failed:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - startTime,
			};
		}
	}

	/**
	 * Handle conflicts between local and remote documents
	 */
	private async handleConflict(
		local: VersionedDocument<DeviceUsageDocument>,
		remote: VersionedDocument<DeviceUsageDocument>,
		documentPath: string,
	): Promise<VersionedDocument<DeviceUsageDocument> | null> {
		const detection = ConflictResolver.detectConflict(local, remote);

		if (!detection.hasConflict) {
			// No conflict, increment version
			local.versionVector = ConflictResolver.incrementVersion(
				remote.versionVector,
				this.deviceId!,
			);
			local.revision = remote.revision + 1;
			return local;
		}

		// Apply resolution strategy based on conflict type
		let strategy = ResolutionStrategy.LAST_WRITE_WINS;

		if (detection.conflictType === 'concurrent_update') {
			// For usage data, prefer merge strategy to not lose data
			strategy = ResolutionStrategy.MERGE;
		}

		const resolution = ConflictResolver.resolveDeviceUsageConflict(
			local,
			remote,
			strategy,
		);

		if (resolution.resolved && resolution.resolvedDocument) {
			logger.info(`Resolved conflict for ${documentPath} using ${strategy}`);
			return resolution.resolvedDocument;
		}

		// Add to conflict queue for manual resolution
		if (resolution.requiresManualResolution && resolution.conflicts) {
			this.conflictQueue.addConflict(
				documentPath,
				resolution.conflicts,
				local,
				remote,
			);
			logger.warn(`Conflict for ${documentPath} requires manual resolution`);
		}

		return null;
	}

	/**
	 * Group usage data by date
	 */
	private groupUsageByDate(data: UsageData[]): Map<DailyDate, UsageData[]> {
		const groups = new Map<DailyDate, UsageData[]>();

		for (const entry of data) {
			// Extract date from timestamp
			const date = createDailyDate(
				entry.timestamp.substring(0, 10), // YYYY-MM-DD
			);

			if (!groups.has(date)) {
				groups.set(date, []);
			}
			groups.get(date)!.push(entry);
		}

		return groups;
	}

	/**
	 * Aggregate usage data for a specific date
	 */
	private aggregateUsageData(entries: UsageData[]): {
		models: ModelBreakdown[];
		totalCost: number;
		totalTokens: number;
		inputTokens: number;
		outputTokens: number;
		cachedTokens: number;
	} {
		const modelMap = new Map<string, ModelBreakdown>();
		let totalCost = 0;
		let totalTokens = 0;
		let inputTokens = 0;
		let outputTokens = 0;
		let cachedTokens = 0;

		for (const entry of entries) {
			// Use pre-calculated cost if available
			totalCost += entry.costUSD || 0;

			// Aggregate token counts
			inputTokens += entry.inputTokens || 0;
			outputTokens += entry.outputTokens || 0;
			cachedTokens += entry.cacheCreationTokens + entry.cacheReadTokens;
			totalTokens += (entry.inputTokens || 0) + (entry.outputTokens || 0);

			// Aggregate by model
			const modelKey = entry.model;
			if (modelMap.has(modelKey)) {
				const existing = modelMap.get(modelKey)!;
				existing.cost += entry.costUSD || 0;
				existing.inputTokens += entry.inputTokens || 0;
				existing.outputTokens += entry.outputTokens || 0;
				existing.cacheCreationTokens += entry.cacheCreationTokens || 0;
				existing.cacheReadTokens += entry.cacheReadTokens || 0;
			}
			else {
				modelMap.set(modelKey, {
					modelName: entry.model,
					cost: entry.costUSD || 0,
					inputTokens: entry.inputTokens || 0,
					outputTokens: entry.outputTokens || 0,
					cacheCreationTokens: entry.cacheCreationTokens || 0,
					cacheReadTokens: entry.cacheReadTokens || 0,
				});
			}
		}

		return {
			models: Array.from(modelMap.values()),
			totalCost,
			totalTokens,
			inputTokens,
			outputTokens,
			cachedTokens,
		};
	}

	/**
	 * Fetch aggregated data using the cloud aggregator
	 */
	async fetchAggregatedData(
		date: DailyDate,
		options?: AggregationOptions,
	): Promise<Result<DailyUsage | null, Error>> {
		const result = await this.aggregator.aggregateDailyUsage(date, options);

		if (Result.isFailure(result)) {
			return Result.fail(result.value);
		}

		return Result.succeed(result.value.data);
	}

	/**
	 * Get sync status including deduplication and conflict statistics
	 */
	async getEnhancedStatus(): Promise<Result<{
		connected: boolean;
		lastSync?: string;
		deviceName?: string;
		deduplicationStats: {
			totalEntries: number;
			uniqueEntries: number;
			duplicateRate: number;
		};
		conflictStats: {
			total: number;
			pending: number;
			resolved: number;
		};
		cacheStats: {
			size: number;
			memoryUsage: number;
		};
	}, Error>> {
		const basicStatus = await this.client.getSyncStatus();

		if (!basicStatus.connected) {
			return Result.succeed({
				connected: false,
				deduplicationStats: {
					totalEntries: 0,
					uniqueEntries: 0,
					duplicateRate: 0,
				},
				conflictStats: {
					total: 0,
					pending: 0,
					resolved: 0,
				},
				cacheStats: {
					size: 0,
					memoryUsage: 0,
				},
			});
		}

		const settingsResult = await loadSyncSettings();
		const settings = Result.isSuccess(settingsResult) ? settingsResult.value : null;

		const deduplicationStats = this.deduplicator?.getStatistics() || {
			totalEntries: 0,
			uniqueEntries: 0,
			duplicateRate: 0,
			devicesInvolved: new Set<string>(),
		};

		const conflictStats = this.conflictQueue.getStatistics();
		const cacheStats = this.aggregator.getCacheStats();

		return Result.succeed({
			connected: true,
			lastSync: settings?.lastSync,
			deviceName: settings?.deviceName,
			deduplicationStats: {
				totalEntries: deduplicationStats.totalEntries,
				uniqueEntries: deduplicationStats.uniqueEntries,
				duplicateRate: deduplicationStats.duplicateRate,
			},
			conflictStats,
			cacheStats: {
				size: cacheStats.size,
				memoryUsage: cacheStats.memoryUsage,
			},
		});
	}

	/**
	 * Clean up old data
	 */
	async cleanup(daysToKeep: number = 30): Promise<{
		deduplicationCleaned: number;
		conflictsCleaned: number;
	}> {
		// Clean old deduplication entries
		const cutoffTime = new Date();
		cutoffTime.setDate(cutoffTime.getDate() - daysToKeep);
		const cutoffTimestamp = cutoffTime.toISOString();

		let deduplicationCleaned = 0;
		for (const [hash, entry] of this.deduplicationStore.entries()) {
			if (entry.lastSeenAt < cutoffTimestamp) {
				this.deduplicationStore.delete(hash);
				deduplicationCleaned++;
			}
		}

		// Clean old resolved conflicts
		const conflictsCleaned = this.conflictQueue.cleanupOldConflicts(daysToKeep);

		// Clear old cache entries
		this.aggregator.clearCache();

		logger.info(`Cleanup completed: ${deduplicationCleaned} dedup entries, ${conflictsCleaned} conflicts`);

		return {
			deduplicationCleaned,
			conflictsCleaned,
		};
	}

	/**
	 * Process pending offline operations from the queue
	 */
	private async processPendingOfflineOperations(): Promise<void> {
		if (!this.offlineQueue) { return; }

		const pendingCountResult = this.offlineQueue.getPendingCount();
		if (Result.isFailure(pendingCountResult) || pendingCountResult.value === 0) {
			return;
		}

		logger.info(`Processing ${pendingCountResult.value} pending offline operations`);

		const itemsResult = this.offlineQueue.dequeue(50); // Process in batches of 50
		if (Result.isFailure(itemsResult)) {
			logger.error('Failed to dequeue offline operations:', itemsResult.error.message);
			return;
		}

		for (const item of itemsResult.value) {
			try {
				// Reconstruct the full path
				const fullPath = `${item.collectionPath}/${item.documentId}`;

				// Try to sync the operation
				const result = await this.client.setDoc(fullPath, item.data);

				if (Result.isSuccess(result)) {
					// Mark as successful
					if (item.id != null) {
						this.offlineQueue.markSuccess(item.id);
						logger.debug(`Successfully synced offline operation ${item.id}`);
					}
				}
				else {
					// Mark as failed
					if (item.id != null) {
						this.offlineQueue.markFailed(item.id, result.error.message);
						logger.warn(`Failed to sync offline operation ${item.id}:`, result.error.message);
					}
				}
			}
			catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				if (item.id != null) {
					this.offlineQueue.markFailed(item.id, errorMessage);
					logger.error(`Error processing offline operation ${item.id}:`, errorMessage);
				}
			}
		}

		// If there are more items, schedule another processing
		const remainingResult = this.offlineQueue.getPendingCount();
		if (Result.isSuccess(remainingResult) && remainingResult.value > 0) {
			logger.info(`${remainingResult.value} operations still pending in offline queue`);
		}
	}

	/**
	 * Check if an error indicates offline status
	 */
	private isOfflineError(error: Error): boolean {
		const offlineIndicators = [
			'Failed to fetch',
			'Network request failed',
			'NetworkError',
			'ENOTFOUND',
			'ECONNREFUSED',
			'ETIMEDOUT',
			'offline',
			'Failed to connect',
		];

		const errorMessage = error.message.toLowerCase();
		return offlineIndicators.some(indicator =>
			errorMessage.includes(indicator.toLowerCase()),
		);
	}

	/**
	 * Close the sync engine and cleanup resources
	 */
	async close(): Promise<void> {
		if (this.offlineQueue) {
			this.offlineQueue.close();
			this.offlineQueue = null;
		}
		await this.client.disconnect();
	}
}

/**
 * Singleton enhanced sync engine instance
 */
let enhancedSyncEngine: EnhancedSyncEngine | null = null;

/**
 * Get or create the enhanced sync engine instance
 */
export function getEnhancedSyncEngine(): EnhancedSyncEngine {
	if (!enhancedSyncEngine) {
		enhancedSyncEngine = new EnhancedSyncEngine();
	}
	return enhancedSyncEngine;
}

/**
 * Reset the enhanced sync engine (mainly for testing)
 */
export function resetEnhancedSyncEngine(): void {
	enhancedSyncEngine = null;
}

// Export type alias for backward compatibility
export type SyncEngineV2 = EnhancedSyncEngine;

if (import.meta.vitest != null) {
	const { describe, it, expect, beforeEach, vi } = import.meta.vitest;

	describe('enhanced sync engine', () => {
		let engine: EnhancedSyncEngine;

		beforeEach(() => {
			resetEnhancedSyncEngine();
			engine = getEnhancedSyncEngine();
		});

		describe('initialization', () => {
			it('should handle missing settings gracefully', async () => {
				const result = await engine.initialize();
				expect(Result.isFailure(result)).toBe(true);
			});
		});

		describe('enhanced status', () => {
			it('should return comprehensive status information', async () => {
				const statusResult = await engine.getEnhancedStatus();

				expect(Result.isSuccess(statusResult)).toBe(true);
				if (Result.isSuccess(statusResult)) {
					const status = statusResult.value;
					expect(status).toHaveProperty('deduplicationStats');
					expect(status).toHaveProperty('conflictStats');
					expect(status).toHaveProperty('cacheStats');
					expect(status.deduplicationStats).toHaveProperty('duplicateRate');
					expect(status.conflictStats).toHaveProperty('pending');
				}
			});
		});

		describe('cleanup', () => {
			it('should clean up old data', async () => {
				const result = await engine.cleanup(30);

				expect(result).toHaveProperty('deduplicationCleaned');
				expect(result).toHaveProperty('conflictsCleaned');
				expect(result.deduplicationCleaned).toBeGreaterThanOrEqual(0);
				expect(result.conflictsCleaned).toBeGreaterThanOrEqual(0);
			});
		});
	});
}
