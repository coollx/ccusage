import type { SyncResult } from './_types.ts';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Result } from '@praha/byethrow';

/**
 * Sync statistics tracking
 */
export type SyncStats = {
	totalSyncs: number;
	successfulSyncs: number;
	failedSyncs: number;
	totalRecordsSynced: number;
	totalBytesTransferred: number;
	averageSyncDuration: number;
	lastSyncTime?: string;
	lastSyncResult?: 'success' | 'failure';
	deviceStats: Record<string, DeviceStats>;
	dailyStats: Record<string, DailyStats>;
};

/**
 * Per-device statistics
 */
export type DeviceStats = {
	deviceName: string;
	totalSyncs: number;
	recordsSynced: number;
	bytesTransferred: number;
	lastSeen: string;
};

/**
 * Daily sync statistics
 */
export type DailyStats = {
	date: string;
	syncs: number;
	recordsSynced: number;
	bytesTransferred: number;
	errors: number;
};

/**
 * Storage usage information
 */
export type StorageInfo = {
	documentsCount: number;
	estimatedSize: number;
	dailyData: number;
	sessionData: number;
	aggregatedData: number;
};

/**
 * Get configuration directory
 */
function getConfigDir(): string {
	return process.env.CCUSAGE_CONFIG_DIR ?? join(homedir(), '.ccusage');
}

/**
 * Usage statistics collector
 */
export class UsageStatsCollector {
	private statsPath: string;
	private stats: SyncStats | null = null;

	constructor(configDir?: string) {
		const baseDir = configDir ?? getConfigDir();
		this.statsPath = join(baseDir, 'sync-stats.json');
	}

	/**
	 * Load statistics from disk
	 */
	async loadStats(): Promise<Result<SyncStats, Error>> {
		try {
			const data = await readFile(this.statsPath, 'utf-8');
			this.stats = JSON.parse(data) as SyncStats;
			return Result.succeed(this.stats);
		}
		catch (error) {
			// Create default stats if file doesn't exist
			const defaultStats: SyncStats = {
				totalSyncs: 0,
				successfulSyncs: 0,
				failedSyncs: 0,
				totalRecordsSynced: 0,
				totalBytesTransferred: 0,
				averageSyncDuration: 0,
				deviceStats: {},
				dailyStats: {},
			};

			this.stats = defaultStats;
			return Result.succeed(defaultStats);
		}
	}

