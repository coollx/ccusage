/**
 * @fileoverview Conflict resolution system for cloud sync
 *
 * Implements last-write-wins with version vectors to handle concurrent updates
 * from multiple devices, ensuring data consistency across the system.
 */

import type { ISOTimestamp } from '../_types.ts';
import type {
	DeviceUsageDocument,
} from './_types.ts';
import { Result } from '@praha/byethrow';
import { createISOTimestamp } from '../_types.ts';
import { logger } from '../logger.ts';

/**
 * Version vector for tracking document versions across devices
 * Maps device ID to version number
 */
export type VersionVector = Record<string, number>;

/**
 * Versioned document with conflict tracking
 */
export type VersionedDocument<T> = {
	/** The actual document data */
	data: T;
	/** Version vector tracking updates from each device */
	versionVector: VersionVector;
	/** Last modification timestamp */
	lastModified: ISOTimestamp;
	/** Device that made the last modification */
	lastModifiedBy: string;
	/** Document revision number (increments on each update) */
	revision: number;
};

/**
 * Conflict detection result
 */
export type ConflictDetectionResult = {
	hasConflict: boolean;
	conflictType?: 'concurrent_update' | 'version_divergence' | 'data_inconsistency';
	conflictingDevices?: string[];
	resolutionStrategy?: 'last_write_wins' | 'merge' | 'manual';
};

/**
 * Conflict resolution result
 */
export type ConflictResolutionResult<T> = {
	resolved: boolean;
	resolvedDocument?: VersionedDocument<T>;
	conflicts?: ConflictInfo[];
	requiresManualResolution?: boolean;
};

/**
 * Information about a detected conflict
 */
export type ConflictInfo = {
	field: string;
	localValue: unknown;
	remoteValue: unknown;
	localDevice: string;
	remoteDevice: string;
	localTimestamp: ISOTimestamp;
	remoteTimestamp: ISOTimestamp;
};

/**
 * Conflict resolution strategies
 */
export enum ResolutionStrategy {
	/** Always use the most recent write */
	LAST_WRITE_WINS = 'last_write_wins',
	/** Merge non-conflicting changes */
	MERGE = 'merge',
	/** Require manual intervention */
	MANUAL = 'manual',
	/** Use the document with higher total values (for aggregations) */
	HIGHER_VALUE = 'higher_value',
}

/**
 * Conflict resolver for versioned documents
 */
export class ConflictResolver {
	/**
	 * Compare version vectors to detect conflicts
	 */
	static compareVersionVectors(
		v1: VersionVector,
		v2: VersionVector,
	): 'equal' | 'v1_newer' | 'v2_newer' | 'concurrent' {
		const allDevices = new Set([...Object.keys(v1), ...Object.keys(v2)]);

		let v1HasHigher = false;
		let v2HasHigher = false;

		for (const device of allDevices) {
			const v1Version = v1[device] ?? 0;
			const v2Version = v2[device] ?? 0;

			if (v1Version > v2Version) {
				v1HasHigher = true;
			}
			else if (v2Version > v1Version) {
				v2HasHigher = true;
			}
		}

		if (v1HasHigher && v2HasHigher) {
			return 'concurrent';
		}
		else if (v1HasHigher) {
			return 'v1_newer';
		}
		else if (v2HasHigher) {
			return 'v2_newer';
		}
		else {
			return 'equal';
		}
	}

	/**
	 * Detect conflicts between two versioned documents
	 */
	static detectConflict<T>(
		local: VersionedDocument<T>,
		remote: VersionedDocument<T>,
	): ConflictDetectionResult {
		const vectorComparison = this.compareVersionVectors(
			local.versionVector,
			remote.versionVector,
		);

		if (vectorComparison === 'equal') {
			return { hasConflict: false };
		}

		if (vectorComparison === 'concurrent') {
			// Concurrent updates detected
			const conflictingDevices = this.getConflictingDevices(
				local.versionVector,
				remote.versionVector,
			);

			return {
				hasConflict: true,
				conflictType: 'concurrent_update',
				conflictingDevices,
				resolutionStrategy: 'last_write_wins',
			};
		}

		// Check for version divergence
		if (Math.abs(local.revision - remote.revision) > 1) {
			return {
				hasConflict: true,
				conflictType: 'version_divergence',
				resolutionStrategy: 'last_write_wins',
			};
		}

		return { hasConflict: false };
	}

