import type { DataSource } from './_types.ts';
import pc from 'picocolors';

/**
 * Visual indicators for cloud sync status
 */
export const CloudIndicators = {
	// Data source indicators
	cloud: '🌐',
	local: '💻',
	mixed: '🔀',

	// Sync status indicators
	syncing: '↑',
	synced: '✓',
	error: '⚠️',
	offline: '🔌',

	// Device indicators
	device: '📱',
	currentDevice: '📍',
} as const;

/**
 * Format data source indicator with color
 */
export function formatDataSource(source: DataSource): string {
	switch (source) {
		case 'cloud':
			return `${CloudIndicators.cloud} ${pc.cyan('Cloud')}`;
		case 'local':
			return `${CloudIndicators.local} ${pc.gray('Local')}`;
		case 'mixed':
			return `${CloudIndicators.mixed} ${pc.yellow('Mixed')}`;
		default:
			return `${CloudIndicators.local} ${pc.gray('Local')}`;
	}
}

/**
 * Format sync status indicator
 */
export function formatSyncStatus(isSyncing: boolean, hasError?: boolean): string {
	if (hasError) {
		return `${CloudIndicators.error} ${pc.red('Error')}`;
	}
	if (isSyncing) {
		return `${CloudIndicators.syncing} ${pc.yellow('Syncing')}`;
	}
	return `${CloudIndicators.synced} ${pc.green('Synced')}`;
}

/**
 * Get sync indicator for live display
 */
export function getSyncIndicator(isSyncing: boolean): string {
	return isSyncing ? CloudIndicators.syncing : '';
}

/**
 * Format device breakdown for cloud data
 */
export function formatDeviceBreakdown(devices: Record<string, { cost: number; tokens: number }>): string[] {
	const lines: string[] = [];
	const sortedDevices = Object.entries(devices).sort(([, a], [, b]) => b.cost - a.cost);

	for (const [deviceName, stats] of sortedDevices) {
		const costStr = `$${stats.cost.toFixed(2)}`;
		const tokensStr = stats.tokens.toLocaleString();
		lines.push(`  ${CloudIndicators.device} ${deviceName}: ${pc.cyan(costStr)} (${tokensStr} tokens)`);
	}

	return lines;
}

/**
 * Create table header with source indicator
 */
export function createTableHeader(baseHeaders: string[], dataSource: DataSource): string[] {
	const sourceIndicator = formatDataSource(dataSource);
	return [...baseHeaders, sourceIndicator];
}

/**
 * Determine data source based on command options
 */
export function determineDataSource(options: { cloud?: boolean; local?: boolean }): DataSource {
	if (options.cloud) {
		return 'cloud';
	}
	if (options.local) {
		return 'local';
	}
	// Default behavior: use cloud if available, otherwise local
	return 'local'; // Will be updated by sync engine
}

// In-source tests
if (import.meta.vitest != null) {
	const { describe, it, expect } = import.meta.vitest;

	describe('CloudIndicator', () => {
		it('should format data sources correctly', () => {
			expect(formatDataSource('cloud')).toContain('🌐');
			expect(formatDataSource('cloud')).toContain('Cloud');
			expect(formatDataSource('local')).toContain('💻');
			expect(formatDataSource('local')).toContain('Local');
			expect(formatDataSource('mixed')).toContain('🔀');
			expect(formatDataSource('mixed')).toContain('Mixed');
		});

		it('should format sync status correctly', () => {
			expect(formatSyncStatus(true)).toContain('↑');
			expect(formatSyncStatus(true)).toContain('Syncing');
			expect(formatSyncStatus(false)).toContain('✓');
			expect(formatSyncStatus(false)).toContain('Synced');
			expect(formatSyncStatus(false, true)).toContain('⚠️');
			expect(formatSyncStatus(false, true)).toContain('Error');
		});

		it('should get sync indicator', () => {
			expect(getSyncIndicator(true)).toBe('↑');
			expect(getSyncIndicator(false)).toBe('');
		});

		it('should format device breakdown', () => {
			const devices = {
				'MacBook Pro': { cost: 45.23, tokens: 150000 },
				'Linux Desktop': { cost: 32.10, tokens: 95000 },
			};

			const lines = formatDeviceBreakdown(devices);
			expect(lines).toHaveLength(2);
			expect(lines[0]).toContain('MacBook Pro');
			expect(lines[0]).toContain('$45.23');
			expect(lines[0]).toContain('150,000');
			expect(lines[1]).toContain('Linux Desktop');
		});

		it('should determine data source from options', () => {
			expect(determineDataSource({ cloud: true })).toBe('cloud');
			expect(determineDataSource({ local: true })).toBe('local');
			expect(determineDataSource({})).toBe('local');
		});
	});
}
