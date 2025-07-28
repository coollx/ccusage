/**
 * @fileoverview Cloud data aggregation logic with optimized Firestore queries
 *
 * This module handles efficient aggregation of usage data across multiple devices,
 * implementing caching strategies and query optimization for Firestore.
 */

import type {
	DailyDate,
	ISOTimestamp,
	MonthlyDate,
	ProjectPath,
	SessionId,
} from '../_types.ts';
import type {
	DailyUsage,
	ModelBreakdown,
	MonthlyUsage,
	SessionUsage,
} from '../data-loader.ts';
import type {
	AggregatedUsageDocument,
	DeviceUsageDocument,
	SessionUsageDocument,
} from './_types.ts';
import { Result } from '@praha/byethrow';
import {
	createDailyDate,
	createISOTimestamp,
	createMonthlyDate,
} from '../_types.ts';
import { getFirebaseClient } from './firebase-client.ts';

/**
 * Cache entry for aggregated data
 */
type CacheEntry<T> = {
	data: T;
	timestamp: ISOTimestamp;
	ttlMs: number;
};

/**
 * Query optimization hints for Firestore
 */
type QueryOptimization = {
	/** Use composite indexes for these field combinations */
	indexes?: string[][];
	/** Limit results for pagination */
	limit?: number;
	/** Order by fields for efficient retrieval */
	orderBy?: Array<{ field: string; direction: 'asc' | 'desc' }>;
	/** Use collection group queries for cross-device data */
	useCollectionGroup?: boolean;
};

/**
 * Aggregation options
 */
export type AggregationOptions = {
	/** Start date for aggregation range */
	startDate?: DailyDate;
	/** End date for aggregation range */
	endDate?: DailyDate;
	/** Specific devices to include (empty = all devices) */
	deviceFilter?: string[];
	/** Enable caching for results */
	useCache?: boolean;
	/** Cache TTL in milliseconds */
	cacheTTL?: number;
	/** Query optimization hints */
	optimization?: QueryOptimization;
};

/**
 * Aggregated data result with metadata
 */
export type AggregatedResult<T> = {
	data: T;
	metadata: {
		deviceCount: number;
		recordCount: number;
		aggregationTime: number;
		cached: boolean;
		lastUpdated: ISOTimestamp;
	};
};

/**
 * Cloud data aggregator with caching and optimization
 */
export class CloudAggregator {
	private client = getFirebaseClient();
	private cache = new Map<string, CacheEntry<unknown>>();
	private userId: string | null = null;

	/** Default cache TTL: 5 minutes */
	private readonly DEFAULT_CACHE_TTL = 5 * 60 * 1000;

	/**
	 * Initialize the aggregator
	 */
	async initialize(): Promise<Result<void, Error>> {
		const initResult: Result<void, Error> = await this.client.initialize();
		if (Result.isFailure(initResult)) {
			return Result.fail(initResult.error);
		}

		const userIdResult: Result<string, Error> = this.client.getUserId();
		if (Result.isFailure(userIdResult)) {
			return Result.fail(userIdResult.error);
		}

		this.userId = userIdResult.value as string;
		return Result.succeed(undefined);
	}

