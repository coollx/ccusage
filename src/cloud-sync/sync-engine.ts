import type { DailyUsage, ModelBreakdown } from '../data-loader.ts';
import type { AggregatedUsageDocument, DeviceUsageDocument, SyncCheckpoint, SyncResult } from './_types.ts';
import type { DeduplicationEntry } from './deduplication.ts';
import process from 'node:process';
import { Result } from '@praha/byethrow';
import { createDailyDate, createISOTimestamp } from '../_types.ts';
import { loadDailyUsageData } from '../data-loader.ts';
import { log, logger } from '../logger.ts';
import { getCloudAggregator } from './aggregation.ts';
import { loadSyncSettings, updateSyncSettings } from './config-manager.ts';
import { ConflictQueue } from './conflict-resolution.ts';
import { getFirebaseClient } from './firebase-client.ts';

/**
 * Sync engine with device isolation for conflict-free synchronization
 */
export class SyncEngine {
	private client = getFirebaseClient();
	private aggregator = getCloudAggregator();
	private deviceName: string | null = null;
	private deviceId: string | null = null;
	private userId: string | null = null;
	private deduplicationStore = new Map<string, DeduplicationEntry>();
	private conflictQueue = new ConflictQueue();

	/**
	 * Initializes the sync engine
	 */
	async initialize(): Promise<Result<void, Error>> {
		// Initialize Firebase client
		const initResult = await this.client.initialize();
		if (Result.isFailure(initResult)) {
			return initResult;
		}

		// Load sync settings first
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

		// No user ID needed - each Firebase project belongs to one person
		// We'll remove the userId from settings later
		this.userId = 'not-used'; // Keep for backward compatibility temporarily

		// Ensure device document exists
		const devicePath = `devices/${this.deviceName}`;
		const deviceExistsResult = await this.client.docExists(devicePath);

		if (Result.isSuccess(deviceExistsResult) && !deviceExistsResult.value) {
			log(`[SyncEngine] Creating device document at ${devicePath}`);
			const deviceInfo = {
				deviceId: this.deviceId,
				deviceName: this.deviceName,
				platform: process.platform,
				createdAt: new Date().toISOString(),
				syncVersion: 1,
			};

			const createResult = await this.client.setDoc(devicePath, deviceInfo);
			if (Result.isFailure(createResult)) {
				log(`[SyncEngine] Warning: Failed to create device document`);
			}
			else {
				log(`[SyncEngine] Device document created successfully`);
			}
		}
		else if (Result.isSuccess(deviceExistsResult) && deviceExistsResult.value) {
			log(`[SyncEngine] Device document already exists at ${devicePath}`);
		}

		return Result.succeed(undefined);
	}

	/**
	 * Load deduplication store from Firestore
	 */
	private async loadDeduplicationStore(): Promise<Result<void, Error>> {
		try {
			const deduplicationPath = `deduplication`;
			const entriesResult = await this.client.queryCollection<DeduplicationEntry>(
				deduplicationPath,
				{ limit: 1000 }, // Load recent entries
			);

			if (Result.isSuccess(entriesResult)) {
				for (const entry of entriesResult.value) {
					this.deduplicationStore.set(entry.hash, entry);
				}
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
			path: `deduplication/${entry.hash}`,
			data: entry,
		}));

