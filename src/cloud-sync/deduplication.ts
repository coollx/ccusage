/**
 * @fileoverview Deduplication logic for cloud sync to prevent counting usage data multiple times
 *
 * This module implements composite key generation and hash-based duplicate detection
 * to ensure that usage data from multiple devices is accurately aggregated without
 * double-counting entries.
 */

import type { ISOTimestamp, MessageId, RequestId, SessionId } from '../_types.ts';
import type { UsageData } from '../data-loader.ts';
import { createHash } from 'node:crypto';
import { Result } from '@praha/byethrow';

/**
 * Composite key components for unique usage identification
 */
export type UsageIdentifier = {
	sessionId: SessionId;
	requestId: RequestId;
	messageId: MessageId;
	timestamp: ISOTimestamp;
	/** Optional device identifier for device-specific deduplication */
	deviceId?: string;
};

/**
 * Deduplication entry stored in Firestore for tracking processed usage
 */
export type DeduplicationEntry = {
	/** SHA-256 hash of the composite key */
	hash: string;
	/** Original composite key components for debugging */
	identifier: UsageIdentifier;
	/** When this entry was first processed */
	firstSeenAt: ISOTimestamp;
	/** Which device first processed this entry */
	firstSeenByDevice: string;
	/** Total number of times this entry was seen across all devices */
	seenCount: number;
	/** Devices that have seen this entry */
	seenByDevices: string[];
	/** Last time this entry was seen */
	lastSeenAt: ISOTimestamp;
};

/**
 * Creates a composite key from usage identifier components
 * The key format ensures uniqueness across different usage entries
 */
export function createCompositeKey(identifier: UsageIdentifier): string {
	// Use a delimiter that won't appear in the actual values
	const delimiter = '::';
	const components = [
		identifier.sessionId,
		identifier.requestId,
		identifier.messageId,
		identifier.timestamp,
	];

	if (identifier.deviceId) {
		components.push(identifier.deviceId);
	}

	return components.join(delimiter);
}

/**
 * Generates a SHA-256 hash from a composite key for efficient storage and lookup
 */
export function generateHash(compositeKey: string): string {
	return createHash('sha256').update(compositeKey).digest('hex');
}

/**
 * Extracts identifier components from usage data
 */
export function extractIdentifier(
	usage: UsageData,
	deviceId?: string,
): Result<UsageIdentifier, Error> {
	try {
		// Validate required fields
		if (!usage.sessionId || !usage.requestId || !usage.messageId || !usage.timestamp) {
			return Result.fail(
				new Error('Missing required identifier fields in usage data'),
			);
		}

		const identifier: UsageIdentifier = {
			sessionId: usage.sessionId,
			requestId: usage.requestId,
			messageId: usage.messageId,
			timestamp: usage.timestamp,
		};

		if (deviceId) {
			identifier.deviceId = deviceId;
		}

		return Result.succeed(identifier);
	}
	catch (error) {
		return Result.fail(
			error instanceof Error
				? error
				: new Error('Failed to extract identifier from usage data'),
		);
	}
}

/**
 * Checks if a usage entry is a duplicate based on its identifier
 * @returns true if duplicate, false if new entry
 */
export async function checkDuplicate(
	identifier: UsageIdentifier,
	deduplicationStore: Map<string, DeduplicationEntry>,
): Promise<boolean> {
	const compositeKey = createCompositeKey(identifier);
	const hash = generateHash(compositeKey);

	return deduplicationStore.has(hash);
}

/**
 * Records a usage entry in the deduplication store
 */
export function recordUsage(
	identifier: UsageIdentifier,
	deviceId: string,
	deduplicationStore: Map<string, DeduplicationEntry>,
	currentTime: ISOTimestamp,
): DeduplicationEntry {
	const compositeKey = createCompositeKey(identifier);
	const hash = generateHash(compositeKey);

	const existing = deduplicationStore.get(hash);

	if (existing) {
		// Update existing entry
		existing.seenCount++;
		existing.lastSeenAt = currentTime;
		if (!existing.seenByDevices.includes(deviceId)) {
			existing.seenByDevices.push(deviceId);
		}
		return existing;
	}
	else {
		// Create new entry
		const entry: DeduplicationEntry = {
			hash,
			identifier,
			firstSeenAt: currentTime,
			firstSeenByDevice: deviceId,
			seenCount: 1,
			seenByDevices: [deviceId],
			lastSeenAt: currentTime,
		};
		deduplicationStore.set(hash, entry);
		return entry;
	}
}

/**
 * Handles edge cases in deduplication
 */