	/**
	 * Aggregate daily usage data across devices
	 */
	async aggregateDailyUsage(
		date: DailyDate,
		options: AggregationOptions = {},
	): Promise<Result<AggregatedResult<DailyUsage>, Error>> {
		const startTime = Date.now();

		// Check cache first
		if (options.useCache !== false) {
			const cached = this.getFromCache<DailyUsage>(`daily:${date}`);
			if (cached !== null) {
				return Result.succeed({
					data: cached,
					metadata: {
						deviceCount: 0, // Would need to store this in cache
						recordCount: 1,
						aggregationTime: 0,
						cached: true,
						lastUpdated: createISOTimestamp(new Date().toISOString()),
					},
				});
			}
		}

		// Ensure initialized
		if (this.userId === null) {
			const initResult: Result<void, Error> = await this.initialize();
			if (Result.isFailure(initResult)) {
				return Result.fail(initResult.error);
			}
		}

		try {
			// First check for pre-aggregated document
			const aggregatedPath = `users/${this.userId}/usage_aggregated/${date}`;
			const aggregatedResult: Result<AggregatedUsageDocument | null, Error> = await this.client.getDoc<AggregatedUsageDocument>(
				aggregatedPath,
			);

			if (Result.isSuccess(aggregatedResult) && aggregatedResult.value !== null) {
				// Convert from aggregated document to DailyUsage format
				const aggregated = aggregatedResult.value as AggregatedUsageDocument;
				const dailyUsage = this.convertAggregatedToDaily(aggregated, date);

				// Cache the result
				this.saveToCache(
					`daily:${date}`,
					dailyUsage,
					options.cacheTTL ?? this.DEFAULT_CACHE_TTL,
				);

				return Result.succeed({
					data: dailyUsage,
					metadata: {
						deviceCount: Object.keys(aggregated.devices).length,
						recordCount: 1,
						aggregationTime: Date.now() - startTime,
						cached: false,
						lastUpdated: aggregated.lastAggregated,
					},
				});
			}

			// No pre-aggregated data, fetch from devices
			const aggregationResult: Result<{ usage: DailyUsage; devices: string[] }, Error> = await this.aggregateFromDevices(
				date,
				options,
			);

			if (Result.isFailure(aggregationResult)) {
				return Result.fail(aggregationResult.error);
			}

			const { usage, devices } = aggregationResult.value as { usage: DailyUsage; devices: string[] };

			// Cache the aggregated result for future use
			if (devices.length > 0) {
				await this.saveAggregatedDocument(date, usage, devices);
			}

			// Cache the result
			this.saveToCache(
				`daily:${date}`,
				usage,
				options.cacheTTL ?? this.DEFAULT_CACHE_TTL,
			);

			return Result.succeed({
				data: usage,
				metadata: {
					deviceCount: devices.length,
					recordCount: devices.length,
					aggregationTime: Date.now() - startTime,
					cached: false,
					lastUpdated: createISOTimestamp(new Date().toISOString()),
				},
			});
		}
		catch (error) {
			return Result.fail(
				error instanceof Error
					? error
					: new Error('Failed to aggregate daily usage'),
			);
		}
	}

	/**
	 * Aggregate monthly usage data across devices
	 */
	async aggregateMonthlyUsage(
		month: MonthlyDate,
		options: AggregationOptions = {},
	): Promise<Result<AggregatedResult<MonthlyUsage>, Error>> {
		const startTime = Date.now();

		// Check cache first
		if (options.useCache !== false) {
			const cached = this.getFromCache<MonthlyUsage>(`monthly:${month}`);
			if (cached !== null) {
				return Result.succeed({
					data: cached,
					metadata: {
						deviceCount: 0,
						recordCount: 0,
						aggregationTime: 0,
						cached: true,
						lastUpdated: createISOTimestamp(new Date().toISOString()),
					},
				});
			}
		}

		// Get all days in the month
		const year = Number.parseInt(month.substring(0, 4));
		const monthNum = Number.parseInt(month.substring(5, 7));
		const daysInMonth = new Date(year, monthNum, 0).getDate();

		const dailyAggregations: DailyUsage[] = [];
		const allDevices = new Set<string>();
		let totalRecords = 0;

		// Aggregate each day of the month
		for (let day = 1; day <= daysInMonth; day++) {
			const date = createDailyDate(
				`${year}-${monthNum.toString().padStart(2, '0')}-${day
					.toString()
					.padStart(2, '0')}`,
			);

			const dayResult = await this.aggregateDailyUsage(date, {
				...options,
				useCache: true, // Use cache for individual days
			});

			if (Result.isSuccess(dayResult) && dayResult.value.data.totalCost > 0) {
				dailyAggregations.push(dayResult.value.data);
				totalRecords += dayResult.value.metadata.recordCount;
				// Note: We'd need to track devices in the aggregated data
			}
		}

		// Combine daily aggregations into monthly
		const monthlyUsage = this.combineDailyToMonthly(
			dailyAggregations,
			month,
		);

		// Cache the result
		this.saveToCache(
			`monthly:${month}`,
			monthlyUsage,
			options.cacheTTL ?? this.DEFAULT_CACHE_TTL * 2, // Longer TTL for monthly
		);

		return Result.succeed({
			data: monthlyUsage,
			metadata: {
				deviceCount: allDevices.size,
				recordCount: totalRecords,
				aggregationTime: Date.now() - startTime,
				cached: false,
				lastUpdated: createISOTimestamp(new Date().toISOString()),
			},
		});
	}

