import type { UsageData } from '../_types.ts';
import type { DeviceUsageDocument, SessionUsageDocument } from './_types.ts';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { join } from 'node:path';
import { Result } from '@praha/byethrow';
import { logger } from '../logger.ts';

function getConfigPath(): string {
	return process.env.CCUSAGE_CONFIG_DIR ?? join(homedir(), '.ccusage');
}

export type PrivacySettings = {
	anonymizeProjects: boolean;
	anonymizeSessions: boolean;
	retentionDays: number;
	createdAt: string;
	updatedAt: string;
};

export type DataExport = {
	exportDate: string;
	userId: string;
	deviceName: string;
	privacySettings: PrivacySettings;
	data: {
		daily: Record<string, any>;
		sessions: Record<string, any>;
		aggregated: Record<string, any>;
	};
};

export class PrivacyControls {
	private configPath: string;
	private settings: PrivacySettings | null = null;

	constructor(configDir?: string) {
		const baseDir = configDir ?? getConfigPath();
		this.configPath = path.join(baseDir, 'privacy-settings.json');
	}

	async loadSettings(): Promise<Result<PrivacySettings, Error>> {
		// Try to load existing settings
		const readResult = await Result.try(async () => {
			const data = await fs.readFile(this.configPath, 'utf-8');
			return JSON.parse(data) as PrivacySettings;
		});

		if (Result.isSuccess(readResult)) {
			this.settings = readResult.value;
			return Result.succeed(readResult.value);
		}

		// Create default settings if not exists
		const defaultSettings: PrivacySettings = {
			anonymizeProjects: false,
			anonymizeSessions: false,
			retentionDays: 365, // 1 year default
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const saveResult = await this.saveSettings(defaultSettings);
		if (Result.isFailure(saveResult)) {
			return Result.fail(saveResult.error);
		}

		return Result.succeed(defaultSettings);
	}

	async saveSettings(settings: PrivacySettings): Promise<Result<void, Error>> {
		// Ensure directory exists
		const dir = path.dirname(this.configPath);
		await fs.mkdir(dir, { recursive: true });

		const updatedSettings = {
			...settings,
			updatedAt: new Date().toISOString(),
		};

		const saveResult = await Result.try(async () => {
			await fs.writeFile(this.configPath, JSON.stringify(updatedSettings, null, 2));
		});

		if (Result.isFailure(saveResult)) {
			return Result.fail(new Error(`Failed to save privacy settings: ${saveResult.error.message}`));
		}

		// Only set settings if save was successful
		this.settings = updatedSettings;

		logger.info('Privacy settings updated', updatedSettings);
		return Result.succeed();
	}

	async updateSettings(updates: Partial<PrivacySettings>): Promise<Result<PrivacySettings, Error>> {
		const currentResult = await this.loadSettings();
		if (Result.isFailure(currentResult)) {
			return Result.fail(currentResult.error);
		}

		const newSettings: PrivacySettings = {
			...currentResult.value,
			...updates,
			updatedAt: new Date().toISOString(),
		};

		// Validate settings
		if (newSettings.retentionDays < 30 || newSettings.retentionDays > 730) {
			return Result.fail(new Error('Retention days must be between 30 and 730'));
		}

		const saveResult = await this.saveSettings(newSettings);
		if (Result.isFailure(saveResult)) {
			return Result.fail(saveResult.error);
		}

		return Result.succeed(newSettings);
	}

	// Anonymize project name
	anonymizeProjectName(projectId: string): string {
		// Make sure settings are loaded
		if (!this.settings?.anonymizeProjects) {
			return projectId;
		}

		// Create deterministic hash for consistent anonymization
		const hash = crypto.createHash('sha256').update(projectId).digest('hex');
		return `project-${hash.substring(0, 8)}`;
	}

	// Anonymize session ID
	anonymizeSessionId(sessionId: string): string {
		// Make sure settings are loaded
		if (!this.settings?.anonymizeSessions) {
			return sessionId;
		}

		const hash = crypto.createHash('sha256').update(sessionId).digest('hex');
		return `session-${hash.substring(0, 8)}`;
	}

	// Apply anonymization to usage data
	anonymizeUsageData(data: UsageData): UsageData {
		if (!this.settings) {
			return data;
		}

		const anonymized = { ...data };

		// Anonymize request IDs if sessions are anonymized
		if (this.settings.anonymizeSessions && anonymized.requestId) {
			const hash = crypto.createHash('sha256').update(anonymized.requestId).digest('hex');
			anonymized.requestId = `req-${hash.substring(0, 8)}`;
		}

		// Anonymize message IDs if sessions are anonymized
		if (this.settings.anonymizeSessions && anonymized.messageId) {
			const hash = crypto.createHash('sha256').update(anonymized.messageId).digest('hex');
			anonymized.messageId = `msg-${hash.substring(0, 8)}`;
		}

		return anonymized;
	}

	// Apply anonymization to device usage document
	anonymizeDeviceUsage(doc: DeviceUsageDocument): DeviceUsageDocument {
		if (!this.settings) {
			return doc;
		}

		const anonymized = { ...doc };

		// Anonymize model breakdown if needed
		if (anonymized.models && this.settings.anonymizeSessions) {
			anonymized.models = anonymized.models.map(model => ({
				...model,
				// Keep model names but could anonymize in future
			}));
		}

		return anonymized;
	}

	// Apply anonymization to session document
	anonymizeSessionUsage(doc: SessionUsageDocument): SessionUsageDocument {
		if (!this.settings) {
			return doc;
		}

		return {
			...doc,
			projectId: this.anonymizeProjectName(doc.projectId),
			sessionId: this.anonymizeSessionId(doc.sessionId),
		};
	}

	// Check if data should be retained based on age
	shouldRetainData(timestamp: string): boolean {
		// Make sure settings are loaded
		if (!this.settings) {
			return true;
		}

		const dataDate = new Date(timestamp);
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - this.settings.retentionDays);

		return dataDate > cutoffDate;
	}

