import type { PrivacySettings } from '../cloud-sync/privacy-controls.ts';
import { Result } from '@praha/byethrow';
import Table from 'cli-table3';
import { define } from 'gunshi';
import pc from 'picocolors';
import prompts from 'prompts';
import { getPrivacyControls } from '../cloud-sync/privacy-controls.ts';
import { log } from '../logger.ts';

/**
 * Privacy config subcommand - Interactive privacy configuration
 */
const configCommand = define({
	name: 'config',
	description: 'Configure privacy settings interactively',
	async run() {
		const privacy = getPrivacyControls();

		// Load current settings
		const currentResult = await privacy.loadSettings();
		if (Result.isFailure(currentResult)) {
			log(pc.red(`Failed to load privacy settings: ${currentResult.error.message}`));
			return;
		}

		const current = currentResult.value;

		log(pc.bold('🔐 Privacy Configuration\n'));
		log('Configure how your usage data is handled:\n');

		const response = await prompts([
			{
				type: 'confirm',
				name: 'anonymizeProjects',
				message: 'Anonymize project names?',
				initial: current.anonymizeProjects,
			},
			{
				type: 'confirm',
				name: 'anonymizeSessions',
				message: 'Anonymize session IDs?',
				initial: current.anonymizeSessions,
			},
			{
				type: 'number',
				name: 'retentionDays',
				message: 'Data retention period (days):',
				initial: current.retentionDays,
				min: 30,
				max: 730,
				validate: (value: number) => {
					if (value < 30) { return 'Minimum retention is 30 days'; }
					if (value > 730) { return 'Maximum retention is 730 days'; }
					return true;
				},
			},
		]);

		if (!response.anonymizeProjects && response.anonymizeProjects !== false) {
			log(pc.yellow('Configuration cancelled.'));
			return;
		}

		// Update settings
		const updateResult = await privacy.updateSettings({
			anonymizeProjects: response.anonymizeProjects,
			anonymizeSessions: response.anonymizeSessions,
			retentionDays: response.retentionDays,
		});

		if (Result.isFailure(updateResult)) {
			log(pc.red(`Failed to update settings: ${updateResult.error.message}`));
			return;
		}

		log(pc.green('\n✓ Privacy settings updated successfully!'));

		// Show summary
		log('\nNew settings:');
		log(`  Anonymize projects: ${response.anonymizeProjects ? pc.green('Yes') : pc.gray('No')}`);
		log(`  Anonymize sessions: ${response.anonymizeSessions ? pc.green('Yes') : pc.gray('No')}`);
		log(`  Retention period: ${pc.cyan(`${response.retentionDays} days`)}`);
	},
});

/**
 * Privacy status subcommand - Show current privacy settings
 */
const statusCommand = define({
	name: 'status',
	description: 'Show current privacy settings',
	async run() {
		const privacy = getPrivacyControls();

		// Load settings
		const result = await privacy.loadSettings();
		if (Result.isFailure(result)) {
			log(pc.red(`Failed to load privacy settings: ${result.error.message}`));
			return;
		}

		const settings = result.value;

		log(pc.bold('🔐 Privacy Settings\n'));

		const table = new Table({
			head: ['Setting', 'Value'],
			style: { head: ['cyan'] },
		});

		table.push(
			['Encryption Enabled', pc.green('Yes')], // Always enabled in v3
			['Anonymize Projects', settings.anonymizeProjects ? pc.green('Yes') : pc.gray('No')],
			['Anonymize Sessions', settings.anonymizeSessions ? pc.green('Yes') : pc.gray('No')],
			['Retention Days', pc.cyan(settings.retentionDays.toString())],
			['Last Key Rotation', pc.gray('N/A')], // Will be implemented later
		);

		log(table.toString());

		// Show additional info
		log('\nRetention policy:');
		const cutoffDate = privacy.getRetentionCutoffDate();
		log(`  Data older than ${pc.yellow(cutoffDate.toLocaleDateString())} will be deleted`);

		if (settings.anonymizeProjects || settings.anonymizeSessions) {
			log('\nAnonymization:');
			if (settings.anonymizeProjects) {
				log(`  Project names are anonymized (e.g., "my-app" → "project-a3f8b2c1")`);
			}
			if (settings.anonymizeSessions) {
				log(`  Session IDs are anonymized (e.g., "session-123" → "session-d4e9f3a2")`);
			}
		}

		log(pc.gray('\nRun \'ccusage privacy config\' to change these settings.'));
	},
});

/**
 * Privacy retention subcommand - Set data retention policy
 */
const retentionCommand = define({
	name: 'retention',
	description: 'Set data retention policy',
	args: {
		days: {
			type: 'number',
			short: 'd',
			description: 'Number of days to retain data (30-730)',
			required: true,
		},
	},
	async run(ctx) {
		const days = ctx.values.days;

		// Validate days
		if (days < 30 || days > 730) {
			log(pc.red('Error: Retention days must be between 30 and 730'));
			return;
		}

		const privacy = getPrivacyControls();

		// Update retention setting
		const result = await privacy.updateSettings({ retentionDays: days });
		if (Result.isFailure(result)) {
			log(pc.red(`Failed to update retention policy: ${result.error.message}`));
			return;
		}

		log(pc.green(`✓ Data retention policy updated to ${days} days`));

		// Show what this means
		const cutoffDate = privacy.getRetentionCutoffDate();
		log(pc.gray(`\nData older than ${cutoffDate.toLocaleDateString()} will be deleted during next sync.`));
	},
});

