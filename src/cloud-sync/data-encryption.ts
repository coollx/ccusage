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

// Encryption constants
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32; // 256 bits
const ITERATIONS = 100000; // PBKDF2 iterations

export type EncryptionConfig = {
	keyId: string;
	salt: string;
	createdAt: string;
	rotatedAt?: string;
	previousKeys?: Array<{ keyId: string; salt: string }>;
};

export type EncryptedData = {
	keyId: string;
	iv: string;
	tag: string;
	data: string;
};

export class DataEncryption {
	private keyCache: Map<string, Buffer> = new Map();
	private configPath: string;
	private keysPath: string;

	constructor(configDir?: string) {
		const baseDir = configDir ?? getConfigPath();
		this.configPath = path.join(baseDir, 'encryption.json');
		this.keysPath = path.join(baseDir, 'keys');
	}

	async initialize(): Promise<Result<void, Error>> {
		// Ensure keys directory exists
		const mkdirResult = await Result.try(async () => {
			await fs.mkdir(this.keysPath, { recursive: true });
		});

		if (Result.isFailure(mkdirResult)) {
			return Result.fail(new Error(`Failed to create keys directory: ${mkdirResult.error.message}`));
		}

		// Load or create encryption config
		const configResult = await this.loadOrCreateConfig();
		if (Result.isFailure(configResult)) {
			return Result.fail(configResult.error);
		}

		return Result.succeed();
	}

	private configCache: EncryptionConfig | null = null;

	private async loadOrCreateConfig(forceReload = false): Promise<Result<EncryptionConfig, Error>> {
		// Return cached config if available and not forcing reload
		if (this.configCache && !forceReload) {
			return Result.succeed(this.configCache);
		}

		// Try to load existing config
		const readResult = await Result.try(async () => {
			const data = await fs.readFile(this.configPath, 'utf-8');
			return JSON.parse(data) as EncryptionConfig;
		});

		if (Result.isSuccess(readResult)) {
			this.configCache = readResult.value;
			return Result.succeed(readResult.value);
		}

		// Create new config if not exists
		logger.info('Creating new encryption configuration');
		const config: EncryptionConfig = {
			keyId: crypto.randomUUID(),
			salt: crypto.randomBytes(SALT_LENGTH).toString('base64'),
			createdAt: new Date().toISOString(),
		};

		const writeResult = await Result.try(async () => {
			await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
		});

		if (Result.isFailure(writeResult)) {
			return Result.fail(new Error(`Failed to save encryption config: ${writeResult.error.message}`));
		}

		this.configCache = config;
		return Result.succeed(config);
	}

	async deriveKey(authUid: string, keyId?: string): Promise<Result<Buffer, Error>> {
		// Check cache first
		const cacheKey = `${authUid}-${keyId ?? 'current'}`;
		const cached = this.keyCache.get(cacheKey);
		if (cached) {
			return Result.succeed(cached);
		}

		// Load config
		const configResult = await this.loadOrCreateConfig();
		if (Result.isFailure(configResult)) {
			return Result.fail(configResult.error);
		}

		const config = configResult.value;
		const targetKeyId = keyId ?? config.keyId;

		// Find the salt for the requested keyId
		let salt = config.salt;
		if (keyId && keyId !== config.keyId) {
			if (!config.previousKeys || config.previousKeys.length === 0) {
				// No previous keys available
			}
			else {
				const previousKey = config.previousKeys.find(k => k.keyId === keyId);
				if (previousKey) {
					salt = previousKey.salt;
				}
			}
		}

		// Derive key using PBKDF2 with user-specific salt
		try {
			// Combine global salt with authUid to create user-specific salt
			const userSalt = crypto.createHash('sha256').update(salt + authUid).digest();
			const derivedKey = await new Promise<Buffer>((resolve, reject) => {
				crypto.pbkdf2(authUid, userSalt, ITERATIONS, KEY_LENGTH, 'sha256', (err, derivedKey) => {
					if (err) { reject(err); }
					else { resolve(derivedKey); }
				});
			});

			// Cache the key
			this.keyCache.set(cacheKey, derivedKey);
			return Result.succeed(derivedKey);
		}
		catch (error) {
			return Result.fail(new Error(`Failed to derive key: ${error}`));
		}
	}

	async encrypt(data: string, authUid: string): Promise<Result<EncryptedData, Error>> {
		// Initialize if not already done
		const initResult = await this.initialize();
		if (Result.isFailure(initResult)) {
			return Result.fail(initResult.error);
		}

		// Get current key ID first
		const configResult = await this.loadOrCreateConfig();
		if (Result.isFailure(configResult)) {
			return Result.fail(configResult.error);
		}

		// Get current key using the actual keyId
		const keyResult = await this.deriveKey(authUid, configResult.value.keyId);
		if (Result.isFailure(keyResult)) {
			return Result.fail(keyResult.error);
		}

		try {
			const iv = crypto.randomBytes(IV_LENGTH);
			const cipher = crypto.createCipheriv(ALGORITHM, keyResult.value, iv);

			const encrypted = Buffer.concat([
				cipher.update(data, 'utf8'),
				cipher.final(),
			]);

			const tag = cipher.getAuthTag();

			return Result.succeed({
				keyId: configResult.value.keyId,
				iv: iv.toString('base64'),
				tag: tag.toString('base64'),
				data: encrypted.toString('base64'),
			});
		}
		catch (error) {
			return Result.fail(new Error(`Encryption failed: ${error}`));
		}
	}