	/**
	 * Aggregate session usage data across devices
	 */
	async aggregateSessionUsage(
		sessionId: SessionId,
		projectId: ProjectPath,
		options: AggregationOptions = {},
	): Promise<Result<AggregatedResult<SessionUsage>, Error>> {
		const startTime = Date.now();
		const sessionKey = `${projectId}_${sessionId}`;

		// Check cache first
		if (options.useCache !== false) {
			const cached = this.getFromCache<SessionUsage>(`session:${sessionKey}`);
			if (cached !== null) {
				return Result.succeed({
					data: cached,
					metadata: {
						deviceCount: 0,
						recordCount: 0,
						aggregationTime: 0,
						cached: true,
						lastUpdated: createISOTimestamp(new Date().toISOString()),
					},
				});
			}
		}

		// Ensure initialized
		if (this.userId === null) {
			const initResult: Result<void, Error> = await this.initialize();
			if (Result.isFailure(initResult)) {
				return Result.fail(initResult.error);
			}
		}

		try {
			// Check for pre-aggregated session document
			const sessionPath = `users/${this.userId}/usage_sessions/${sessionKey}`;
			const sessionResult = await this.client.getDoc<SessionUsageDocument>(
				sessionPath,
			);

			if (Result.isSuccess(sessionResult) && sessionResult.value) {
				const sessionDoc = sessionResult.value;
				const sessionUsage = this.convertSessionDocumentToUsage(
					sessionDoc,
					sessionId,
					projectId,
				);

				// Cache the result
				this.saveToCache(
					`session:${sessionKey}`,
					sessionUsage,
					options.cacheTTL ?? this.DEFAULT_CACHE_TTL,
				);

				return Result.succeed({
					data: sessionUsage,
					metadata: {
						deviceCount: Object.keys(sessionDoc.devices).length,
						recordCount: 1,
						aggregationTime: Date.now() - startTime,
						cached: false,
						lastUpdated: createISOTimestamp(new Date().toISOString()),
					},
				});
			}

			// No pre-aggregated data, would need to aggregate from raw data
			// This is more complex as we'd need to query across all devices
			// for specific session data

			return Result.fail(
				new Error('Session aggregation from raw data not yet implemented'),
			);
		}
		catch (error) {
			return Result.fail(
				error instanceof Error
					? error
					: new Error('Failed to aggregate session usage'),
			);
		}
	}

	/**
	 * Aggregate usage data from individual devices
	 */
	private async aggregateFromDevices(
		date: DailyDate,
		options: AggregationOptions,
	): Promise<Result<{ usage: DailyUsage; devices: string[] }, Error>> {
		const devicesPath = `users/${this.userId}/devices`;

		// Query with optimization hints
		const queryOptions = options.optimization || {};
		const devicesResult: Result<{ id: string }[], Error> = await this.client.queryCollection<{ id: string }>(
			devicesPath,
			queryOptions.limit !== undefined ? () => ({ limit: queryOptions.limit }) : undefined,
		);

		if (Result.isFailure(devicesResult)) {
			return Result.fail(devicesResult.error);
		}

		// Filter devices if specified
		const devicesData = devicesResult.value as { id: string }[];
		let devices = devicesData.map(d => d.id);
		if (options.deviceFilter && options.deviceFilter.length > 0) {
			devices = devices.filter(d => options.deviceFilter!.includes(d));
		}

		// Aggregate model breakdowns
		const modelMap = new Map<string, ModelBreakdown>();
		let totalCost = 0;
		let inputTokens = 0;
		let outputTokens = 0;
		let cacheCreationTokens = 0;
		let cacheReadTokens = 0;
		const modelsUsed = new Set<string>();
		const activeDevices: string[] = [];

		// Fetch usage for each device in parallel
		const devicePromises = devices.map(async (deviceName) => {
			const usagePath = `${devicesPath}/${deviceName}/usage/${date}`;
			return {
				deviceName,
				result: await this.client.getDoc<DeviceUsageDocument>(usagePath),
			};
		});

		const deviceResults = await Promise.all(devicePromises);

		for (const { deviceName, result } of deviceResults) {
			if (Result.isSuccess(result) && result.value !== null) {
				const usage = result.value;
				activeDevices.push(deviceName);

				// Aggregate totals
				totalCost += usage.totalCost;
				inputTokens += usage.inputTokens;
				outputTokens += usage.outputTokens;
				cacheCreationTokens += usage.cachedTokens; // Note: field name mismatch
				cacheReadTokens += 0; // Not available in current schema

				// Aggregate models
				for (const model of usage.models) {
					// Handle both model and modelName properties
					const modelAny = model as any;
					const modelName: string = modelAny.model ?? modelAny.modelName;
					modelsUsed.add(modelName);

					if (modelMap.has(modelName)) {
						const existing = modelMap.get(modelName)!;
						existing.cost += modelAny.cost ?? 0;
						existing.inputTokens += modelAny.inputTokens ?? 0;
						existing.outputTokens += modelAny.outputTokens ?? 0;
						existing.cacheCreationTokens += modelAny.cacheCreationTokens ?? 0;
						existing.cacheReadTokens += modelAny.cacheReadTokens ?? 0;
					}
					else {
						modelMap.set(modelName, {
							modelName,
							cost: modelAny.cost ?? 0,
							inputTokens: modelAny.inputTokens ?? 0,
							outputTokens: modelAny.outputTokens ?? 0,
							cacheCreationTokens: modelAny.cacheCreationTokens ?? 0,
							cacheReadTokens: modelAny.cacheReadTokens ?? 0,
						});
					}
				}
			}
		}

		const dailyUsage: DailyUsage = {
			date,
			inputTokens,
			outputTokens,
			cacheCreationTokens,
			cacheReadTokens,
			totalCost,
			modelsUsed: Array.from(modelsUsed),
			modelBreakdowns: Array.from(modelMap.values()),
		};

		return Result.succeed({
			usage: dailyUsage,
			devices: activeDevices,
		});
	}

