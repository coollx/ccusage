import type { FirebaseConfig, SyncSettings } from './_types.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { Result } from '@praha/byethrow';
import { firebaseConfigSchema, syncSettingsSchema } from './_types.ts';

/**
 * Get configuration directory
 */
function getConfigDir(): string {
	// Allow overriding for tests via environment variable
	return (process.env.CCUSAGE_CONFIG_DIR !== undefined && process.env.CCUSAGE_CONFIG_DIR !== '')
		? process.env.CCUSAGE_CONFIG_DIR
		: join(homedir(), '.ccusage');
}

/**
 * Configuration file paths
 */
function getFirebaseConfigPath(): string {
	return join(getConfigDir(), 'firebase.json');
}

function getSyncSettingsPath(): string {
	return join(getConfigDir(), 'sync.json');
}

/**
 * Ensures the configuration directory exists
 */
async function ensureConfigDir(): Promise<Result<void, Error>> {
	try {
		const dir = getConfigDir();
		await mkdir(dir, { recursive: true });
		return Result.succeed(undefined);
	}
	catch (error) {
		return Result.fail(error instanceof Error ? error : new Error(String(error)));
	}
}

/**
 * Loads Firebase configuration from disk
 */
export async function loadFirebaseConfig(): Promise<Result<FirebaseConfig, Error>> {
	try {
		const data = await readFile(getFirebaseConfigPath(), 'utf-8');
		const parsed = JSON.parse(data) as unknown;
		const parseResult = firebaseConfigSchema.safeParse(parsed);
		if (!parseResult.success) {
			return Result.fail(new Error(`Invalid Firebase config: ${parseResult.error.message}`));
		}
		return Result.succeed(parseResult.data);
	}
	catch {
		return Result.fail(new Error(`Firebase config not found. Run 'ccusage sync init' to configure.`));
	}
}

/**
 * Saves Firebase configuration to disk
 */
export async function saveFirebaseConfig(config: FirebaseConfig): Promise<Result<void, Error>> {
	const dirResult: Result<void, Error> = await ensureConfigDir();
	if (Result.isFailure(dirResult)) {
		return dirResult;
	}

	try {
		const data = JSON.stringify(config, null, 2);
		await writeFile(getFirebaseConfigPath(), data, 'utf-8');
		return Result.succeed(undefined);
	}
	catch (error) {
		return Result.fail(error instanceof Error ? error : new Error(String(error)));
	}
}

/**
 * Loads sync settings from disk
 */
export async function loadSyncSettings(): Promise<Result<SyncSettings, Error>> {
	try {
		const data = await readFile(getSyncSettingsPath(), 'utf-8');
		const parsed = JSON.parse(data) as unknown;
		const parseResult = syncSettingsSchema.safeParse(parsed);
		if (!parseResult.success) {
			return Result.fail(new Error(`Invalid sync settings: ${parseResult.error.message}`));
		}
		return Result.succeed(parseResult.data);
	}
	catch {
		// Return default settings if file doesn't exist
		return Result.succeed(syncSettingsSchema.parse({}));
	}
}

/**
 * Saves sync settings to disk
 */
export async function saveSyncSettings(settings: SyncSettings): Promise<Result<void, Error>> {
	const dirResult: Result<void, Error> = await ensureConfigDir();
	if (Result.isFailure(dirResult)) {
		return dirResult;
	}

	try {
		const data = JSON.stringify(settings, null, 2);
		await writeFile(getSyncSettingsPath(), data, 'utf-8');
		return Result.succeed(undefined);
	}
	catch (error) {
		return Result.fail(error instanceof Error ? error : new Error(String(error)));
	}
}

/**
 * Loads complete sync configuration (Firebase + settings)
 */
export async function loadSyncConfig(): Promise<Result<{ firebase: FirebaseConfig; sync: SyncSettings }, Error>> {
	const firebaseResult: Result<FirebaseConfig, Error> = await loadFirebaseConfig();
	if (Result.isFailure(firebaseResult)) {
		return firebaseResult;
	}

	const settingsResult: Result<SyncSettings, Error> = await loadSyncSettings();
	if (Result.isFailure(settingsResult)) {
		return settingsResult;
	}

	return Result.succeed({
		firebase: (firebaseResult as { value: FirebaseConfig }).value,
		sync: (settingsResult as { value: SyncSettings }).value,
	});
}

/**
 * Checks if Firebase is configured
 */
export async function isFirebaseConfigured(): Promise<boolean> {
	const result = await loadFirebaseConfig();
	return Result.isSuccess(result);
}

/**
 * Checks if sync is enabled
 */
export async function isSyncEnabled(): Promise<boolean> {
	const result = await loadSyncSettings();
	return Result.isSuccess(result) && result.value.enabled;
}

/**
 * Updates sync settings with partial data
 */