	/**
	 * Get list of devices involved in concurrent updates
	 */
	private static getConflictingDevices(
		v1: VersionVector,
		v2: VersionVector,
	): string[] {
		const conflicting: string[] = [];
		const allDevices = new Set([...Object.keys(v1), ...Object.keys(v2)]);

		for (const device of allDevices) {
			const v1Version = v1[device] ?? 0;
			const v2Version = v2[device] ?? 0;

			if (v1Version !== v2Version) {
				conflicting.push(device);
			}
		}

		return conflicting;
	}

	/**
	 * Resolve conflicts using last-write-wins strategy
	 */
	static resolveLastWriteWins<T>(
		local: VersionedDocument<T>,
		remote: VersionedDocument<T>,
	): ConflictResolutionResult<T> {
		const localTime = new Date(local.lastModified).getTime();
		const remoteTime = new Date(remote.lastModified).getTime();

		const winner = localTime >= remoteTime ? local : remote;

		// Merge version vectors
		const mergedVector = this.mergeVersionVectors(
			local.versionVector,
			remote.versionVector,
		);

		const resolved: VersionedDocument<T> = {
			...winner,
			versionVector: mergedVector,
			revision: Math.max(local.revision, remote.revision) + 1,
		};

		return {
			resolved: true,
			resolvedDocument: resolved,
		};
	}

	/**
	 * Merge version vectors taking the maximum version for each device
	 */
	static mergeVersionVectors(v1: VersionVector, v2: VersionVector): VersionVector {
		const merged: VersionVector = {};
		const allDevices = new Set([...Object.keys(v1), ...Object.keys(v2)]);

		for (const device of allDevices) {
			merged[device] = Math.max(v1[device] ?? 0, v2[device] ?? 0);
		}

		return merged;
	}

	/**
	 * Resolve conflicts for device usage documents
	 */
	static resolveDeviceUsageConflict(
		local: VersionedDocument<DeviceUsageDocument>,
		remote: VersionedDocument<DeviceUsageDocument>,
		strategy: ResolutionStrategy = ResolutionStrategy.LAST_WRITE_WINS,
	): ConflictResolutionResult<DeviceUsageDocument> {
		const detection = this.detectConflict(local, remote);

		if (!detection.hasConflict) {
			return { resolved: true, resolvedDocument: local };
		}

		switch (strategy) {
			case ResolutionStrategy.LAST_WRITE_WINS:
				return this.resolveLastWriteWins(local, remote);

			case ResolutionStrategy.HIGHER_VALUE: {
				// Choose document with higher total cost (likely more complete)
				const winner = local.data.totalCost >= remote.data.totalCost ? local : remote;
				return {
					resolved: true,
					resolvedDocument: {
						...winner,
						versionVector: this.mergeVersionVectors(
							local.versionVector,
							remote.versionVector,
						),
						revision: Math.max(local.revision, remote.revision) + 1,
					},
				};
			}

			case ResolutionStrategy.MERGE:
				// Merge strategy for usage documents
				return this.mergeDeviceUsageDocuments(local, remote);

			case ResolutionStrategy.MANUAL:
				return {
					resolved: false,
					requiresManualResolution: true,
					conflicts: this.extractConflicts(local, remote),
				};

			default:
				// This should be unreachable but TypeScript needs it
				return {
					resolved: false,
					requiresManualResolution: true,
					conflicts: this.extractConflicts(local, remote),
				};
		}
	}

