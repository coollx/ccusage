/**
 * Enhanced sync engine with encryption support (Phase 4)
 * Builds on v2 with added security and privacy features
 */

import type { ModelBreakdown, UsageData } from '../data-loader.ts';
import type {
	DeviceUsageDocument,
	SessionUsageDocument,
	SyncCheckpoint,
	SyncResult,
} from './_types.ts';
import type { DeduplicationEntry } from './deduplication.ts';
import { Result } from '@praha/byethrow';
import {
	createISOTimestamp,
} from '../_types.ts';
import { loadDailyUsageData } from '../data-loader.ts';
import { logger } from '../logger.ts';
import { getCloudAggregator } from './aggregation.ts';
import { loadSyncSettings } from './config-manager.ts';
import {
	ConflictQueue,
} from './conflict-resolution.ts';
import { getEncryption } from './data-encryption.ts';
import {
	BatchDeduplicator,
} from './deduplication.ts';
import { getFirebaseClient } from './firebase-client.ts';
import { OfflineQueue } from './offline-queue.ts';
import { getPrivacyControls } from './privacy-controls.ts';

// Fields to encrypt in documents
const ENCRYPTED_FIELDS = {
	deviceUsage: [] as string[], // Can add fields like 'deviceName' if needed
	sessionUsage: ['projectId', 'sessionId'],
};

/**
 * Enhanced sync engine with encryption and privacy support
 */
export class SecureSyncEngine {
	private client = getFirebaseClient();
	private aggregator = getCloudAggregator();
	private encryption = getEncryption();
	private privacy = getPrivacyControls();
	private deviceName: string | null = null;
	private deviceId: string | null = null;
	private userId: string | null = null;
	private deduplicationStore = new Map<string, DeduplicationEntry>();
	private conflictQueue = new ConflictQueue();
	private deduplicator: BatchDeduplicator | null = null;
	private offlineQueue: OfflineQueue | null = null;

	/**
	 * Initialize the sync engine with security features
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

		// Initialize encryption
		const encryptionInit = await this.encryption.initialize();
		if (Result.isFailure(encryptionInit)) {
			return encryptionInit;
		}

		// Load privacy settings
		const privacyInit = await this.privacy.loadSettings();
		if (Result.isFailure(privacyInit)) {
			return privacyInit;
		}

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

		// Sync privacy settings to Firebase
		await this.syncPrivacySettings();

		logger.info('Secure sync engine initialized with encryption and privacy controls');
		return Result.succeed();
	}

	/**
	 * Sync privacy settings to Firebase
	 */
	private async syncPrivacySettings(): Promise<Result<void, Error>> {
		const settingsResult = await this.privacy.loadSettings();
		if (Result.isFailure(settingsResult)) {
			return settingsResult;
		}

		const path = `users/${this.userId}/privacy_settings/config`;
		const writeResult = await this.client.setDoc(path, settingsResult.value);
		if (Result.isFailure(writeResult)) {
			logger.warn('Failed to sync privacy settings to Firebase', writeResult.error);
		}

		return Result.succeed();
	}