/**
 * Privacy export subcommand - Export user data
 */
const exportCommand = define({
	name: 'export',
	description: 'Export your usage data',
	args: {
		format: {
			type: 'string',
			short: 'f',
			description: 'Export format (json or csv)',
			default: 'json',
			choices: ['json', 'csv'],
		},
		output: {
			type: 'string',
			short: 'o',
			description: 'Output file path (default: stdout)',
		},
	},
	async run(ctx) {
		const privacy = getPrivacyControls();

		// Load settings
		const settingsResult = await privacy.loadSettings();
		if (Result.isFailure(settingsResult)) {
			log(pc.red(`Failed to load privacy settings: ${settingsResult.error.message}`));
			return;
		}

		// Prepare export data
		const exportData = {
			exportDate: new Date().toISOString(),
			userId: 'local-user', // Will be updated when cloud sync is available
			deviceName: 'current-device', // Will be updated when cloud sync is available
			privacySettings: settingsResult.value,
			data: {
				daily: {}, // TODO: Load actual daily data
				sessions: {}, // TODO: Load actual session data
				aggregated: {}, // TODO: Load aggregated data
			},
		};

		let output: string;

		// Export based on format
		if (ctx.values.format === 'csv') {
			const result = await privacy.exportDataAsCSV(exportData);
			if (Result.isFailure(result)) {
				log(pc.red(`Failed to export data: ${result.error.message}`));
				return;
			}
			output = result.value;
		}
		else {
			const result = await privacy.exportDataAsJSON(exportData);
			if (Result.isFailure(result)) {
				log(pc.red(`Failed to export data: ${result.error.message}`));
				return;
			}
			output = result.value;
		}

		// Output to file or stdout
		if (ctx.values.output) {
			const { writeFile } = await import('node:fs/promises');
			try {
				await writeFile(ctx.values.output, output);
				log(pc.green(`✓ Data exported to ${ctx.values.output}`));
			}
			catch (error) {
				log(pc.red(`Failed to write file: ${error}`));
			}
		}
		else {
			log(output);
		}
	},
});

/**
 * Privacy anonymize subcommand - Toggle anonymization settings
 */
const anonymizeCommand = define({
	name: 'anonymize',
	description: 'Toggle anonymization settings',
	args: {
		projects: {
			type: 'boolean',
			short: 'p',
			description: 'Enable/disable project name anonymization',
		},
		sessions: {
			type: 'boolean',
			short: 's',
			description: 'Enable/disable session ID anonymization',
		},
	},
	async run(ctx) {
		const privacy = getPrivacyControls();

		// Load current settings
		const currentResult = await privacy.loadSettings();
		if (Result.isFailure(currentResult)) {
			log(pc.red(`Failed to load privacy settings: ${currentResult.error.message}`));
			return;
		}

		const updates: Partial<PrivacySettings> = {};

		// Update settings based on flags
		if (ctx.values.projects !== undefined) {
			updates.anonymizeProjects = ctx.values.projects;
		}

		if (ctx.values.sessions !== undefined) {
			updates.anonymizeSessions = ctx.values.sessions;
		}

		if (Object.keys(updates).length === 0) {
			log(pc.yellow('No changes specified. Use --projects or --sessions flags.'));
			return;
		}

		// Apply updates
		const result = await privacy.updateSettings(updates);
		if (Result.isFailure(result)) {
			log(pc.red(`Failed to update anonymization settings: ${result.error.message}`));
			return;
		}

		log(pc.green('✓ Anonymization settings updated'));

		// Show new settings
		if (updates.anonymizeProjects !== undefined) {
			log(`  Project names: ${updates.anonymizeProjects ? pc.green('Anonymized') : pc.gray('Not anonymized')}`);
		}
		if (updates.anonymizeSessions !== undefined) {
			log(`  Session IDs: ${updates.anonymizeSessions ? pc.green('Anonymized') : pc.gray('Not anonymized')}`);
		}
	},
});

/**
 * Main privacy command with subcommands
 */
export const privacyCommand = define({
	name: 'privacy',
	description: 'Manage privacy settings and data retention',
	subCommands: new Map([
		['config', configCommand],
		['status', statusCommand],
		['retention', retentionCommand],
		['export', exportCommand],
		['anonymize', anonymizeCommand],
	]),
	async run() {
		// Show help when no subcommand is provided
		log(pc.bold('Privacy Control Commands:\n'));
		log(`  ${pc.cyan('ccusage privacy config')}      - Configure privacy settings interactively`);
		log(`  ${pc.cyan('ccusage privacy status')}      - Show current privacy settings`);
		log(`  ${pc.cyan('ccusage privacy retention')}   - Set data retention policy`);
		log(`  ${pc.cyan('ccusage privacy export')}      - Export your usage data`);
		log(`  ${pc.cyan('ccusage privacy anonymize')}   - Toggle anonymization settings`);
		log();
		log(pc.gray('Run any command with --help for more information.'));
	},
});