	/**
	 * Merge device usage documents by combining values
	 */
	private static mergeDeviceUsageDocuments(
		local: VersionedDocument<DeviceUsageDocument>,
		remote: VersionedDocument<DeviceUsageDocument>,
	): ConflictResolutionResult<DeviceUsageDocument> {
		// For usage data, we typically want to take the maximum values
		// as they represent cumulative usage
		const merged: DeviceUsageDocument = {
			date: local.data.date,
			deviceName: local.data.deviceName,
			totalCost: Math.max(local.data.totalCost, remote.data.totalCost),
			totalTokens: Math.max(local.data.totalTokens, remote.data.totalTokens),
			inputTokens: Math.max(local.data.inputTokens, remote.data.inputTokens),
			outputTokens: Math.max(local.data.outputTokens, remote.data.outputTokens),
			cachedTokens: Math.max(local.data.cachedTokens, remote.data.cachedTokens),
			models: this.mergeModelBreakdowns(local.data.models, remote.data.models),
			lastUpdated: local.data.lastUpdated > remote.data.lastUpdated
				? local.data.lastUpdated
				: remote.data.lastUpdated,
		};

		return {
			resolved: true,
			resolvedDocument: {
				data: merged,
				versionVector: this.mergeVersionVectors(
					local.versionVector,
					remote.versionVector,
				),
				lastModified: createISOTimestamp(new Date().toISOString()),
				lastModifiedBy: 'conflict-resolver',
				revision: Math.max(local.revision, remote.revision) + 1,
			},
		};
	}

	/**
	 * Merge model breakdowns from two documents
	 */
	private static mergeModelBreakdowns(
		models1: any[],
		models2: any[],
	): any[] {
		const modelMap = new Map<string, any>();

		// Add all models from first document
		for (const model of models1) {
			const key: string = (model.model ?? model.modelName) as string;
			modelMap.set(key, { ...model });
		}

		// Merge or add models from second document
		for (const model of models2) {
			const key: string = (model.model ?? model.modelName) as string;
			if (modelMap.has(key)) {
				const existing = modelMap.get(key)!;
				// Take maximum values for each field
				modelMap.set(key, {
					...existing,
					cost: Math.max((existing.cost as number) ?? 0, (model.cost as number) ?? 0),
					tokens: Math.max((existing.tokens as number) ?? 0, (model.tokens as number) ?? 0),
					inputTokens: Math.max((existing.inputTokens as number) ?? 0, (model.inputTokens as number) ?? 0),
					outputTokens: Math.max((existing.outputTokens as number) ?? 0, (model.outputTokens as number) ?? 0),
					cachedTokens: Math.max((existing.cachedTokens as number) ?? 0, (model.cachedTokens as number) ?? 0),
				});
			}
			else {
				modelMap.set(key, { ...model });
			}
		}

		return Array.from(modelMap.values());
	}

	/**
	 * Extract detailed conflict information for manual resolution
	 */
	private static extractConflicts<T>(
		local: VersionedDocument<T>,
		remote: VersionedDocument<T>,
	): ConflictInfo[] {
		const conflicts: ConflictInfo[] = [];
		const localData = local.data as Record<string, unknown>;
		const remoteData = remote.data as Record<string, unknown>;

		// Compare all fields
		const allKeys = new Set([
			...Object.keys(localData),
			...Object.keys(remoteData),
		]);

		for (const key of allKeys) {
			if (localData[key] !== remoteData[key]) {
				conflicts.push({
					field: key,
					localValue: localData[key],
					remoteValue: remoteData[key],
					localDevice: local.lastModifiedBy,
					remoteDevice: remote.lastModifiedBy,
					localTimestamp: local.lastModified,
					remoteTimestamp: remote.lastModified,
				});
			}
		}

		return conflicts;
	}

	/**
	 * Create initial version vector for a new document
	 */
	static createInitialVersionVector(deviceId: string): VersionVector {
		return { [deviceId]: 1 };
	}

	/**
	 * Increment version for a device in the version vector
	 */
	static incrementVersion(
		vector: VersionVector,
		deviceId: string,
	): VersionVector {
		return {
			...vector,
			[deviceId]: (vector[deviceId] ?? 0) + 1,
		};
	}
}