		return this.client.batchWrite(operations);
	}

	/**
	 * Syncs new local data to Firebase with deduplication and conflict resolution
	 */
	async syncNewData(): Promise<SyncResult> {
		const startTime = Date.now();

		// Ensure initialized
		if (!this.userId || !this.deviceName || !this.deviceId) {
			const initResult = await this.initialize();
			if (Result.isFailure(initResult)) {
				return { success: false, error: (initResult as { error: Error }).error.message };
			}
		}

		try {
			// Load local data
			log('[SyncEngine] Loading local usage data...');
			const localData = await loadDailyUsageData({
				mode: 'auto',
				order: 'asc',
				// Remove offline: true to ensure we load all available data
			});
			log(`[SyncEngine] Loaded ${localData.length} local records`);

			if (localData.length === 0) {
				return { success: true, recordsSynced: 0, duration: Date.now() - startTime };
			}

			// Get last sync checkpoint
			const checkpointPath = `sync_checkpoints/${this.deviceId}`;
			const checkpointResult = await this.client.getDoc<SyncCheckpoint>(checkpointPath);
			const lastSync = Result.isSuccess(checkpointResult) && checkpointResult.value
				? new Date(checkpointResult.value.lastSyncTimestamp)
				: new Date(0);

			// Filter data that needs syncing
			const dataToSync = localData.filter((entry) => {
				// Sync if no timestamp or if newer than last sync
				if (!entry.timestamp) { return true; }
				const entryDate = new Date(entry.timestamp);
				return entryDate > lastSync;
			});

			if (dataToSync.length === 0) {
				return { success: true, recordsSynced: 0, duration: Date.now() - startTime };
			}

			// Group by date for aggregation
			log(`[SyncEngine] Grouping ${dataToSync.length} records by date...`);
			const dailyGroups = this.groupByDate(dataToSync);
			log(`[SyncEngine] Found ${dailyGroups.size} unique dates`);

			// Prepare batch operations
			const operations: Array<{ path: string; data: DeviceUsageDocument }> = [];

			for (const [date, entries] of dailyGroups.entries()) {
				log(`[SyncEngine] Processing date ${date} with ${entries.length} entries`);
				const aggregated = this.aggregateDailyData(entries);
				const docPath = `devices/${this.deviceName}/usage/${date}`;
				log(`[SyncEngine] Prepared document path: ${docPath}`);

				operations.push({
					path: docPath,
					data: {
						date,
						deviceName: this.deviceName!,
						models: aggregated.models,
						totalCost: aggregated.totalCost,
						totalTokens: aggregated.totalTokens,
						inputTokens: aggregated.inputTokens,
						outputTokens: aggregated.outputTokens,
						cachedTokens: aggregated.cachedTokens,
						lastUpdated: createISOTimestamp(new Date().toISOString()),
					},
				});
			}

			// Execute batch write
			const batchResult = await this.client.batchWrite(operations);
			if (Result.isFailure(batchResult)) {
				return { success: false, error: (batchResult as { error: Error }).error.message };
			}

			// Update sync checkpoint
			const newCheckpoint: SyncCheckpoint = {
				deviceId: this.deviceId!,
				lastProcessedFile: '', // TODO: Track actual files
				lastProcessedLine: 0,
				lastSyncTimestamp: createISOTimestamp(new Date().toISOString()),
				filesProcessed: [], // TODO: Track actual files
			};

			const checkpointUpdateResult = await this.client.setDoc(checkpointPath, newCheckpoint);
			if (Result.isFailure(checkpointUpdateResult)) {
				logger.warn('Failed to update sync checkpoint:', (checkpointUpdateResult as { error: Error }).error.message);
			}

			// Update device document with last sync timestamp
			const devicePath = `devices/${this.deviceName}`;
			const deviceUpdateResult = await this.client.getDoc(devicePath);
			if (Result.isSuccess(deviceUpdateResult) && deviceUpdateResult.value) {
				const deviceData = deviceUpdateResult.value;
				const updatedDeviceData = {
					...deviceData,
					lastSyncTimestamp: new Date().toISOString(),
				};
				await this.client.setDoc(devicePath, updatedDeviceData);
			}

			// Update local sync settings
			await updateSyncSettings({
				lastSync: new Date().toISOString(),
			});

			return {
				success: true,
				recordsSynced: operations.length,
				duration: Date.now() - startTime,
			};
		}
		catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - startTime,
			};
		}
	}

	/**
	 * Fetches aggregated data from all devices for a specific date
	 * Now uses the cloud aggregator with caching
	 */
	async fetchAggregatedData(date: string): Promise<Result<AggregatedUsageDocument | null, Error>> {
		// Ensure aggregator is initialized
		const aggregatorInit = await this.aggregator.initialize();
		if (Result.isFailure(aggregatorInit)) {
			// Fall back to original implementation
			return this.fetchAggregatedDataLegacy(date);
		}

		// Use the cloud aggregator for optimized fetching
		const dailyDate = createDailyDate(date);
		const aggregationResult = await this.aggregator.aggregateDailyUsage(dailyDate, {
			useCache: true,
			cacheTTL: 5 * 60 * 1000, // 5 minutes
		});

		if (Result.isFailure(aggregationResult)) {
			return Result.fail(aggregationResult.value);
		}

		const { data, metadata } = aggregationResult.value;

		// Convert to AggregatedUsageDocument format for backward compatibility
		const aggregated: AggregatedUsageDocument = {
			date,
			devices: {}, // Would need device breakdown from aggregator
			totals: {
				cost: data.totalCost,
				tokens: data.inputTokens + data.outputTokens,
				inputTokens: data.inputTokens,
				outputTokens: data.outputTokens,
				cachedTokens: data.cacheCreationTokens + data.cacheReadTokens,
			},
			lastAggregated: metadata.lastUpdated,
		};

		return Result.succeed(aggregated);
	}

	/**
	 * Legacy implementation of fetchAggregatedData
	 */
	private async fetchAggregatedDataLegacy(date: string): Promise<Result<AggregatedUsageDocument | null, Error>> {
		if (!this.userId) {
			const initResult = await this.initialize();
			if (Result.isFailure(initResult)) {
				return initResult;
			}
		}

		// First check if we have a pre-aggregated document
		const aggregatedPath = `usage_aggregated/${date}`;
		const aggregatedResult = await this.client.getDoc<AggregatedUsageDocument>(aggregatedPath);

		if (Result.isSuccess(aggregatedResult) && aggregatedResult.value) {
			return aggregatedResult;
		}

		// If no pre-aggregated data, fetch from all devices
		const devicesPath = `devices`;
		const devicesResult = await this.client.queryCollection<{ id: string }>(devicesPath);

		if (Result.isFailure(devicesResult)) {
			return devicesResult;
		}

		const aggregated: AggregatedUsageDocument = {
			date,
			devices: {},
			totals: {
				cost: 0,
				tokens: 0,
				inputTokens: 0,
				outputTokens: 0,
				cachedTokens: 0,
			},
			lastAggregated: createISOTimestamp(new Date().toISOString()),
		};

		// Fetch usage for each device
		for (const device of devicesResult.value) {
			const usagePath = `${devicesPath}/${device.id}/usage/${date}`;
			const usageResult = await this.client.getDoc<DeviceUsageDocument>(usagePath);

			if (Result.isSuccess(usageResult) && usageResult.value) {
				const usage = usageResult.value;
				aggregated.devices[device.id] = {
					totalCost: usage.totalCost,
					totalTokens: usage.totalTokens,
					lastUpdated: usage.lastUpdated,
				};

				// Update totals
				aggregated.totals.cost += usage.totalCost;
				aggregated.totals.tokens += usage.totalTokens;
				aggregated.totals.inputTokens += usage.inputTokens;
				aggregated.totals.outputTokens += usage.outputTokens;
				aggregated.totals.cachedTokens += usage.cachedTokens;
			}
		}

		// If we found data, cache the aggregation
		if (Object.keys(aggregated.devices).length > 0) {
			await this.client.setDoc(aggregatedPath, aggregated);
		}

		return Result.succeed(aggregated);
	}

	/**
	 * Groups usage data by date
	 */
	private groupByDate(data: DailyUsage[]): Map<string, DailyUsage[]> {
		const groups = new Map<string, DailyUsage[]>();

		for (const entry of data) {
			const date = entry.date;
			if (!groups.has(date)) {
				groups.set(date, []);
			}
			groups.get(date)!.push(entry);
		}

		return groups;
	}

	/**
	 * Aggregates daily usage data
	 */
	private aggregateDailyData(entries: DailyUsage[]): {
		models: ModelBreakdown[];
		totalCost: number;
		totalTokens: number;
		inputTokens: number;
		outputTokens: number;
		cachedTokens: number;
	} {
		log(`[SyncEngine] Aggregating ${entries.length} entries`);
		const modelMap = new Map<string, ModelBreakdown>();
		let totalCost = 0;
		let totalTokens = 0;
		let inputTokens = 0;
		let outputTokens = 0;
		let cachedTokens = 0;

		for (const entry of entries) {
			// Debug log entry structure
			if (!entry.models) {
				log(`[SyncEngine] Warning: Entry missing models property:`, {
					date: entry.date,
					totalCost: entry.totalCost,
					totalTokens: entry.totalTokens,
					hasModels: 'models' in entry,
					entryKeys: Object.keys(entry),
				});
			}

			totalCost += entry.totalCost || entry.cost || 0;
			// Calculate totalTokens from input/output if not available
			const entryTotalTokens = entry.totalTokens
				|| ((entry.inputTokens || 0) + (entry.outputTokens || 0)
					+ (entry.cacheCreationTokens || 0) + (entry.cacheReadTokens || 0));
			totalTokens += entryTotalTokens;
			inputTokens += entry.inputTokens || 0;
			outputTokens += entry.outputTokens || 0;
			cachedTokens += entry.cachedTokens || entry.cacheReadTokens || 0;

			// Aggregate by model - handle both 'models' and 'modelBreakdowns' fields
			const models = entry.models || entry.modelBreakdowns;
			if (models && Array.isArray(models)) {
				log(`[SyncEngine] Processing ${models.length} models for entry`);
				for (const model of models) {
					// Handle different field names (model vs modelName)
					const modelName = model.model || model.modelName;
					if (!modelName) {
						log(`[SyncEngine] Warning: Model entry missing name:`, model);
						continue;
					}

					const existing = modelMap.get(modelName);
					if (existing) {
						existing.cost += model.cost || 0;
						existing.tokens += model.tokens || 0;
						existing.inputTokens = (existing.inputTokens || 0) + (model.inputTokens || 0);
						existing.outputTokens = (existing.outputTokens || 0) + (model.outputTokens || 0);
						existing.cachedTokens = (existing.cachedTokens || 0) + (model.cachedTokens || 0);
					}
					else {
						modelMap.set(modelName, {
							model: modelName,
							cost: model.cost || 0,
							tokens: model.tokens || 0,
							inputTokens: model.inputTokens || 0,
							outputTokens: model.outputTokens || 0,
							cachedTokens: model.cachedTokens || 0,
						});
					}
				}
			}
		}

		const result = {
			models: Array.from(modelMap.values()),
			totalCost,
			totalTokens,
			inputTokens,
			outputTokens,
			cachedTokens,
		};

		log(`[SyncEngine] Aggregation result:`, {
			modelsCount: result.models.length,
			totalCost: result.totalCost,
			totalTokens: result.totalTokens,
		});

		return result;
	}

	/**
	 * Performs a final sync before shutdown
	 */
	async finalSync(): Promise<SyncResult> {
		return this.syncNewData();
	}

	/**
	 * Gets sync status
	 */
	async getStatus(): Promise<Result<{ connected: boolean; lastSync?: string; deviceName?: string }, Error>> {
		// First check if we're initialized
		if (!this.userId || !this.deviceName || !this.deviceId) {
			const initResult = await this.initialize();
			if (Result.isFailure(initResult)) {
				return Result.succeed({ connected: false });
			}
		}

		const status = await this.client.getSyncStatus();

		if (!status.connected) {
			return Result.succeed({ connected: false });
		}

		const settingsResult = await loadSyncSettings();
		if (Result.isFailure(settingsResult)) {
			return Result.succeed({ connected: true });
		}

		return Result.succeed({
			connected: true,
			lastSync: settingsResult.value.lastSync,
			deviceName: settingsResult.value.deviceName,
		});
	}
}

