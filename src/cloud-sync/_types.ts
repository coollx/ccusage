import type { ISOTimestamp } from '../_types.ts';
import type { ModelBreakdown } from '../data-loader.ts';
import { z } from 'zod';

/**
 * Firebase configuration schema
 */
export const firebaseConfigSchema = z.object({
	projectId: z.string().min(1),
	apiKey: z.string().min(1),
	authDomain: z.string().min(1),
	databaseURL: z.string().optional(),
});

export type FirebaseConfig = z.infer<typeof firebaseConfigSchema>;

/**
 * Device information schema
 */
export const deviceInfoSchema = z.object({
	deviceId: z.string().uuid(),
	deviceName: z.string().min(1).max(50),
	platform: z.enum(['darwin', 'linux', 'win32', 'aix', 'freebsd', 'openbsd', 'sunos']),
	createdAt: z.string(),
	lastSyncTimestamp: z.string().optional(),
	syncVersion: z.number().default(1),
});

export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

/**
 * Sync settings schema
 */
export const syncSettingsSchema = z.object({
	enabled: z.boolean().default(false),
	deviceName: z.string().optional(),
	deviceId: z.string().uuid().optional(),
	userId: z.string().optional(),
	retentionDays: z.number().min(1).max(365).default(365),
	lastSync: z.string().optional(),
});

export type SyncSettings = z.infer<typeof syncSettingsSchema>;

/**
 * Security configuration schema
 */
export const securityConfigSchema = z.object({
	encryptionEnabled: z.boolean().default(true),
	encryptedFields: z.object({
		deviceUsage: z.array(z.string()).default([]),
		sessionUsage: z.array(z.string()).default(['projectId', 'sessionId']),
		aggregatedUsage: z.array(z.string()).default([]),
	}).default({}),
	keyRotationDays: z.number().min(30).max(365).default(90),
	lastKeyRotation: z.string().optional(),
});

export type SecurityConfig = z.infer<typeof securityConfigSchema>;

/**
 * Sync configuration schema (combines Firebase config and sync settings)
 */
export const syncConfigSchema = z.object({
	firebase: firebaseConfigSchema,
	sync: syncSettingsSchema,
});

export type SyncConfig = z.infer<typeof syncConfigSchema>;

/**
 * Device usage document schema for Firestore
 */
export const deviceUsageDocumentSchema = z.object({
	date: z.string(),
	deviceName: z.string(),
	models: z.array(z.any()), // ModelBreakdown[]
	totalCost: z.number(),
	totalTokens: z.number(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	cachedTokens: z.number(),
	lastUpdated: z.string(),
});

export type DeviceUsageDocument = z.infer<typeof deviceUsageDocumentSchema> & {
	models: ModelBreakdown[];
};

/**
 * Aggregated usage document schema for Firestore
 */
export const aggregatedUsageDocumentSchema = z.object({
	date: z.string(),
	devices: z.record(z.string(), z.object({
		totalCost: z.number(),
		totalTokens: z.number(),
		lastUpdated: z.string(),
	})),
	totals: z.object({
		cost: z.number(),
		tokens: z.number(),
		inputTokens: z.number(),
		outputTokens: z.number(),
		cachedTokens: z.number(),
	}),
	lastAggregated: z.string(),
});

export type AggregatedUsageDocument = z.infer<typeof aggregatedUsageDocumentSchema>;

/**
 * Session usage document schema for Firestore
 */
export const sessionUsageDocumentSchema = z.object({
	projectId: z.string(),
	sessionId: z.string(),
	devices: z.record(z.string(), z.object({
		models: z.array(z.any()), // ModelBreakdown[]
		totalCost: z.number(),
		startTime: z.string(),
		endTime: z.string(),
	})),
	aggregated: z.object({
		totalCost: z.number(),
		totalTokens: z.number(),
		models: z.array(z.any()), // ModelBreakdown[]
	}),
});

export type SessionUsageDocument = z.infer<typeof sessionUsageDocumentSchema> & {
	devices: Record<string, {
		models: ModelBreakdown[];
		totalCost: number;
		startTime: string;
		endTime: string;
	}>;
	aggregated: {
		totalCost: number;
		totalTokens: number;
		models: ModelBreakdown[];
	};
};

/**
 * Sync checkpoint schema for tracking progress
 */
export const syncCheckpointSchema = z.object({
	deviceId: z.string(),
	lastProcessedFile: z.string(),
	lastProcessedLine: z.number(),
	lastSyncTimestamp: z.string(),
	filesProcessed: z.array(z.string()),
});

export type SyncCheckpoint = z.infer<typeof syncCheckpointSchema>;

/**
 * Sync status information
 */
export type SyncStatus = {
	enabled: boolean;
	connected: boolean;
	lastSync?: ISOTimestamp;
	deviceName?: string;
	deviceId?: string;
	error?: string;
};

/**
 * Sync result for operations
 */
export type SyncResult = {
	success: boolean;
	recordsSynced?: number;
	error?: string;
	duration?: number;
	offline?: boolean;
};

/**
 * Cloud data source indicator for UI
 */
export type DataSource = 'local' | 'cloud' | 'mixed';

/**
 * Device list item for display
 */
export type DeviceListItem = {
	name: string;
	id: string;
	platform: string;
	lastSync?: string;
	isCurrentDevice: boolean;
};