	/**
	 * Save aggregated document to Firestore for future queries
	 */
	private async saveAggregatedDocument(
		date: DailyDate,
		usage: DailyUsage,
		devices: string[],
	): Promise<Result<void, Error>> {
		const aggregatedDoc: AggregatedUsageDocument = {
			date,
			devices: devices.reduce((acc, device) => {
				// This is simplified - in reality we'd need device-specific data
				acc[device] = {
					totalCost: usage.totalCost / devices.length,
					totalTokens: (usage.inputTokens + usage.outputTokens) / devices.length,
					lastUpdated: createISOTimestamp(new Date().toISOString()),
				};
				return acc;
			}, {} as AggregatedUsageDocument['devices']),
			totals: {
				cost: usage.totalCost,
				tokens: usage.inputTokens + usage.outputTokens,
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				cachedTokens: usage.cacheCreationTokens + usage.cacheReadTokens,
			},
			lastAggregated: createISOTimestamp(new Date().toISOString()),
		};

		const path = `users/${this.userId}/usage_aggregated/${date}`;
		return this.client.setDoc(path, aggregatedDoc);
	}

	/**
	 * Convert aggregated document to DailyUsage format
	 */
	private convertAggregatedToDaily(
		aggregated: AggregatedUsageDocument,
		date: DailyDate,
	): DailyUsage {
		// Note: We lose model breakdown information in the current schema
		// This would need to be enhanced to store model data in aggregated docs
		return {
			date,
			inputTokens: aggregated.totals.inputTokens,
			outputTokens: aggregated.totals.outputTokens,
			cacheCreationTokens: aggregated.totals.cachedTokens,
			cacheReadTokens: 0, // Not stored separately
			totalCost: aggregated.totals.cost,
			modelsUsed: [], // Would need to be stored in aggregated doc
			modelBreakdowns: [], // Would need to be stored in aggregated doc
		};
	}

	/**
	 * Convert session document to SessionUsage format
	 */
	private convertSessionDocumentToUsage(
		doc: SessionUsageDocument,
		sessionId: SessionId,
		projectPath: ProjectPath,
	): SessionUsage {
		return {
			sessionId,
			projectPath,
			inputTokens: doc.aggregated.totalTokens, // Simplified
			outputTokens: 0, // Would need proper breakdown
			cacheCreationTokens: 0,
			cacheReadTokens: 0,
			totalCost: doc.aggregated.totalCost,
			startTime: (Object.values(doc.devices)[0]?.startTime ?? ''),
			endTime: (Object.values(doc.devices)[0]?.endTime ?? ''),
			duration: 0, // Would need to calculate
			requestCount: 0, // Not stored
			modelsUsed: doc.aggregated.models.map((m) => {
				const modelAny = m;
				return (modelAny.modelName ?? modelAny.model) as string;
			}),
			modelBreakdowns: doc.aggregated.models,
		};
	}