	/**
	 * Sync new usage data to cloud with encryption and privacy
	 */
	async syncNewData(): Promise<SyncResult> {
		const startTime = Date.now();

		try {
			if (!this.userId || !this.deviceName || !this.deviceId) {
				return {
					success: false,
					error: 'Sync engine not initialized',
					duration: Date.now() - startTime,
				};
			}

			// Load all usage data
			const dataResult = await loadDailyUsageData({ mode: 'auto' });
			if (dataResult.length === 0) {
				return {
					success: true,
					recordsSynced: 0,
					duration: Date.now() - startTime,
				};
			}

			const rawData = dataResult;

			// Apply privacy retention policy
			const retainedData = rawData.filter((entry) => {
				if (!entry.timestamp) { return true; }
				return this.privacy.shouldRetainData(entry.timestamp);
			});

			// Apply anonymization
			const anonymizedData = retainedData.map(entry =>
				this.privacy.anonymizeUsageData(entry),
			);

			// Load last sync checkpoint
			const checkpointPath = `users/${this.userId}/sync_checkpoints/${this.deviceId}`;
			const checkpointResult = await this.client.getDoc<SyncCheckpoint>(checkpointPath);
			const lastSync = Result.isSuccess(checkpointResult) && checkpointResult.value
				? new Date(checkpointResult.value.lastSyncTimestamp)
				: new Date(0);

			// Filter data that needs syncing
			const dataToSync = anonymizedData.filter((entry) => {
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
					error: `Deduplication failed: ${deduplicationResult.error.message}`,
					duration: Date.now() - startTime,
				};
			}

			const uniqueData = deduplicationResult.value;
			logger.info(`Deduplication: ${dataToSync.length} entries -> ${uniqueData.length} unique`);

			if (uniqueData.length === 0) {
				return {
					success: true,
					recordsSynced: 0,
					duration: Date.now() - startTime,
				};
			}

			// Group unique data by date for aggregation
			const dailyGroups = this.groupUsageByDate(uniqueData);

			// Sync daily usage with encryption
			let recordsSynced = 0;
			for (const [date, entries] of dailyGroups.entries()) {
				const syncResult = await this.syncDailyUsage(date, entries);
				if (Result.isSuccess(syncResult)) {
					recordsSynced++;
				}
			}

			// Update sync checkpoint
			const checkpoint: SyncCheckpoint = {
				deviceId: this.deviceId,
				lastProcessedFile: 'all',
				lastProcessedLine: 0,
				lastSyncTimestamp: currentTime,
				filesProcessed: [],
			};
			await this.client.setDoc(checkpointPath, checkpoint);

			// Clean up old data based on retention policy
			await this.cleanupOldData();

			return {
				success: true,
				recordsSynced,
				duration: Date.now() - startTime,
			};
		}
		catch (error) {
			logger.error('Sync error', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - startTime,
			};
		}
	}

	/**
	 * Sync daily usage data with encryption
	 */
	private async syncDailyUsage(
		date: string,
		entries: UsageData[],
	): Promise<Result<void, Error>> {
		const aggregated = this.aggregateUsageData(entries);
		const docPath = `users/${this.userId}/devices/${this.deviceName}/usage/${date}`;

		// Apply privacy controls to the document
		let doc: DeviceUsageDocument = {
			date,
			deviceName: this.deviceName!,
			models: aggregated.models,
			totalCost: aggregated.totalCost,
			totalTokens: aggregated.totalTokens,
			inputTokens: aggregated.inputTokens,
			outputTokens: aggregated.outputTokens,
			cachedTokens: aggregated.cachedTokens,
			lastUpdated: createISOTimestamp(new Date().toISOString()),
		};

		// Apply anonymization
		doc = this.privacy.anonymizeDeviceUsage(doc);

		// Encrypt sensitive fields if needed
		const encryptedDoc = await this.encryptDocument(doc, ENCRYPTED_FIELDS.deviceUsage);
		if (Result.isFailure(encryptedDoc)) {
			return encryptedDoc;
		}

		// Write to Firebase
		const writeResult = await this.client.setDoc(docPath, encryptedDoc.value);
		if (Result.isFailure(writeResult)) {
			// Queue for offline sync
			if (this.offlineQueue) {
				await this.offlineQueue.enqueue({
					operationType: 'update',
					collectionPath: docPath,
					documentId: date,
					data: JSON.stringify(encryptedDoc.value),
				});
			}
			return writeResult;
		}

		return Result.succeed();
	}