	async decrypt(encryptedData: EncryptedData, authUid: string): Promise<Result<string, Error>> {
		// Initialize if not already done
		const initResult = await this.initialize();
		if (Result.isFailure(initResult)) {
			return Result.fail(initResult.error);
		}

		// Get key for the specified keyId
		const keyResult = await this.deriveKey(authUid, encryptedData.keyId);
		if (Result.isFailure(keyResult)) {
			return Result.fail(keyResult.error);
		}

		try {
			const iv = Buffer.from(encryptedData.iv, 'base64');
			const tag = Buffer.from(encryptedData.tag, 'base64');
			const encrypted = Buffer.from(encryptedData.data, 'base64');

			const decipher = crypto.createDecipheriv(ALGORITHM, keyResult.value, iv);
			decipher.setAuthTag(tag);

			const decrypted = Buffer.concat([
				decipher.update(encrypted),
				decipher.final(),
			]);

			return Result.succeed(decrypted.toString('utf8'));
		}
		catch (error) {
			return Result.fail(new Error(`Decryption failed: ${error}`));
		}
	}

	async rotateKeys(authUid: string): Promise<Result<string, Error>> {
		// Load current config
		const configResult = await this.loadOrCreateConfig();
		if (Result.isFailure(configResult)) {
			return Result.fail(configResult.error);
		}

		const oldConfig = configResult.value;
		const newKeyId = crypto.randomUUID();
		const newSalt = crypto.randomBytes(SALT_LENGTH).toString('base64');

		// Update config with new key, keeping previous keys
		const previousKeys = oldConfig.previousKeys ?? [];
		previousKeys.push({ keyId: oldConfig.keyId, salt: oldConfig.salt });

		const newConfig: EncryptionConfig = {
			keyId: newKeyId,
			salt: newSalt,
			createdAt: oldConfig.createdAt,
			rotatedAt: new Date().toISOString(),
			previousKeys,
		};

		// Save new config
		const saveResult = await Result.try(async () => {
			await fs.writeFile(this.configPath, JSON.stringify(newConfig, null, 2));
		});

		if (Result.isFailure(saveResult)) {
			return Result.fail(new Error(`Failed to save rotated config: ${saveResult.error.message}`));
		}

		// Clear key cache and config cache
		this.keyCache.clear();
		this.configCache = newConfig;

		logger.info(`Keys rotated successfully. New key ID: ${newKeyId}`);
		return Result.succeed(newKeyId);
	}

	// Helper to encrypt specific fields in an object
	async encryptFields<T extends Record<string, any>>(
		data: T,
		fields: string[],
		authUid: string,
	): Promise<Result<T, Error>> {
		const result = { ...data };

		for (const field of fields) {
			if (field in data && data[field] != null) {
				const encryptResult = await this.encrypt(String(data[field]), authUid);
				if (Result.isFailure(encryptResult)) {
					return Result.fail(encryptResult.error);
				}
				result[field] = encryptResult.value;
			}
		}

		return Result.succeed(result);
	}

	// Helper to decrypt specific fields in an object
	async decryptFields<T extends Record<string, any>>(
		data: T,
		fields: string[],
		authUid: string,
	): Promise<Result<T, Error>> {
		const result = { ...data };

		for (const field of fields) {
			if (field in data && data[field] != null && typeof data[field] === 'object') {
				const encryptedData = data[field] as EncryptedData;
				const decryptResult = await this.decrypt(encryptedData, authUid);
				if (Result.isFailure(decryptResult)) {
					return Result.fail(decryptResult.error);
				}
				result[field] = decryptResult.value;
			}
		}

		return Result.succeed(result);
	}

	// Get encryption status
	async getStatus(): Promise<Result<{ configured: boolean; keyId?: string; createdAt?: string; rotatedAt?: string }, Error>> {
		const configResult = await this.loadOrCreateConfig();
		if (Result.isFailure(configResult)) {
			return Result.succeed({ configured: false });
		}

		return Result.succeed({
			configured: true,
			keyId: configResult.value.keyId,
			createdAt: configResult.value.createdAt,
			rotatedAt: configResult.value.rotatedAt,
		});
	}
}

// Singleton instance
let encryptionInstance: DataEncryption | null = null;

export function getEncryption(configDir?: string): DataEncryption {
	if (!encryptionInstance) {
		encryptionInstance = new DataEncryption(configDir);
	}
	return encryptionInstance;
}