/**
 * Conflict resolution queue for handling conflicts that require manual intervention
 */
export class ConflictQueue {
	private queue: Array<{
		id: string;
		documentPath: string;
		conflicts: ConflictInfo[];
		localDocument: VersionedDocument<unknown>;
		remoteDocument: VersionedDocument<unknown>;
		detectedAt: ISOTimestamp;
		status: 'pending' | 'resolved' | 'ignored';
	}> = [];

	/**
	 * Add a conflict to the queue
	 */
	addConflict(
		documentPath: string,
		conflicts: ConflictInfo[],
		local: VersionedDocument<unknown>,
		remote: VersionedDocument<unknown>,
	): string {
		const id = `conflict-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

		this.queue.push({
			id,
			documentPath,
			conflicts,
			localDocument: local,
			remoteDocument: remote,
			detectedAt: createISOTimestamp(new Date().toISOString()),
			status: 'pending',
		});

		logger.warn(`Conflict detected for ${documentPath}, added to queue: ${id}`);
		return id;
	}

	/**
	 * Get pending conflicts
	 */
	getPendingConflicts() {
		return this.queue.filter(c => c.status === 'pending');
	}

	/**
	 * Resolve a conflict manually
	 */
	resolveConflict(
		conflictId: string,
		resolution: 'use_local' | 'use_remote' | 'custom',
		customDocument?: VersionedDocument<unknown>,
	): Result<void, Error> {
		const conflict = this.queue.find(c => c.id === conflictId);

		if (conflict == null) {
			return Result.fail(new Error(`Conflict ${conflictId} not found`));
		}

		if (conflict.status !== 'pending') {
			return Result.fail(new Error(`Conflict ${conflictId} already ${conflict.status}`));
		}

		// Mark as resolved
		conflict.status = 'resolved';

		// Log resolution
		logger.info(`Conflict ${conflictId} resolved using ${resolution} strategy`);

		return Result.succeed(undefined);
	}

	/**
	 * Get conflict statistics
	 */
	getStatistics(): {
		total: number;
		pending: number;
		resolved: number;
		ignored: number;
		oldestPending: ISOTimestamp | undefined;
	} {
		const pending = this.queue.filter(c => c.status === 'pending').length;
		const resolved = this.queue.filter(c => c.status === 'resolved').length;
		const ignored = this.queue.filter(c => c.status === 'ignored').length;

		return {
			total: this.queue.length,
			pending,
			resolved,
			ignored,
			oldestPending: this.queue
				.filter(c => c.status === 'pending')
				.sort((a, b) => a.detectedAt.localeCompare(b.detectedAt))[0]
				?.detectedAt,
		};
	}

	/**
	 * Clear resolved conflicts older than specified days
	 */
	cleanupOldConflicts(daysToKeep: number = 7): number {
		const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
		const before = this.queue.length;

		this.queue = this.queue.filter((c) => {
			if (c.status === 'pending') {
				return true;
			} // Always keep pending
			const conflictTime = new Date(c.detectedAt).getTime();
			return conflictTime > cutoffTime;
		});

		return before - this.queue.length;
	}
}

if (import.meta.vitest != null) {
	const { describe, it, expect, beforeEach } = import.meta.vitest;

	describe('conflict resolution', () => {
		describe('version vector comparison', () => {
			it('should detect equal vectors', () => {
				const v1 = { device1: 1, device2: 2 };
				const v2 = { device1: 1, device2: 2 };

				const result = ConflictResolver.compareVersionVectors(v1, v2);
				expect(result).toBe('equal');
			});

			it('should detect v1 is newer', () => {
				const v1 = { device1: 2, device2: 2 };
				const v2 = { device1: 1, device2: 2 };

				const result = ConflictResolver.compareVersionVectors(v1, v2);
				expect(result).toBe('v1_newer');
			});

			it('should detect v2 is newer', () => {
				const v1 = { device1: 1, device2: 2 };
				const v2 = { device1: 2, device2: 2 };

				const result = ConflictResolver.compareVersionVectors(v1, v2);
				expect(result).toBe('v2_newer');
			});

			it('should detect concurrent updates', () => {
				const v1 = { device1: 2, device2: 1 };
				const v2 = { device1: 1, device2: 2 };

				const result = ConflictResolver.compareVersionVectors(v1, v2);
				expect(result).toBe('concurrent');
			});
		});

		describe('conflict detection', () => {
			it('should detect no conflict for identical versions', () => {
				const doc1: VersionedDocument<any> = {
					data: { value: 1 },
					versionVector: { device1: 1 },
					lastModified: createISOTimestamp('2025-01-01T10:00:00Z'),
					lastModifiedBy: 'device1',
					revision: 1,
				};

				const doc2: VersionedDocument<any> = {
					data: { value: 1 },
					versionVector: { device1: 1 },
					lastModified: createISOTimestamp('2025-01-01T10:00:00Z'),
					lastModifiedBy: 'device1',
					revision: 1,
				};

				const result = ConflictResolver.detectConflict(doc1, doc2);
				expect(result.hasConflict).toBe(false);
			});

			it('should detect concurrent update conflict', () => {
				const doc1: VersionedDocument<any> = {
					data: { value: 1 },
					versionVector: { device1: 2, device2: 1 },
					lastModified: createISOTimestamp('2025-01-01T10:00:00Z'),
					lastModifiedBy: 'device1',
					revision: 3,
				};

				const doc2: VersionedDocument<any> = {
					data: { value: 2 },
					versionVector: { device1: 1, device2: 2 },
					lastModified: createISOTimestamp('2025-01-01T10:00:00Z'),
					lastModifiedBy: 'device2',
					revision: 3,
				};

				const result = ConflictResolver.detectConflict(doc1, doc2);
				expect(result.hasConflict).toBe(true);
				expect(result.conflictType).toBe('concurrent_update');
				expect(result.conflictingDevices).toContain('device1');
				expect(result.conflictingDevices).toContain('device2');
			});
		});

		describe('conflict resolution', () => {
			it('should resolve using last-write-wins', () => {
				const doc1: VersionedDocument<any> = {
					data: { value: 1 },
					versionVector: { device1: 2 },
					lastModified: createISOTimestamp('2025-01-01T10:00:00Z'),
					lastModifiedBy: 'device1',
					revision: 2,
				};

				const doc2: VersionedDocument<any> = {
					data: { value: 2 },
					versionVector: { device2: 1 },
					lastModified: createISOTimestamp('2025-01-01T11:00:00Z'),
					lastModifiedBy: 'device2',
					revision: 1,
				};

				const result = ConflictResolver.resolveLastWriteWins(doc1, doc2);
				expect(result.resolved).toBe(true);
				expect(result.resolvedDocument?.data.value).toBe(2); // doc2 is newer
				expect(result.resolvedDocument?.versionVector).toEqual({
					device1: 2,
					device2: 1,
				});
			});

			it('should merge version vectors correctly', () => {
				const v1 = { device1: 2, device2: 1, device3: 3 };
				const v2 = { device1: 1, device2: 3, device4: 1 };

				const merged = ConflictResolver.mergeVersionVectors(v1, v2);

				expect(merged).toEqual({
					device1: 2,
					device2: 3,
					device3: 3,
					device4: 1,
				});
			});
		});

		describe('device usage conflict resolution', () => {
			it('should merge device usage documents', () => {
				const doc1: VersionedDocument<DeviceUsageDocument> = {
					data: {
						date: '2025-01-01',
						deviceName: 'device1',
						totalCost: 10,
						totalTokens: 1000,
						inputTokens: 800,
						outputTokens: 200,
						cachedTokens: 0,
						models: [{
							model: 'claude-sonnet-4',
							cost: 10,
							tokens: 1000,
						}],
						lastUpdated: createISOTimestamp('2025-01-01T10:00:00Z'),
					},
					versionVector: { device1: 1 },
					lastModified: createISOTimestamp('2025-01-01T10:00:00Z'),
					lastModifiedBy: 'device1',
					revision: 1,
				};

				const doc2: VersionedDocument<DeviceUsageDocument> = {
					data: {
						date: '2025-01-01',
						deviceName: 'device1',
						totalCost: 15,
						totalTokens: 1500,
						inputTokens: 1200,
						outputTokens: 300,
						cachedTokens: 0,
						models: [{
							model: 'claude-sonnet-4',
							cost: 15,
							tokens: 1500,
						}],
						lastUpdated: createISOTimestamp('2025-01-01T11:00:00Z'),
					},
					versionVector: { device2: 1 },
					lastModified: createISOTimestamp('2025-01-01T11:00:00Z'),
					lastModifiedBy: 'device2',
					revision: 1,
				};

				const result = ConflictResolver.resolveDeviceUsageConflict(
					doc1,
					doc2,
					ResolutionStrategy.MERGE,
				);

				expect(result.resolved).toBe(true);
				expect(result.resolvedDocument?.data.totalCost).toBe(15); // Max value
				expect(result.resolvedDocument?.data.totalTokens).toBe(1500); // Max value
			});
		});

		describe('conflict queue', () => {
			let queue: ConflictQueue;

			beforeEach(() => {
				queue = new ConflictQueue();
			});

			it('should add conflicts to queue', () => {
				const doc1: VersionedDocument<any> = {
					data: { value: 1 },
					versionVector: { device1: 1 },
					lastModified: createISOTimestamp('2025-01-01T10:00:00Z'),
					lastModifiedBy: 'device1',
					revision: 1,
				};

				const doc2: VersionedDocument<any> = {
					data: { value: 2 },
					versionVector: { device2: 1 },
					lastModified: createISOTimestamp('2025-01-01T11:00:00Z'),
					lastModifiedBy: 'device2',
					revision: 1,
				};

				const conflicts: ConflictInfo[] = [{
					field: 'value',
					localValue: 1,
					remoteValue: 2,
					localDevice: 'device1',
					remoteDevice: 'device2',
					localTimestamp: createISOTimestamp('2025-01-01T10:00:00Z'),
					remoteTimestamp: createISOTimestamp('2025-01-01T11:00:00Z'),
				}];

				const id = queue.addConflict('/test/doc', conflicts, doc1, doc2);

				expect(id).toBeTruthy();
				expect(queue.getPendingConflicts()).toHaveLength(1);
			});

			it('should resolve conflicts', () => {
				const doc1: VersionedDocument<any> = {
					data: { value: 1 },
					versionVector: { device1: 1 },
					lastModified: createISOTimestamp('2025-01-01T10:00:00Z'),
					lastModifiedBy: 'device1',
					revision: 1,
				};

				const doc2: VersionedDocument<any> = {
					data: { value: 2 },
					versionVector: { device2: 1 },
					lastModified: createISOTimestamp('2025-01-01T11:00:00Z'),
					lastModifiedBy: 'device2',
					revision: 1,
				};

				const id = queue.addConflict('/test/doc', [], doc1, doc2);
				const result = queue.resolveConflict(id, 'use_local');

				expect(Result.isSuccess(result)).toBe(true);
				expect(queue.getPendingConflicts()).toHaveLength(0);
			});

			it('should provide statistics', () => {
				const doc: VersionedDocument<any> = {
					data: {},
					versionVector: {},
					lastModified: createISOTimestamp('2025-01-01T10:00:00Z'),
					lastModifiedBy: 'device1',
					revision: 1,
				};

				queue.addConflict('/test/doc1', [], doc, doc);
				queue.addConflict('/test/doc2', [], doc, doc);
				const id = queue.addConflict('/test/doc3', [], doc, doc);
				queue.resolveConflict(id, 'use_local');

				const stats = queue.getStatistics();
				expect(stats.total).toBe(3);
				expect(stats.pending).toBe(2);
				expect(stats.resolved).toBe(1);
			});
		});
	});
}