	// Get retention cutoff date
	getRetentionCutoffDate(): Date {
		const cutoffDate = new Date();
		const retentionDays = this.settings?.retentionDays ?? 365;
		cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
		return cutoffDate;
	}

	// Export user data in JSON format
	async exportDataAsJSON(data: DataExport): Promise<Result<string, Error>> {
		try {
			// Apply anonymization if needed
			if (this.settings?.anonymizeSessions) {
				// Anonymize session data
				for (const key in data.data.sessions) {
					const anonymizedKey = this.anonymizeSessionId(key);
					if (anonymizedKey !== key) {
						data.data.sessions[anonymizedKey] = data.data.sessions[key];
						delete data.data.sessions[key];
					}
				}
			}

			const json = JSON.stringify(data, null, 2);
			return Result.succeed(json);
		}
		catch (error) {
			return Result.fail(new Error(`Failed to export data as JSON: ${error}`));
		}
	}

	// Export user data in CSV format
	async exportDataAsCSV(data: DataExport): Promise<Result<string, Error>> {
		try {
			const rows: string[] = [];

			// Header
			rows.push('Date,Device,Model,Input Tokens,Output Tokens,Cached Tokens,Total Tokens,Cost');

			// Daily data
			for (const [date, devices] of Object.entries(data.data.daily)) {
				if (typeof devices === 'object' && devices !== null) {
					for (const [deviceName, usage] of Object.entries(devices as Record<string, any>)) {
						if (usage.models && Array.isArray(usage.models)) {
							for (const model of usage.models) {
								rows.push([
									date,
									deviceName,
									model.model,
									model.inputTokens ?? 0,
									model.outputTokens ?? 0,
									model.cachedTokens ?? 0,
									model.totalTokens ?? 0,
									model.cost ?? 0,
								].join(','));
							}
						}
					}
				}
			}

			return Result.succeed(rows.join('\n'));
		}
		catch (error) {
			return Result.fail(new Error(`Failed to export data as CSV: ${error}`));
		}
	}