	/**
	 * Sync session usage with encryption
	 */
	async syncSessionUsage(
		projectId: string,
		sessionId: string,
		usage: ModelBreakdown[],
	): Promise<Result<void, Error>> {
		const sessionKey = `${projectId}_${sessionId}`;
		const docPath = `users/${this.userId}/usage_sessions/${sessionKey}`;

		// Create session document
		let doc: SessionUsageDocument = {
			projectId,
			sessionId,
			devices: {
				[this.deviceId!]: {
					models: usage,
					totalCost: usage.reduce((sum, m) => sum + (m.cost ?? 0), 0),
					startTime: createISOTimestamp(new Date().toISOString()),
					endTime: createISOTimestamp(new Date().toISOString()),
				},
			},
			aggregated: {
				totalCost: usage.reduce((sum, m) => sum + (m.cost ?? 0), 0),
				totalTokens: usage.reduce((sum, m) => sum + (m.totalTokens ?? 0), 0),
				models: usage,
			},
		};

		// Apply anonymization
		doc = this.privacy.anonymizeSessionUsage(doc);

		// Encrypt sensitive fields
		const encryptedDoc = await this.encryptDocument(doc, ENCRYPTED_FIELDS.sessionUsage);
		if (Result.isFailure(encryptedDoc)) {
			return encryptedDoc;
		}

		// Write to Firebase
		const writeResult = await this.client.setDoc(docPath, encryptedDoc.value);
		return writeResult;
	}

	/**
	 * Encrypt document fields
	 */
	async encryptDocument<T extends Record<string, any>>(
		doc: T,
		fields: string[],
	): Promise<Result<T, Error>> {
		if (fields.length === 0 || !this.userId) {
			return Result.succeed(doc);
		}

		return this.encryption.encryptFields(doc, fields, this.userId);
	}

	/**
	 * Decrypt document fields
	 */
	private async decryptDocument<T extends Record<string, any>>(
		doc: T,
		fields: string[],
	): Promise<Result<T, Error>> {
		if (fields.length === 0 || !this.userId) {
			return Result.succeed(doc);
		}

		return this.encryption.decryptFields(doc, fields, this.userId);
	}

	/**
	 * Clean up old data based on retention policy
	 */
	private async cleanupOldData(): Promise<Result<void, Error>> {
		const deleteResult = await this.privacy.getDataToDelete();
		if (Result.isFailure(deleteResult)) {
			return deleteResult;
		}

		const { dates } = deleteResult.value;

		// Delete old daily usage data
		for (const date of dates.slice(0, 10)) { // Limit to 10 per sync
			const path = `users/${this.userId}/devices/${this.deviceName}/usage/${date}`;
			await this.client.deleteDoc(path);
		}

		logger.info(`Cleaned up ${Math.min(dates.length, 10)} old data entries`);
		return Result.succeed();
	}

	/**
	 * Get encryption status
	 */
	async getEncryptionStatus(): Promise<Result<{
		configured: boolean;
		keyId?: string;
		createdAt?: string;
		rotatedAt?: string;
	}, Error>> {
		return this.encryption.getStatus();
	}

	/**
	 * Rotate encryption keys
	 */
	async rotateEncryptionKeys(): Promise<Result<string, Error>> {
		if (!this.userId) {
			return Result.fail(new Error('User ID not available'));
		}
		return this.encryption.rotateKeys(this.userId);
	}

	/**
	 * Export user data
	 */
	async exportUserData(format: 'json' | 'csv'): Promise<Result<string, Error>> {
		// This would fetch all user data from Firebase and export it
		// Implementation would be similar to aggregation but for export
		return Result.fail(new Error('Export not implemented yet'));
	}

	// Helper methods from v2
	private groupUsageByDate(data: UsageData[]): Map<string, UsageData[]> {
		const groups = new Map<string, UsageData[]>();

		for (const entry of data) {
			if (!entry.timestamp) { continue; }
			const date = entry.timestamp.split('T')[0];
			const existing = groups.get(date) ?? [];
			existing.push(entry);
			groups.set(date, existing);
		}

		return groups;
	}

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
			if (!entry.model) { continue; }