	/**
	 * Save statistics to disk
	 */
	async saveStats(): Promise<Result<void, Error>> {
		if (!this.stats) {
			return Result.fail(new Error('No stats to save'));
		}

		try {
			await writeFile(this.statsPath, JSON.stringify(this.stats, null, 2));
			return Result.succeed(undefined);
		}
		catch (error) {
			return Result.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Record a sync operation
	 */
	async recordSync(
		result: SyncResult,
		deviceId: string,
		deviceName: string,
		bytesTransferred = 0,
	): Promise<Result<void, Error>> {
		// Ensure stats are loaded
		if (!this.stats) {
			const loadResult = await this.loadStats();
			if (Result.isFailure(loadResult)) {
				return loadResult;
			}
		}

		const now = new Date();
		const dateStr = now.toISOString().split('T')[0];

		// Update overall stats
		this.stats!.totalSyncs++;
		if (result.success) {
			this.stats!.successfulSyncs++;
			this.stats!.totalRecordsSynced += result.recordsSynced ?? 0;
			this.stats!.lastSyncResult = 'success';
		}
		else {
			this.stats!.failedSyncs++;
			this.stats!.lastSyncResult = 'failure';
		}

		this.stats!.totalBytesTransferred += bytesTransferred;
		this.stats!.lastSyncTime = now.toISOString();

		// Update average duration
		if (result.duration != null) {
			const totalDuration = this.stats!.averageSyncDuration * (this.stats!.totalSyncs - 1);
			this.stats!.averageSyncDuration = (totalDuration + result.duration) / this.stats!.totalSyncs;
		}

		// Update device stats
		if (!this.stats!.deviceStats[deviceId]) {
			this.stats!.deviceStats[deviceId] = {
				deviceName,
				totalSyncs: 0,
				recordsSynced: 0,
				bytesTransferred: 0,
				lastSeen: now.toISOString(),
			};
		}

		const deviceStats = this.stats!.deviceStats[deviceId];
		deviceStats.totalSyncs++;
		deviceStats.recordsSynced += result.recordsSynced ?? 0;
		deviceStats.bytesTransferred += bytesTransferred;
		deviceStats.lastSeen = now.toISOString();

		// Update daily stats
		if (!this.stats!.dailyStats[dateStr]) {
			this.stats!.dailyStats[dateStr] = {
				date: dateStr,
				syncs: 0,
				recordsSynced: 0,
				bytesTransferred: 0,
				errors: 0,
			};
		}

		const dailyStats = this.stats!.dailyStats[dateStr]!;
		dailyStats.syncs++;
		dailyStats.recordsSynced += result.recordsSynced ?? 0;
		dailyStats.bytesTransferred += bytesTransferred;
		if (!result.success) {
			dailyStats.errors++;
		}

		// Save updated stats
		return this.saveStats();
	}

	/**
	 * Get sync statistics summary
	 */
	async getStatsSummary(): Promise<Result<SyncStats, Error>> {
		if (!this.stats) {
			const loadResult = await this.loadStats();
			if (Result.isFailure(loadResult)) {
				return loadResult;
			}
		}

		return Result.succeed(this.stats!);
	}

	/**
	 * Get storage usage estimation
	 */
	estimateStorageUsage(stats: SyncStats): StorageInfo {
		// Rough estimates based on typical document sizes
		const AVG_DAILY_DOC_SIZE = 1024; // 1KB per daily summary
		const AVG_SESSION_DOC_SIZE = 512; // 512B per session
		const AVG_AGGREGATED_DOC_SIZE = 2048; // 2KB per aggregated doc

		// Count documents
		const dailyDocs = Object.keys(stats.dailyStats).length * Object.keys(stats.deviceStats).length;
		const sessionDocs = Math.floor(stats.totalRecordsSynced / 10); // Estimate
		const aggregatedDocs = Object.keys(stats.dailyStats).length;

		return {
			documentsCount: dailyDocs + sessionDocs + aggregatedDocs,
			estimatedSize:
				dailyDocs * AVG_DAILY_DOC_SIZE
				+ sessionDocs * AVG_SESSION_DOC_SIZE
				+ aggregatedDocs * AVG_AGGREGATED_DOC_SIZE,
			dailyData: dailyDocs * AVG_DAILY_DOC_SIZE,
			sessionData: sessionDocs * AVG_SESSION_DOC_SIZE,
			aggregatedData: aggregatedDocs * AVG_AGGREGATED_DOC_SIZE,
		};
	}

	/**
	 * Calculate projected monthly costs
	 */
	calculateProjectedCosts(stats: SyncStats): {
		firestoreReads: number;
		firestoreWrites: number;
		estimatedCost: number;
	} {
		// Firebase free tier: 50K reads/day, 20K writes/day
		// Pricing: $0.06 per 100K reads, $0.18 per 100K writes (after free tier)

		const daysInMonth = 30;
		const avgDailySyncs = stats.totalSyncs / Math.max(Object.keys(stats.dailyStats).length, 1);
		const avgDailyRecords = stats.totalRecordsSynced / Math.max(Object.keys(stats.dailyStats).length, 1);

		// Estimate operations
		const monthlyWrites = avgDailySyncs * avgDailyRecords * daysInMonth;
		const monthlyReads = avgDailySyncs * 10 * daysInMonth; // Assume 10 reads per sync

		// Calculate costs (simplified)
		const writeCost = Math.max(0, monthlyWrites - 20000 * daysInMonth) / 100000 * 0.18;
		const readCost = Math.max(0, monthlyReads - 50000 * daysInMonth) / 100000 * 0.06;

		return {
			firestoreReads: monthlyReads,
			firestoreWrites: monthlyWrites,
			estimatedCost: writeCost + readCost,
		};
	}

	/**
	 * Get recent sync activity
	 */
	getRecentActivity(days = 7): DailyStats[] {
		if (!this.stats) {
			return [];
		}

		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - days);
		const cutoffStr = cutoff.toISOString().split('T')[0];

		return Object.values(this.stats.dailyStats)
			.filter(daily => daily.date >= cutoffStr)
			.sort((a, b) => b.date.localeCompare(a.date));
	}

	/**
	 * Reset statistics
	 */
	async resetStats(): Promise<Result<void, Error>> {
		this.stats = {
			totalSyncs: 0,
			successfulSyncs: 0,
			failedSyncs: 0,
			totalRecordsSynced: 0,
			totalBytesTransferred: 0,
			averageSyncDuration: 0,
			deviceStats: {},
			dailyStats: {},
		};

		return this.saveStats();
	}
}

// Singleton instance
let statsCollector: UsageStatsCollector | null = null;

/**
 * Get usage stats collector instance
 */
export function getUsageStatsCollector(configDir?: string): UsageStatsCollector {
	if (!statsCollector) {
		statsCollector = new UsageStatsCollector(configDir);
	}
	return statsCollector;
}

// In-source tests
if (import.meta.vitest != null) {
	const { describe, it, expect, beforeEach, afterEach } = import.meta.vitest;
	const { createFixture } = await import('fs-fixture');
	const { join: pathJoin } = await import('node:path');

	describe('UsageStatsCollector', () => {
		let fixture: any;
		let collector: UsageStatsCollector;

		beforeEach(async () => {
			fixture = await createFixture({
				'.ccusage': {},
			});
			collector = new UsageStatsCollector(pathJoin(fixture.path, '.ccusage'));
		});

		afterEach(async () => {
			await fixture.rm();
		});

		it('should create default stats on first load', async () => {
			const result = await collector.loadStats();
			expect(Result.isSuccess(result)).toBe(true);
			expect(result.value.totalSyncs).toBe(0);
			expect(result.value.deviceStats).toEqual({});
		});

		it('should record successful sync', async () => {
			const syncResult: SyncResult = {
				success: true,
				recordsSynced: 10,
				duration: 1000,
			};

			await collector.recordSync(syncResult, 'device1', 'Test Device', 1024);

			const stats = await collector.getStatsSummary();
			expect(Result.isSuccess(stats)).toBe(true);
			expect(stats.value.totalSyncs).toBe(1);
			expect(stats.value.successfulSyncs).toBe(1);
			expect(stats.value.totalRecordsSynced).toBe(10);
			expect(stats.value.totalBytesTransferred).toBe(1024);
		});

		it('should track device statistics', async () => {
			const syncResult: SyncResult = {
				success: true,
				recordsSynced: 5,
			};

			await collector.recordSync(syncResult, 'device1', 'MacBook', 512);
			await collector.recordSync(syncResult, 'device2', 'Linux PC', 256);

			const stats = await collector.getStatsSummary();
			expect(Result.isSuccess(stats)).toBe(true);
			expect(Object.keys(stats.value.deviceStats)).toHaveLength(2);
			expect(stats.value.deviceStats.device1?.deviceName).toBe('MacBook');
			expect(stats.value.deviceStats.device1?.recordsSynced).toBe(5);
		});

		it('should track daily statistics', async () => {
			const syncResult: SyncResult = {
				success: true,
				recordsSynced: 3,
			};

			await collector.recordSync(syncResult, 'device1', 'Test', 100);
			await collector.recordSync(syncResult, 'device1', 'Test', 200);

			const stats = await collector.getStatsSummary();
			expect(Result.isSuccess(stats)).toBe(true);

			const today = new Date().toISOString().split('T')[0];
			expect(stats.value.dailyStats[today]).toBeDefined();
			expect(stats.value.dailyStats[today]?.syncs).toBe(2);
			expect(stats.value.dailyStats[today]?.bytesTransferred).toBe(300);
		});

		it('should calculate average sync duration', async () => {
			await collector.recordSync({ success: true, duration: 1000 }, 'device1', 'Test', 0);
			await collector.recordSync({ success: true, duration: 2000 }, 'device1', 'Test', 0);
			await collector.recordSync({ success: true, duration: 3000 }, 'device1', 'Test', 0);

			const stats = await collector.getStatsSummary();
			expect(Result.isSuccess(stats)).toBe(true);
			expect(stats.value.averageSyncDuration).toBe(2000);
		});

		it('should estimate storage usage', async () => {
			await collector.loadStats();
			const stats = await collector.getStatsSummary();

			if (Result.isSuccess(stats)) {
				// Add some data
				stats.value.dailyStats['2025-01-01'] = {
					date: '2025-01-01',
					syncs: 10,
					recordsSynced: 100,
					bytesTransferred: 10240,
					errors: 0,
				};
				stats.value.deviceStats.device1 = {
					deviceName: 'Test',
					totalSyncs: 10,
					recordsSynced: 100,
					bytesTransferred: 10240,
					lastSeen: new Date().toISOString(),
				};
				stats.value.totalRecordsSynced = 100;

				const usage = collector.estimateStorageUsage(stats.value);
				expect(usage.documentsCount).toBeGreaterThan(0);
				expect(usage.estimatedSize).toBeGreaterThan(0);
			}
		});

		it('should calculate projected costs', async () => {
			await collector.loadStats();
			const stats = await collector.getStatsSummary();

			if (Result.isSuccess(stats)) {
				stats.value.totalSyncs = 100;
				stats.value.totalRecordsSynced = 1000;
				stats.value.dailyStats['2025-01-01'] = {
					date: '2025-01-01',
					syncs: 100,
					recordsSynced: 1000,
					bytesTransferred: 0,
					errors: 0,
				};

				const costs = collector.calculateProjectedCosts(stats.value);
				expect(costs.firestoreReads).toBeGreaterThan(0);
				expect(costs.firestoreWrites).toBeGreaterThan(0);
				expect(costs.estimatedCost).toBeGreaterThanOrEqual(0);
			}
		});

		it('should get recent activity', async () => {
			const today = new Date();
			const yesterday = new Date(today);
			yesterday.setDate(yesterday.getDate() - 1);

			await collector.recordSync({ success: true }, 'device1', 'Test', 0);

			// Manually add yesterday's data
			const stats = await collector.getStatsSummary();
			if (Result.isSuccess(stats)) {
				stats.value.dailyStats[yesterday.toISOString().split('T')[0]] = {
					date: yesterday.toISOString().split('T')[0],
					syncs: 5,
					recordsSynced: 50,
					bytesTransferred: 5000,
					errors: 1,
				};
				await collector.saveStats();
			}

			const recent = collector.getRecentActivity(7);
			expect(recent.length).toBeGreaterThanOrEqual(1);
			expect(recent[0]?.date).toBe(today.toISOString().split('T')[0]);
		});
	});
}