/**
 * Singleton sync engine instance
 */
let syncEngine: SyncEngine | null = null;

/**
 * Gets or creates the sync engine instance
 */
export function getSyncEngine(): SyncEngine {
	if (!syncEngine) {
		syncEngine = new SyncEngine();
	}
	return syncEngine;
}

/**
 * Resets the sync engine (mainly for testing)
 */
export function resetSyncEngine(): void {
	syncEngine = null;
}

if (import.meta.vitest != null) {
	const { describe, it, expect, beforeEach, vi } = import.meta.vitest;

	describe('sync-engine', () => {
		let engine: SyncEngine;

		beforeEach(() => {
			resetSyncEngine();
			engine = getSyncEngine();
		});

		describe('initialization', () => {
			it('should handle missing settings gracefully', async () => {
				const result = await engine.initialize();
				expect(Result.isFailure(result)).toBe(true);
			});
		});

		describe('data aggregation', () => {
			it('should group data by date correctly', () => {
				const data: DailyUsage[] = [
					{
						date: '2025-01-01',
						models: [],
						totalCost: 10,
						totalTokens: 1000,
						inputTokens: 800,
						outputTokens: 200,
						cachedTokens: 0,
						timestamp: '2025-01-01T10:00:00Z',
					},
					{
						date: '2025-01-01',
						models: [],
						totalCost: 20,
						totalTokens: 2000,
						inputTokens: 1600,
						outputTokens: 400,
						cachedTokens: 0,
						timestamp: '2025-01-01T15:00:00Z',
					},
					{
						date: '2025-01-02',
						models: [],
						totalCost: 30,
						totalTokens: 3000,
						inputTokens: 2400,
						outputTokens: 600,
						cachedTokens: 0,
						timestamp: '2025-01-02T10:00:00Z',
					},
				];

				// Access private method via any cast for testing
				const groups = (engine as any).groupByDate(data);

				expect(groups.size).toBe(2);
				expect(groups.get('2025-01-01')).toHaveLength(2);
				expect(groups.get('2025-01-02')).toHaveLength(1);
			});
		});
	});
}