	// Delete old data based on retention policy
	async getDataToDelete(): Promise<Result<{ dates: string[]; sessions: string[] }, Error>> {
		if (!this.settings) {
			const loadResult = await this.loadSettings();
			if (Result.isFailure(loadResult)) {
				return Result.fail(loadResult.error);
			}
		}

		const cutoffDate = this.getRetentionCutoffDate();
		const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

		// This would need to be integrated with actual data storage
		// For now, return structure for dates to delete
		const datesToDelete: string[] = [];
		const sessionsToDelete: string[] = [];

		// Generate dates to delete (example)
		const currentDate = new Date();
		const retentionDays = this.settings?.retentionDays ?? 365;
		for (let i = retentionDays + 1; i < 1000; i++) {
			const checkDate = new Date(currentDate);
			checkDate.setDate(checkDate.getDate() - i);
			const dateStr = checkDate.toISOString().split('T')[0];
			if (dateStr < cutoffDateStr) {
				datesToDelete.push(dateStr);
			}
		}

		logger.info(`Identified ${datesToDelete.length} dates for deletion based on retention policy`);

		return Result.succeed({
			dates: datesToDelete,
			sessions: sessionsToDelete,
		});
	}
}

// Singleton instance
let privacyInstance: PrivacyControls | null = null;

export function getPrivacyControls(configDir?: string): PrivacyControls {
	if (!privacyInstance) {
		privacyInstance = new PrivacyControls(configDir);
	}
	return privacyInstance;
}