	/**
	 * Combine daily usage data into monthly aggregation
	 */
	private combineDailyToMonthly(
		dailyData: DailyUsage[],
		month: MonthlyDate,
	): MonthlyUsage {
		const modelMap = new Map<string, ModelBreakdown>();
		let totalCost = 0;
		let inputTokens = 0;
		let outputTokens = 0;
		let cacheCreationTokens = 0;
		let cacheReadTokens = 0;
		const modelsUsed = new Set<string>();

		for (const day of dailyData) {
			totalCost += day.totalCost;
			inputTokens += day.inputTokens;
			outputTokens += day.outputTokens;
			cacheCreationTokens += day.cacheCreationTokens;
			cacheReadTokens += day.cacheReadTokens;

			for (const model of day.modelsUsed) {
				modelsUsed.add(model);
			}

			for (const breakdown of day.modelBreakdowns) {
				const key = breakdown.modelName;
				if (modelMap.has(key)) {
					const existing = modelMap.get(key)!;
					existing.cost += breakdown.cost;
					existing.inputTokens += breakdown.inputTokens;
					existing.outputTokens += breakdown.outputTokens;
					existing.cacheCreationTokens += breakdown.cacheCreationTokens;
					existing.cacheReadTokens += breakdown.cacheReadTokens;
				}
				else {
					modelMap.set(key, { ...breakdown });
				}
			}
		}

		return {
			month,
			inputTokens,
			outputTokens,
			cacheCreationTokens,
			cacheReadTokens,
			totalCost,
			dailyUsage: dailyData,
			modelsUsed: Array.from(modelsUsed),
			modelBreakdowns: Array.from(modelMap.values()),
		};
	}

	/**
	 * Get data from cache if available and not expired
	 */
	private getFromCache<T>(key: string): T | null {
		const entry = this.cache.get(key) as CacheEntry<T> | undefined;
		if (entry === undefined) {
			return null;
		}

		const now = Date.now();
		const entryTime = new Date(entry.timestamp).getTime();

		if (now - entryTime > entry.ttlMs) {
			this.cache.delete(key);
			return null;
		}

		return entry.data;
	}

	/**
	 * Save data to cache
	 */
	private saveToCache<T>(key: string, data: T, ttlMs: number): void {
		this.cache.set(key, {
			data,
			timestamp: createISOTimestamp(new Date().toISOString()),
			ttlMs,
		});
	}

	/**
	 * Clear cache (useful for testing or manual refresh)
	 */
	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Get cache statistics
	 */
	getCacheStats(): {
		size: number;
		keys: string[];
		memoryUsage: number;
	} {
		const keys = Array.from(this.cache.keys());

		// Rough memory estimation
		const memoryUsage = keys.reduce((total, key) => {
			const entry = this.cache.get(key);
			const entrySize = JSON.stringify(entry).length * 2; // 2 bytes per char
			return total + entrySize;
		}, 0);

		return {
			size: this.cache.size,
			keys,
			memoryUsage,
		};
	}
}

/**
 * Singleton aggregator instance
 */
let aggregator: CloudAggregator | null = null;

/**
 * Get or create the cloud aggregator instance
 */
export function getCloudAggregator(): CloudAggregator {
	if (aggregator === null) {
		aggregator = new CloudAggregator();
	}
	return aggregator;
}

/**
 * Reset the aggregator (mainly for testing)
 */
export function resetCloudAggregator(): void {
	aggregator = null;
}