export async function updateSyncSettings(updates: Partial<SyncSettings>): Promise<Result<void, Error>> {
	const currentResult: Result<SyncSettings, Error> = await loadSyncSettings();
	if (Result.isFailure(currentResult)) {
		return currentResult;
	}

	const updated = { ...(currentResult as { value: SyncSettings }).value, ...updates };
	return saveSyncSettings(updated);
}

if (import.meta.vitest != null) {
	const { describe, it, expect, beforeEach, afterEach } = import.meta.vitest;
	const { mkdtemp, rm } = await import('node:fs/promises');
	const { tmpdir } = await import('node:os');
	// eslint-disable-next-line ts/unbound-method
	const { join: joinPath } = await import('node:path');

	describe('config-manager', () => {
		let tempDir: string;
		let originalConfigDir: string | undefined;

		beforeEach(async () => {
			tempDir = await mkdtemp(joinPath(tmpdir(), 'ccusage-test-'));
			originalConfigDir = process.env.CCUSAGE_CONFIG_DIR;
			process.env.CCUSAGE_CONFIG_DIR = tempDir;
		});

		afterEach(async () => {
			const { rm } = await import('node:fs/promises');
			if (originalConfigDir !== undefined) {
				process.env.CCUSAGE_CONFIG_DIR = originalConfigDir;
			}
			else {
				delete process.env.CCUSAGE_CONFIG_DIR;
			}
			await rm(tempDir, { recursive: true, force: true });
		});

		describe('Firebase config', () => {
			const testConfig: FirebaseConfig = {
				projectId: 'test-project',
				apiKey: 'test-api-key',
				authDomain: 'test.firebaseapp.com',
			};

			it('should save and load Firebase config', async () => {
				const saveResult: Result<void, Error> = await saveFirebaseConfig(testConfig);
				expect(Result.isSuccess(saveResult)).toBe(true);

				const loadResult: Result<FirebaseConfig, Error> = await loadFirebaseConfig();
				expect(Result.isSuccess(loadResult)).toBe(true);
				if (Result.isSuccess(loadResult)) {
					expect((loadResult as { value: FirebaseConfig }).value).toEqual(testConfig);
				}
			});

			it('should return error when config not found', async () => {
				const result: Result<FirebaseConfig, Error> = await loadFirebaseConfig();
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result)) {
					expect((result as { error: Error }).error.message).toContain('Firebase config not found');
				}
			});
		});

		describe('Sync settings', () => {
			it('should return default settings when file not found', async () => {
				const result: Result<SyncSettings, Error> = await loadSyncSettings();
				expect(Result.isSuccess(result)).toBe(true);
				if (Result.isSuccess(result)) {
					const settings = (result as { value: SyncSettings }).value;
					expect(settings.enabled).toBe(false);
					expect(settings.retentionDays).toBe(365);
				}
			});

			it('should save and load sync settings', async () => {
				const settings: SyncSettings = {
					enabled: true,
					deviceName: 'Test Device',
					deviceId: '123e4567-e89b-12d3-a456-426614174000',
					retentionDays: 180,
				};

				const saveResult: Result<void, Error> = await saveSyncSettings(settings);
				expect(Result.isSuccess(saveResult)).toBe(true);

				const loadResult: Result<SyncSettings, Error> = await loadSyncSettings();
				expect(Result.isSuccess(loadResult)).toBe(true);
				if (Result.isSuccess(loadResult)) {
					expect((loadResult as { value: SyncSettings }).value).toEqual(settings);
				}
			});

			it('should update sync settings partially', async () => {
				const initial: SyncSettings = {
					enabled: false,
					retentionDays: 365,
				};
				await saveSyncSettings(initial);

				const updateResult: Result<void, Error> = await updateSyncSettings({ enabled: true });
				expect(Result.isSuccess(updateResult)).toBe(true);

				const loadResult: Result<SyncSettings, Error> = await loadSyncSettings();
				expect(Result.isSuccess(loadResult)).toBe(true);
				if (Result.isSuccess(loadResult)) {
					const settings = (loadResult as { value: SyncSettings }).value;
					expect(settings.enabled).toBe(true);
					expect(settings.retentionDays).toBe(365);
				}
			});
		});

		describe('Helper functions', () => {
			it('should correctly check if Firebase is configured', async () => {
				expect(await isFirebaseConfigured()).toBe(false);

				await saveFirebaseConfig({
					projectId: 'test',
					apiKey: 'key',
					authDomain: 'test.firebaseapp.com',
				});

				expect(await isFirebaseConfigured()).toBe(true);
			});

			it('should correctly check if sync is enabled', async () => {
				expect(await isSyncEnabled()).toBe(false);

				await saveSyncSettings({ enabled: true, retentionDays: 365 });
				expect(await isSyncEnabled()).toBe(true);
			});
		});
	});
}