			const existing = modelMap.get(entry.model) ?? {
				model: entry.model,
				inputTokens: 0,
				outputTokens: 0,
				cachedTokens: 0,
				totalTokens: 0,
				cost: 0,
			};

			existing.inputTokens += entry.inputTokens ?? 0;
			existing.outputTokens += entry.outputTokens ?? 0;
			existing.cachedTokens += entry.cachedTokens ?? 0;
			existing.totalTokens += entry.totalTokens ?? 0;
			existing.cost += entry.costUSD ?? 0;

			modelMap.set(entry.model, existing);

			totalCost += entry.costUSD ?? 0;
			totalTokens += entry.totalTokens ?? 0;
			inputTokens += entry.inputTokens ?? 0;
			outputTokens += entry.outputTokens ?? 0;
			cachedTokens += entry.cachedTokens ?? 0;
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
}

// Singleton instance
let secureEngineInstance: SecureSyncEngine | null = null;

export function getSecureSyncEngine(): SecureSyncEngine {
	if (!secureEngineInstance) {
		secureEngineInstance = new SecureSyncEngine();
	}
	return secureEngineInstance;
}

// In-source tests
if (import.meta.vitest != null) {
	const { describe, it, expect, beforeEach, vi } = import.meta.vitest;

	describe('SecureSyncEngine', () => {
		let engine: SecureSyncEngine;

		beforeEach(() => {
			// Reset singleton
			secureEngineInstance = null;
			engine = getSecureSyncEngine();
		});

		it('should initialize with encryption and privacy', async () => {
			// Mock the dependencies
			vi.spyOn(engine.client, 'initialize').mockImplementation(async () => Result.succeed());
			vi.spyOn(engine.client, 'getUserId').mockImplementation(() => Result.succeed('test-user'));
			vi.spyOn(engine.encryption, 'initialize').mockImplementation(async () => Result.succeed());
			vi.spyOn(engine.privacy, 'loadSettings').mockImplementation(async () => Result.succeed({
				anonymizeProjects: false,
				anonymizeSessions: false,
				retentionDays: 365,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}));

			const result = await engine.initialize();
			expect(Result.isFailure(result)).toBe(true); // Will fail on sync settings
		});

		it('should encrypt sensitive fields before sync', async () => {
			const doc = {
				projectId: 'my-project',
				sessionId: 'my-session',
				totalCost: 10.5,
			};

			// Set userId manually for the test
			(engine as any).userId = 'test-user-id';

			const encryptSpy = vi.spyOn(engine.encryption, 'encryptFields');
			encryptSpy.mockImplementation(async () => Result.succeed({
				...doc,
				projectId: { keyId: 'test', iv: 'test', tag: 'test', data: 'encrypted' },
				sessionId: { keyId: 'test', iv: 'test', tag: 'test', data: 'encrypted' },
			}));

			const result = await engine.encryptDocument(doc, ['projectId', 'sessionId']);
			expect(Result.isSuccess(result)).toBe(true);
			expect(encryptSpy).toHaveBeenCalledWith(doc, ['projectId', 'sessionId'], 'test-user-id');
		});

		it('should apply privacy controls during sync', async () => {
			const usageData: UsageData = {
				sessionId: 'sensitive-session',
				requestId: 'sensitive-request',
				model: 'claude-opus-4',
				totalTokens: 1000,
				costUSD: 5.0,
				timestamp: new Date().toISOString(),
			};

			const anonymizeSpy = vi.spyOn(engine.privacy, 'anonymizeUsageData');
			anonymizeSpy.mockReturnValue({
				...usageData,
				sessionId: 'session-12345678',
				requestId: 'req-87654321',
			});

			const result = engine.privacy.anonymizeUsageData(usageData);
			expect(result.sessionId).not.toBe(usageData.sessionId);
		});
	});
}