// In-source tests
if (import.meta.vitest != null) {
	const { describe, it, expect, beforeEach, afterEach } = import.meta.vitest;
	const { createFixture } = await import('fs-fixture');

	describe('PrivacyControls', () => {
		let fixture: any;
		let privacy: PrivacyControls;

		beforeEach(async () => {
			// Reset singleton
			privacyInstance = null;

			fixture = await createFixture({
				'.ccusage': {},
			});
			privacy = new PrivacyControls(path.join(fixture.path, '.ccusage'));
		});

		afterEach(async () => {
			await fixture.rm();
		});

		it('should create default settings on first load', async () => {
			const result = await privacy.loadSettings();
			expect(Result.isSuccess(result)).toBe(true);
			expect(result.value.anonymizeProjects).toBe(false);
			expect(result.value.anonymizeSessions).toBe(false);
			expect(result.value.retentionDays).toBe(365);
		});

		it('should update privacy settings', async () => {
			await privacy.loadSettings();

			const updateResult = await privacy.updateSettings({
				anonymizeProjects: true,
				anonymizeSessions: true,
				retentionDays: 180,
			});

			expect(Result.isSuccess(updateResult)).toBe(true);
			expect(updateResult.value.anonymizeProjects).toBe(true);
			expect(updateResult.value.anonymizeSessions).toBe(true);
			expect(updateResult.value.retentionDays).toBe(180);
		});

		it('should validate retention days', async () => {
			await privacy.loadSettings();

			const result = await privacy.updateSettings({
				retentionDays: 20, // Too low
			});

			expect(Result.isFailure(result)).toBe(true);
			expect(result.error.message).toContain('between 30 and 730');
		});

		it('should anonymize project names when enabled', async () => {
			const loadResult = await privacy.loadSettings();
			expect(Result.isSuccess(loadResult)).toBe(true);

			const updateResult = await privacy.updateSettings({ anonymizeProjects: true });
			expect(Result.isSuccess(updateResult)).toBe(true);
			expect(updateResult.value.anonymizeProjects).toBe(true);

			const projectId = 'my-secret-project';
			const anonymized = privacy.anonymizeProjectName(projectId);

			expect(anonymized).not.toBe(projectId);
			expect(anonymized).toMatch(/^project-[a-f0-9]{8}$/);

			// Should be deterministic
			const anonymized2 = privacy.anonymizeProjectName(projectId);
			expect(anonymized2).toBe(anonymized);
		});

		it('should anonymize session IDs when enabled', async () => {
			const loadResult = await privacy.loadSettings();
			expect(Result.isSuccess(loadResult)).toBe(true);

			const updateResult = await privacy.updateSettings({ anonymizeSessions: true });
			expect(Result.isSuccess(updateResult)).toBe(true);

			const sessionId = 'user-session-12345';
			const anonymized = privacy.anonymizeSessionId(sessionId);

			expect(anonymized).not.toBe(sessionId);
			expect(anonymized).toMatch(/^session-[a-f0-9]{8}$/);
		});

		it('should not anonymize when disabled', async () => {
			await privacy.loadSettings();
			// Default is disabled

			const projectId = 'my-project';
			const sessionId = 'my-session';

			expect(privacy.anonymizeProjectName(projectId)).toBe(projectId);
			expect(privacy.anonymizeSessionId(sessionId)).toBe(sessionId);
		});

		it('should check data retention correctly', async () => {
			const loadResult = await privacy.loadSettings();
			expect(Result.isSuccess(loadResult)).toBe(true);

			const updateResult = await privacy.updateSettings({ retentionDays: 30 });
			expect(Result.isSuccess(updateResult)).toBe(true);

			const oldDate = new Date();
			oldDate.setDate(oldDate.getDate() - 40);
			expect(privacy.shouldRetainData(oldDate.toISOString())).toBe(false);

			const recentDate = new Date();
			recentDate.setDate(recentDate.getDate() - 20);
			expect(privacy.shouldRetainData(recentDate.toISOString())).toBe(true);
		});

		it('should export data as JSON', async () => {
			await privacy.loadSettings();

			const exportData: DataExport = {
				exportDate: new Date().toISOString(),
				userId: 'test-user',
				deviceName: 'test-device',
				privacySettings: (await privacy.loadSettings()).value,
				data: {
					daily: {
						'2025-01-27': {
							'test-device': {
								totalCost: 10.5,
								totalTokens: 1000,
							},
						},
					},
					sessions: {},
					aggregated: {},
				},
			};

			const result = await privacy.exportDataAsJSON(exportData);
			expect(Result.isSuccess(result)).toBe(true);

			const parsed = JSON.parse(result.value);
			expect(parsed.userId).toBe('test-user');
			expect(parsed.data.daily['2025-01-27']).toBeDefined();
		});

		it('should export data as CSV', async () => {
			await privacy.loadSettings();

			const exportData: DataExport = {
				exportDate: new Date().toISOString(),
				userId: 'test-user',
				deviceName: 'test-device',
				privacySettings: (await privacy.loadSettings()).value,
				data: {
					daily: {
						'2025-01-27': {
							MacBook: {
								models: [{
									model: 'claude-opus-4',
									inputTokens: 500,
									outputTokens: 300,
									cachedTokens: 200,
									totalTokens: 1000,
									cost: 5.0,
								}],
							},
						},
					},
					sessions: {},
					aggregated: {},
				},
			};

			const result = await privacy.exportDataAsCSV(exportData);
			expect(Result.isSuccess(result)).toBe(true);

			const lines = result.value.split('\n');
			expect(lines[0]).toBe('Date,Device,Model,Input Tokens,Output Tokens,Cached Tokens,Total Tokens,Cost');
			expect(lines[1]).toContain('2025-01-27,MacBook,claude-opus-4');
		});

		it('should identify data to delete based on retention', async () => {
			const loadResult = await privacy.loadSettings();
			expect(Result.isSuccess(loadResult)).toBe(true);

			const updateResult = await privacy.updateSettings({ retentionDays: 30 });
			expect(Result.isSuccess(updateResult)).toBe(true);

			const result = await privacy.getDataToDelete();
			expect(Result.isSuccess(result)).toBe(true);
			expect(result.value.dates.length).toBeGreaterThan(0);

			// All dates should be older than 30 days
			const cutoff = new Date();
			cutoff.setDate(cutoff.getDate() - 30);
			for (const date of result.value.dates) {
				expect(new Date(date) < cutoff).toBe(true);
			}
		});
	});
}