// In-source tests
if (import.meta.vitest != null) {
	const { describe, it, expect, beforeEach, afterEach } = import.meta.vitest;
	const { createFixture } = await import('fs-fixture');

	describe('DataEncryption', () => {
		let fixture: any;
		let encryption: DataEncryption;
		const testAuthUid = 'test-user-123';

		beforeEach(async () => {
			// Reset singleton
			encryptionInstance = null;

			fixture = await createFixture({
				'.ccusage': {
					keys: {},
				},
			});
			encryption = new DataEncryption(path.join(fixture.path, '.ccusage'));
		});

		afterEach(async () => {
			await fixture.rm();
		});

		it('should initialize with new config', async () => {
			const result = await encryption.initialize();
			expect(Result.isSuccess(result)).toBe(true);

			const status = await encryption.getStatus();
			expect(Result.isSuccess(status)).toBe(true);
			expect(status.value.configured).toBe(true);
			expect(status.value.keyId).toBeDefined();
		});

		it('should encrypt and decrypt data', async () => {
			await encryption.initialize();

			const plaintext = 'This is sensitive data';
			const encryptResult = await encryption.encrypt(plaintext, testAuthUid);

			if (Result.isFailure(encryptResult)) {
				console.error('Encryption failed:', encryptResult.error);
			}

			expect(Result.isSuccess(encryptResult)).toBe(true);

			const encrypted = encryptResult.value;
			expect(encrypted.keyId).toBeDefined();
			expect(encrypted.iv).toBeDefined();
			expect(encrypted.tag).toBeDefined();
			expect(encrypted.data).toBeDefined();

			const decryptResult = await encryption.decrypt(encrypted, testAuthUid);

			if (Result.isFailure(decryptResult)) {
				console.error('Decryption failed:', decryptResult.error);
			}

			expect(Result.isSuccess(decryptResult)).toBe(true);
			if (Result.isSuccess(decryptResult)) {
				expect(decryptResult.value).toBe(plaintext);
			}
		});

		it('should encrypt and decrypt object fields', async () => {
			await encryption.initialize();

			const data = {
				id: '123',
				name: 'Test User',
				email: 'test@example.com',
				publicData: 'This is public',
			};

			const encryptResult = await encryption.encryptFields(data, ['name', 'email'], testAuthUid);
			expect(Result.isSuccess(encryptResult)).toBe(true);

			const encrypted = encryptResult.value;
			expect(encrypted.id).toBe('123');
			expect(encrypted.publicData).toBe('This is public');
			expect(encrypted.name).toHaveProperty('keyId');
			expect(encrypted.email).toHaveProperty('keyId');

			const decryptResult = await encryption.decryptFields(encrypted, ['name', 'email'], testAuthUid);
			expect(Result.isSuccess(decryptResult)).toBe(true);
			expect(decryptResult.value).toEqual(data);
		});

		it('should handle key rotation', async () => {
			await encryption.initialize();

			// Encrypt with original key
			const plaintext = 'Data before rotation';
			const encryptResult1 = await encryption.encrypt(plaintext, testAuthUid);
			expect(Result.isSuccess(encryptResult1)).toBe(true);
			const keyId1 = encryptResult1.value.keyId;

			// Rotate keys
			const rotateResult = await encryption.rotateKeys(testAuthUid);
			expect(Result.isSuccess(rotateResult)).toBe(true);

			// Encrypt with new key
			const encryptResult2 = await encryption.encrypt(plaintext, testAuthUid);
			expect(Result.isSuccess(encryptResult2)).toBe(true);
			const keyId2 = encryptResult2.value.keyId;

			// Keys should be different
			expect(keyId2).not.toBe(keyId1);

			// Should still decrypt old data
			const decryptResult1 = await encryption.decrypt(encryptResult1.value, testAuthUid);
			expect(Result.isSuccess(decryptResult1)).toBe(true);
			expect(decryptResult1.value).toBe(plaintext);

			// And new data
			const decryptResult2 = await encryption.decrypt(encryptResult2.value, testAuthUid);
			expect(Result.isSuccess(decryptResult2)).toBe(true);
			expect(decryptResult2.value).toBe(plaintext);
		});

		it('should fail decryption with wrong auth UID', async () => {
			await encryption.initialize();

			const plaintext = 'Secret data';
			const encryptResult = await encryption.encrypt(plaintext, testAuthUid);
			expect(Result.isSuccess(encryptResult)).toBe(true);

			// Try to decrypt with different UID
			const decryptResult = await encryption.decrypt(encryptResult.value, 'wrong-user-456');
			expect(Result.isFailure(decryptResult)).toBe(true);
			expect(decryptResult.error.message).toContain('Decryption failed');
		});

		it('should cache derived keys', async () => {
			await encryption.initialize();

			// First derivation
			const key1 = await encryption.deriveKey(testAuthUid);
			expect(Result.isSuccess(key1)).toBe(true);

			// Second derivation (should be cached)
			const key2 = await encryption.deriveKey(testAuthUid);
			expect(Result.isSuccess(key2)).toBe(true);

			// Both should return the same key buffer
			expect(key1.value).toBe(key2.value);
		});
	});
}