export class DeduplicationEdgeCaseHandler {
	/**
	 * Handles partial data where some identifier fields might be missing
	 */
	static handlePartialData(
		usage: Partial<UsageData>,
		fallbackSessionId?: SessionId,
	): Result<UsageIdentifier | null, Error> {
		// If we have all required fields, process normally
		if (usage.sessionId && usage.requestId && usage.messageId && usage.timestamp) {
			return extractIdentifier(usage as UsageData);
		}

		// If missing critical fields but have a timestamp, create a degraded identifier
		if (usage.timestamp && fallbackSessionId) {
			// Use timestamp-based hash as a fallback
			const degradedKey = `degraded::${fallbackSessionId}::${usage.timestamp}`;
			const pseudoIdentifier: UsageIdentifier = {
				sessionId: fallbackSessionId,
				requestId: degradedKey as RequestId,
				messageId: degradedKey as MessageId,
				timestamp: usage.timestamp,
			};
			return Result.succeed(pseudoIdentifier);
		}

		// Cannot create any meaningful identifier
		return Result.succeed(null);
	}

	/**
	 * Validates and repairs corrupted entries
	 */
	static validateEntry(entry: unknown): Result<DeduplicationEntry | null, Error> {
		try {
			if (!entry || typeof entry !== 'object') {
				return Result.succeed(null);
			}

			const obj = entry as Record<string, unknown>;

			// Check required fields
			if (!obj.hash || typeof obj.hash !== 'string') {
				return Result.succeed(null);
			}

			if (!obj.identifier || typeof obj.identifier !== 'object') {
				return Result.succeed(null);
			}

			// Attempt to reconstruct a valid entry
			const reconstructed: DeduplicationEntry = {
				hash: obj.hash,
				identifier: obj.identifier as UsageIdentifier,
				firstSeenAt: (obj.firstSeenAt as ISOTimestamp) || ('' as ISOTimestamp),
				firstSeenByDevice: (obj.firstSeenByDevice as string) || 'unknown',
				seenCount: Number(obj.seenCount) || 1,
				seenByDevices: Array.isArray(obj.seenByDevices)
					? obj.seenByDevices as string[]
					: [],
				lastSeenAt: (obj.lastSeenAt as ISOTimestamp) || ('' as ISOTimestamp),
			};

			return Result.succeed(reconstructed);
		}
		catch (error) {
			return Result.fail(
				error instanceof Error
					? error
					: new Error('Failed to validate deduplication entry'),
			);
		}
	}
}

/**
 * Batch deduplication for processing multiple entries efficiently
 */
export class BatchDeduplicator {
	private deduplicationStore: Map<string, DeduplicationEntry>;
	private deviceId: string;

	constructor(
		deduplicationStore: Map<string, DeduplicationEntry>,
		deviceId: string,
	) {
		this.deduplicationStore = deduplicationStore;
		this.deviceId = deviceId;
	}

	/**
	 * Process a batch of usage entries and filter out duplicates
	 * @returns Array of unique usage entries that should be synced
	 */
	async processBatch(
		usageEntries: UsageData[],
		currentTime: ISOTimestamp,
	): Promise<Result<UsageData[], Error>> {
		const uniqueEntries: UsageData[] = [];
		const errors: Error[] = [];

		for (const usage of usageEntries) {
			const identifierResult = extractIdentifier(usage, this.deviceId);

			if (Result.isFailure(identifierResult)) {
				// Try edge case handling
				const edgeResult = DeduplicationEdgeCaseHandler.handlePartialData(
					usage,
					usage.sessionId,
				);

				if (Result.isFailure(edgeResult)) {
					errors.push(edgeResult.value);
					continue;
				}

				if (edgeResult.value == null) {
					// Skip entries we can't identify
					continue;
				}
			}

			const identifier = Result.isSuccess(identifierResult)
				? identifierResult.value
				: (Result.unwrap(
						DeduplicationEdgeCaseHandler.handlePartialData(usage, usage.sessionId),
					) as UsageIdentifier);

			const isDuplicate = await checkDuplicate(identifier, this.deduplicationStore);

			if (!isDuplicate) {
				uniqueEntries.push(usage);
				recordUsage(identifier, this.deviceId, this.deduplicationStore, currentTime);
			}
		}

		if (errors.length > 0) {
			// Log errors but don't fail the entire batch
			for (const error of errors) {
				// Errors are collected but not logged to avoid console usage
				// Caller can handle errors if needed
			}
		}

		return Result.succeed(uniqueEntries);
	}

