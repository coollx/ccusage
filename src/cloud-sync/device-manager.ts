import type { DeviceInfo, DeviceListItem } from './_types.ts';
import { platform } from 'node:os';
import { Result } from '@praha/byethrow';
import { v4 as uuidv4 } from 'uuid';
import { createISOTimestamp } from '../_types.ts';
import { deviceInfoSchema } from './_types.ts';

/**
 * Generates a unique device ID
 */
export function generateDeviceId(): string {
	return uuidv4();
}

/**
 * Creates device information for the current device
 */
export function createDeviceInfo(deviceName: string, deviceId?: string): DeviceInfo {
	return deviceInfoSchema.parse({
		deviceId: deviceId ?? generateDeviceId(),
		deviceName,
		platform: platform(),
		createdAt: createISOTimestamp(new Date().toISOString()),
		syncVersion: 1,
	});
}

/**
 * Validates a device name
 */
export function validateDeviceName(name: string): Result<string, Error> {
	const trimmed = name.trim();

	if (trimmed.length === 0) {
		return Result.fail(new Error('Device name cannot be empty'));
	}

	if (trimmed.length > 50) {
		return Result.fail(new Error('Device name cannot exceed 50 characters'));
	}

	// Check for invalid characters
	// eslint-disable-next-line no-control-regex
	const invalidChars = /[<>:"/\\|?*\x00-\x1F]/;
	if (invalidChars.test(trimmed)) {
		return Result.fail(new Error('Device name contains invalid characters'));
	}

	return Result.succeed(trimmed);
}

/**
 * Generates device name suggestions when a name is already taken
 */
export function generateDeviceNameSuggestions(baseName: string): string[] {
	const suggestions: string[] = [];

	// Add number suffix
	suggestions.push(`${baseName} (2)`);
	suggestions.push(`${baseName} (3)`);

	// Add descriptive suffixes based on platform
	const platf = platform();
	if (platf === 'darwin') {
		suggestions.push(`${baseName} - Mac`);
	}
	else if (platf === 'linux') {
		suggestions.push(`${baseName} - Linux`);
	}
	else if (platf === 'win32') {
		suggestions.push(`${baseName} - Windows`);
	}

	// Add location/purpose suffixes
	suggestions.push(`${baseName} - Home`);
	suggestions.push(`${baseName} - Work`);
	suggestions.push(`${baseName} - Personal`);

	// Return first 5 suggestions that are valid
	return suggestions
		.filter(name => Result.isSuccess(validateDeviceName(name)))
		.slice(0, 5);
}

/**
 * Formats platform name for display
 */
export function formatPlatformName(platformId: string): string {
	const platformMap: Record<string, string> = {
		darwin: 'macOS',
		linux: 'Linux',
		win32: 'Windows',
		aix: 'AIX',
		freebsd: 'FreeBSD',
		openbsd: 'OpenBSD',
		sunos: 'SunOS',
	};

	return platformMap[platformId] ?? platformId;
}

/**
 * Formats device list for display
 */
export function formatDeviceList(devices: DeviceInfo[], currentDeviceId?: string): DeviceListItem[] {
	return devices.map(device => ({
		name: device.deviceName,
		id: device.deviceId,
		platform: formatPlatformName(device.platform),
		lastSync: device.lastSyncTimestamp,
		isCurrentDevice: device.deviceId === currentDeviceId,
	}));
}

if (import.meta.vitest != null) {
	const { describe, it, expect } = import.meta.vitest;

	describe('device-manager', () => {
		describe('generateDeviceId', () => {
			it('should generate valid UUID v4', () => {
				const id = generateDeviceId();
				expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
			});

			it('should generate unique IDs', () => {
				const id1 = generateDeviceId();
				const id2 = generateDeviceId();
				expect(id1).not.toBe(id2);
			});
		});

		describe('createDeviceInfo', () => {
			it('should create valid device info', () => {
				const info = createDeviceInfo('Test Device');
				expect(info.deviceName).toBe('Test Device');
				expect(info.platform).toBe(platform());
				expect(info.syncVersion).toBe(1);
				expect(info.deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
			});

			it('should use provided device ID', () => {
				const customId = generateDeviceId();
				const info = createDeviceInfo('Test Device', customId);
				expect(info.deviceId).toBe(customId);
			});
		});

		describe('validateDeviceName', () => {
			it('should accept valid device names', () => {
				const validNames = [
					'MacBook Pro',
					'Work Linux',
					'Gaming PC 2024',
					'Dev-Machine-01',
					'Alice\'s Laptop',
				];

				for (const name of validNames) {
					const result = validateDeviceName(name);
					expect(Result.isSuccess(result)).toBe(true);
					if (Result.isSuccess(result)) {
						expect(result.value).toBe(name);
					}
				}
			});

			it('should reject empty names', () => {
				const result = validateDeviceName('');
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result)) {
					expect(result.error.message).toContain('empty');
				}
			});

			it('should reject names that are too long', () => {
				const longName = 'a'.repeat(51);
				const result = validateDeviceName(longName);
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result)) {
					expect(result.error.message).toContain('50 characters');
				}
			});

			it('should reject names with invalid characters', () => {
				const invalidNames = [
					'Device<Name>',
					'Device:Name',
					'Device"Name',
					'Device/Name',
					'Device\\Name',
					'Device|Name',
					'Device?Name',
					'Device*Name',
				];

				for (const name of invalidNames) {
					const result = validateDeviceName(name);
					expect(Result.isFailure(result)).toBe(true);
					if (Result.isFailure(result)) {
						expect(result.error.message).toContain('invalid characters');
					}
				}
			});

			it('should trim whitespace', () => {
				const result = validateDeviceName('  MacBook Pro  ');
				expect(Result.isSuccess(result)).toBe(true);
				if (Result.isSuccess(result)) {
					expect(result.value).toBe('MacBook Pro');
				}
			});
		});

		describe('generateDeviceNameSuggestions', () => {
			it('should generate suggestions for a base name', () => {
				const suggestions = generateDeviceNameSuggestions('MacBook Pro');
				expect(suggestions).toContain('MacBook Pro (2)');
				expect(suggestions).toContain('MacBook Pro - Home');
				expect(suggestions).toContain('MacBook Pro - Work');
				expect(suggestions.length).toBeLessThanOrEqual(5);
			});

			it('should include platform-specific suggestions', () => {
				const suggestions = generateDeviceNameSuggestions('Laptop');
				const platf = platform();

				if (platf === 'darwin') {
					expect(suggestions).toContain('Laptop - Mac');
				}
				else if (platf === 'linux') {
					expect(suggestions).toContain('Laptop - Linux');
				}
				else if (platf === 'win32') {
					expect(suggestions).toContain('Laptop - Windows');
				}
			});
		});

		describe('formatPlatformName', () => {
			it('should format known platforms', () => {
				expect(formatPlatformName('darwin')).toBe('macOS');
				expect(formatPlatformName('linux')).toBe('Linux');
				expect(formatPlatformName('win32')).toBe('Windows');
			});

			it('should return original name for unknown platforms', () => {
				expect(formatPlatformName('unknown')).toBe('unknown');
			});
		});

		describe('formatDeviceList', () => {
			it('should format device list correctly', () => {
				const devices: DeviceInfo[] = [
					{
						deviceId: 'id1',
						deviceName: 'Device 1',
						platform: 'darwin',
						createdAt: '2025-01-01T00:00:00Z',
						syncVersion: 1,
					},
					{
						deviceId: 'id2',
						deviceName: 'Device 2',
						platform: 'linux',
						createdAt: '2025-01-01T00:00:00Z',
						syncVersion: 1,
						lastSyncTimestamp: '2025-01-02T00:00:00Z',
					},
				];

				const formatted = formatDeviceList(devices, 'id1');

				expect(formatted).toHaveLength(2);
				expect(formatted[0]).toEqual({
					name: 'Device 1',
					id: 'id1',
					platform: 'macOS',
					lastSync: undefined,
					isCurrentDevice: true,
				});
				expect(formatted[1]).toEqual({
					name: 'Device 2',
					id: 'id2',
					platform: 'Linux',
					lastSync: '2025-01-02T00:00:00Z',
					isCurrentDevice: false,
				});
			});
		});
	});
}