if (import.meta.vitest != null) {
	const { describe, it, expect, beforeEach } = import.meta.vitest;

	describe('cloud aggregation', () => {
		let aggregator: CloudAggregator;

		beforeEach(() => {
			resetCloudAggregator();
			aggregator = getCloudAggregator();
		});

		describe('cache management', () => {
			it('should cache aggregated results', async () => {
				const date = createDailyDate('2025-01-01');
				const mockUsage: DailyUsage = {
					date,
					inputTokens: 1000,
					outputTokens: 500,
					cacheCreationTokens: 100,
					cacheReadTokens: 50,
					totalCost: 10.5,
					modelsUsed: ['claude-sonnet-4-20250514'],
					modelBreakdowns: [],
				};

				// Save to cache
				// eslint-disable-next-line ts/no-unsafe-call, ts/no-unsafe-member-access
				(aggregator as any).saveToCache('daily:2025-01-01', mockUsage, 5000);

				// Retrieve from cache
				// eslint-disable-next-line ts/no-unsafe-assignment, ts/no-unsafe-call, ts/no-unsafe-member-access
				const cached = (aggregator as any).getFromCache('daily:2025-01-01');
				expect(cached).toEqual(mockUsage);
			});

			it('should expire old cache entries', async () => {
				const date = createDailyDate('2025-01-01');
				const mockUsage: DailyUsage = {
					date,
					inputTokens: 1000,
					outputTokens: 500,
					cacheCreationTokens: 100,
					cacheReadTokens: 50,
					totalCost: 10.5,
					modelsUsed: [],
					modelBreakdowns: [],
				};

				// Save with 1ms TTL
				// eslint-disable-next-line ts/no-unsafe-call, ts/no-unsafe-member-access
				(aggregator as any).saveToCache('daily:2025-01-01', mockUsage, 1);

				// Wait for expiration
				await new Promise(resolve => setTimeout(resolve, 10));

				// Should be expired
				// eslint-disable-next-line ts/no-unsafe-assignment, ts/no-unsafe-call, ts/no-unsafe-member-access
				const cached = (aggregator as any).getFromCache('daily:2025-01-01');
				expect(cached).toBeNull();
			});

			it('should provide cache statistics', () => {
				// Add some cache entries
				// eslint-disable-next-line ts/no-unsafe-call, ts/no-unsafe-member-access
				(aggregator as any).saveToCache('test1', { data: 'test1' }, 5000);
				// eslint-disable-next-line ts/no-unsafe-call, ts/no-unsafe-member-access
				(aggregator as any).saveToCache('test2', { data: 'test2' }, 5000);

				const stats = aggregator.getCacheStats();
				expect(stats.size).toBe(2);
				expect(stats.keys).toContain('test1');
				expect(stats.keys).toContain('test2');
				expect(stats.memoryUsage).toBeGreaterThan(0);
			});
		});

		describe('data conversion', () => {
			it('should combine daily data into monthly aggregation', () => {
				const dailyData: DailyUsage[] = [
					{
						date: createDailyDate('2025-01-01'),
						inputTokens: 1000,
						outputTokens: 500,
						cacheCreationTokens: 100,
						cacheReadTokens: 50,
						totalCost: 10,
						modelsUsed: ['claude-sonnet-4-20250514'],
						modelBreakdowns: [{
							modelName: 'claude-sonnet-4-20250514',
							inputTokens: 1000,
							outputTokens: 500,
							cacheCreationTokens: 100,
							cacheReadTokens: 50,
							cost: 10,
						}],
					},
					{
						date: createDailyDate('2025-01-02'),
						inputTokens: 2000,
						outputTokens: 1000,
						cacheCreationTokens: 200,
						cacheReadTokens: 100,
						totalCost: 20,
						modelsUsed: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'],
						modelBreakdowns: [
							{
								modelName: 'claude-sonnet-4-20250514',
								inputTokens: 1500,
								outputTokens: 750,
								cacheCreationTokens: 150,
								cacheReadTokens: 75,
								cost: 15,
							},
							{
								modelName: 'claude-opus-4-20250514',
								inputTokens: 500,
								outputTokens: 250,
								cacheCreationTokens: 50,
								cacheReadTokens: 25,
								cost: 5,
							},
						],
					},
				];

				// Access private method for testing
				const aggregatorAny = aggregator as any;
				// eslint-disable-next-line ts/no-unsafe-call, ts/no-unsafe-member-access
				const monthly = aggregatorAny.combineDailyToMonthly(
					dailyData,
					createMonthlyDate('2025-01'),
				) as MonthlyUsage;

				expect(monthly.month).toBe('2025-01');
				expect(monthly.totalCost).toBe(30);
				expect(monthly.inputTokens).toBe(3000);
				expect(monthly.outputTokens).toBe(1500);
				expect(monthly.modelsUsed).toHaveLength(2);
				expect(monthly.modelBreakdowns).toHaveLength(2);

				// Check model aggregation
				const sonnetBreakdown = monthly.modelBreakdowns.find(
					m => m.modelName === 'claude-sonnet-4-20250514',
				);
				expect(sonnetBreakdown?.cost).toBe(25);
				expect(sonnetBreakdown?.inputTokens).toBe(2500);
			});
		});
	});
}