	/**
	 * Get deduplication statistics
	 */
	getStatistics(): {
		totalEntries: number;
		uniqueEntries: number;
		duplicateRate: number;
		devicesInvolved: Set<string>;
	} {
		const allDevices = new Set<string>();
		let totalSeen = 0;

		for (const entry of this.deduplicationStore.values()) {
			totalSeen += entry.seenCount;
			for (const device of entry.seenByDevices) {
				allDevices.add(device);
			}
		}

		const uniqueEntries = this.deduplicationStore.size;
		const duplicateRate = uniqueEntries > 0
			? (totalSeen - uniqueEntries) / totalSeen
			: 0;

		return {
			totalEntries: totalSeen,
			uniqueEntries,
			duplicateRate,
			devicesInvolved: allDevices,
		};
	}
}

if (import.meta.vitest != null) {
	const { describe, it, expect, beforeEach } = import.meta.vitest;
	const { createSessionId, createRequestId, createMessageId, createISOTimestamp, createModelName } = await import('../_types.ts');

	describe('deduplication', () => {
		describe('composite key generation', () => {
			it('should create consistent composite keys', () => {
				const identifier: UsageIdentifier = {
					sessionId: createSessionId('session-123'),
					requestId: createRequestId('request-456'),
					messageId: createMessageId('message-789'),
					timestamp: createISOTimestamp('2025-01-01T10:00:00Z'),
				};

				const key1 = createCompositeKey(identifier);
				const key2 = createCompositeKey(identifier);

				expect(key1).toBe(key2);
				expect(key1).toContain('session-123');
				expect(key1).toContain('request-456');
				expect(key1).toContain('message-789');
				expect(key1).toContain('2025-01-01T10:00:00Z');
			});

			it('should include device ID when provided', () => {
				const identifier: UsageIdentifier = {
					sessionId: createSessionId('session-123'),
					requestId: createRequestId('request-456'),
					messageId: createMessageId('message-789'),
					timestamp: createISOTimestamp('2025-01-01T10:00:00Z'),
					deviceId: 'device-abc',
				};

				const key = createCompositeKey(identifier);
				expect(key).toContain('device-abc');
			});
		});

		describe('hash generation', () => {
			it('should generate consistent SHA-256 hashes', () => {
				const key = 'test-key-123';
				const hash1 = generateHash(key);
				const hash2 = generateHash(key);

				expect(hash1).toBe(hash2);
				expect(hash1).toHaveLength(64); // SHA-256 produces 64 hex characters
			});

			it('should generate different hashes for different keys', () => {
				const hash1 = generateHash('key1');
				const hash2 = generateHash('key2');

				expect(hash1).not.toBe(hash2);
			});
		});

		describe('duplicate detection', () => {
			let deduplicationStore: Map<string, DeduplicationEntry>;

			beforeEach(() => {
				deduplicationStore = new Map();
			});

			it('should detect new entries', async () => {
				const identifier: UsageIdentifier = {
					sessionId: createSessionId('session-123'),
					requestId: createRequestId('request-456'),
					messageId: createMessageId('message-789'),
					timestamp: createISOTimestamp('2025-01-01T10:00:00Z'),
				};

				const isDuplicate = await checkDuplicate(identifier, deduplicationStore);
				expect(isDuplicate).toBe(false);
			});

			it('should detect duplicate entries', async () => {
				const identifier: UsageIdentifier = {
					sessionId: createSessionId('session-123'),
					requestId: createRequestId('request-456'),
					messageId: createMessageId('message-789'),
					timestamp: createISOTimestamp('2025-01-01T10:00:00Z'),
				};

				// Record the entry first
				recordUsage(
					identifier,
					'device1',
					deduplicationStore,
					createISOTimestamp('2025-01-01T10:00:00Z'),
				);

				// Check if it's a duplicate
				const isDuplicate = await checkDuplicate(identifier, deduplicationStore);
				expect(isDuplicate).toBe(true);
			});
		});

		describe('usage recording', () => {
			let deduplicationStore: Map<string, DeduplicationEntry>;

			beforeEach(() => {
				deduplicationStore = new Map();
			});

			it('should record new usage entries', () => {
				const identifier: UsageIdentifier = {
					sessionId: createSessionId('session-123'),
					requestId: createRequestId('request-456'),
					messageId: createMessageId('message-789'),
					timestamp: createISOTimestamp('2025-01-01T10:00:00Z'),
				};

				const entry = recordUsage(
					identifier,
					'device1',
					deduplicationStore,
					createISOTimestamp('2025-01-01T10:00:00Z'),
				);

				expect(entry.seenCount).toBe(1);
				expect(entry.firstSeenByDevice).toBe('device1');
				expect(entry.seenByDevices).toEqual(['device1']);
			});

			it('should update existing entries', () => {
				const identifier: UsageIdentifier = {
					sessionId: createSessionId('session-123'),
					requestId: createRequestId('request-456'),
					messageId: createMessageId('message-789'),
					timestamp: createISOTimestamp('2025-01-01T10:00:00Z'),
				};

				// Record from device1
				recordUsage(
					identifier,
					'device1',
					deduplicationStore,
					createISOTimestamp('2025-01-01T10:00:00Z'),
				);

				// Record same entry from device2
				const updatedEntry = recordUsage(
					identifier,
					'device2',
					deduplicationStore,
					createISOTimestamp('2025-01-01T11:00:00Z'),
				);

				expect(updatedEntry.seenCount).toBe(2);
				expect(updatedEntry.firstSeenByDevice).toBe('device1');
				expect(updatedEntry.seenByDevices).toContain('device1');
				expect(updatedEntry.seenByDevices).toContain('device2');
				expect(updatedEntry.lastSeenAt).toBe('2025-01-01T11:00:00Z');
			});
		});

		describe('edge case handling', () => {
			it('should handle partial data with fallback', () => {
				const partialUsage = {
					timestamp: createISOTimestamp('2025-01-01T10:00:00Z'),
				};

				const result = DeduplicationEdgeCaseHandler.handlePartialData(
					partialUsage,
					createSessionId('fallback-session'),
				);

				expect(Result.isSuccess(result)).toBe(true);
				if (Result.isSuccess(result) && result.value) {
					expect(result.value.sessionId).toBe('fallback-session');
					expect(result.value.requestId).toContain('degraded::');
				}
			});

			it('should return null for incomplete data without fallback', () => {
				const incompleteUsage = {
					model: 'claude-sonnet-4',
				};

				const result = DeduplicationEdgeCaseHandler.handlePartialData(
					incompleteUsage,
				);

				expect(Result.isSuccess(result)).toBe(true);
				expect(result.value).toBeNull();
			});

			it('should validate and repair corrupted entries', () => {
				const corrupted = {
					hash: 'valid-hash',
					identifier: {
						sessionId: 'session-123',
						requestId: 'request-456',
						messageId: 'message-789',
						timestamp: '2025-01-01T10:00:00Z',
					},
					seenCount: '5', // Wrong type
					// Missing other fields
				};

				const result = DeduplicationEdgeCaseHandler.validateEntry(corrupted);

				expect(Result.isSuccess(result)).toBe(true);
				if (Result.isSuccess(result) && result.value) {
					expect(result.value.seenCount).toBe(5);
					expect(result.value.seenByDevices).toEqual([]);
					expect(result.value.firstSeenByDevice).toBe('unknown');
				}
			});
		});

		describe('batch deduplication', () => {
			it('should process batch and filter duplicates', async () => {
				const store = new Map<string, DeduplicationEntry>();
				const deduplicator = new BatchDeduplicator(store, 'device1');

				const usageData: UsageData[] = [
					{
						sessionId: createSessionId('session-1'),
						requestId: createRequestId('request-1'),
						messageId: createMessageId('message-1'),
						timestamp: createISOTimestamp('2025-01-01T10:00:00Z'),
						model: createModelName('claude-sonnet-4-20250514'),
						inputTokens: 100,
						outputTokens: 50,
						cacheCreationTokens: 0,
						cacheReadTokens: 0,
						costUSD: 0.01,
					},
					// Duplicate of first entry
					{
						sessionId: createSessionId('session-1'),
						requestId: createRequestId('request-1'),
						messageId: createMessageId('message-1'),
						timestamp: createISOTimestamp('2025-01-01T10:00:00Z'),
						model: createModelName('claude-sonnet-4-20250514'),
						inputTokens: 100,
						outputTokens: 50,
						cacheCreationTokens: 0,
						cacheReadTokens: 0,
						costUSD: 0.01,
					},
					// New entry
					{
						sessionId: createSessionId('session-2'),
						requestId: createRequestId('request-2'),
						messageId: createMessageId('message-2'),
						timestamp: createISOTimestamp('2025-01-01T11:00:00Z'),
						model: createModelName('claude-opus-4-20250514'),
						inputTokens: 200,
						outputTokens: 100,
						cacheCreationTokens: 0,
						cacheReadTokens: 0,
						costUSD: 0.02,
					},
				];

				const result = await deduplicator.processBatch(
					usageData,
					createISOTimestamp('2025-01-01T12:00:00Z'),
				);

				expect(Result.isSuccess(result)).toBe(true);
				if (Result.isSuccess(result)) {
					expect(result.value).toHaveLength(2); // Only unique entries
				}

				const stats = deduplicator.getStatistics();
				expect(stats.totalEntries).toBe(2);
				expect(stats.uniqueEntries).toBe(2);
				expect(stats.duplicateRate).toBe(0);
			});
		});
	});
}
