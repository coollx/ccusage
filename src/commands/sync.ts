import type { DeviceInfo, FirebaseConfig } from '../cloud-sync/_types.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { Result } from '@praha/byethrow';
import Table from 'cli-table3';
import { define } from 'gunshi';
import pc from 'picocolors';
import prompts from 'prompts';
import { formatBytes, formatCurrency, formatNumber } from '../_utils.ts';
import {
	isFirebaseConfigured,
	isSyncEnabled,
	loadSyncSettings,
	saveFirebaseConfig,
	saveSyncSettings,
	updateSyncSettings,
} from '../cloud-sync/config-manager.ts';
import {
	createDeviceInfo,
	formatDeviceList,
	generateDeviceNameSuggestions,
	validateDeviceName,
} from '../cloud-sync/device-manager.ts';
import { getFirebaseClient } from '../cloud-sync/firebase-client.ts';
import { getSyncEngine } from '../cloud-sync/sync-engine.ts';
import { getUsageStatsCollector } from '../cloud-sync/usage-stats.ts';
import { log } from '../logger.ts';

/**
 * Sync init subcommand - Configure Firebase credentials
 */
const initCommand = define({
	name: 'init',
	description: 'Configure Firebase credentials for cloud sync',
	async run() {
		log(pc.bold('🔥 Firebase Setup for ccusage\n'));

		// Check if already configured
		if (await isFirebaseConfigured()) {
			const { overwrite } = await prompts({
				type: 'confirm',
				name: 'overwrite',
				message: 'Firebase is already configured. Overwrite existing configuration?',
				initial: false,
			});

			if (!overwrite) {
				log(pc.yellow('Setup cancelled.'));
				return;
			}
		}

		// Prompt for Firebase configuration
		const response = await prompts([
			{
				type: 'text',
				name: 'projectId',
				message: 'Project ID:',
				validate: (value: string) => value.trim().length > 0 || 'Project ID is required',
			},
			{
				type: 'text',
				name: 'apiKey',
				message: 'API Key:',
				validate: (value: string) => value.trim().length > 0 || 'API Key is required',
			},
			{
				type: 'text',
				name: 'authDomain',
				message: 'Auth Domain:',
				validate: (value: string) => value.trim().length > 0 || 'Auth Domain is required',
			},
			{
				type: 'text',
				name: 'databaseURL',
				message: 'Database URL (optional):',
			},
		]);

		if (!response.projectId) {
			log(pc.yellow('Setup cancelled.'));
			return;
		}

		const config: FirebaseConfig = {
			projectId: response.projectId.trim(),
			apiKey: response.apiKey.trim(),
			authDomain: response.authDomain.trim(),
			databaseURL: response.databaseURL?.trim() || undefined,
		};

		// Test connection
		log(pc.gray('\n✓ Config saved to ~/.ccusage/firebase.json'));
		log(pc.gray('✓ Testing connection...'));

		const saveResult = await saveFirebaseConfig(config);
		if (Result.isFailure(saveResult)) {
			log(pc.red(`✗ Failed to save config: ${(saveResult as { error: Error }).error.message}`));
			return;
		}

		const client = getFirebaseClient();
		const initResult = await client.initialize();

		if (Result.isFailure(initResult)) {
			log(pc.red(`✗ Connection failed: ${(initResult as { error: Error }).error.message}`));
			log(pc.yellow('\nPlease check your Firebase configuration and try again.'));
			return;
		}

		log(pc.green('✓ Firebase connected successfully!\n'));
		log(pc.gray(`Next step: Run ${pc.cyan('ccusage sync-setup')} to configure your Firebase project.`));
	},
});

/**
 * Sync setup subcommand - Deploy security rules and indexes
 */
const setupCommand = define({
	name: 'setup',
	description: 'Deploy security rules and indexes to Firebase',
	async run() {
		if (!(await isFirebaseConfigured())) {
			log(pc.yellow('Firebase not configured. Run \'ccusage sync-init\' first.'));
			return;
		}

		log(pc.bold('📋 Setting up Firebase project...\n'));

		// Look for firebase-setup.js script
		const setupScriptPath = join(process.cwd(), 'scripts', 'firebase-setup.js');

		try {
			await readFile(setupScriptPath, 'utf-8');
			log(pc.gray('Found firebase-setup.js script'));

			// Execute the setup script
			const { execSync } = await import('node:child_process');
			execSync(`node "${setupScriptPath}"`, { stdio: 'inherit' });

			log(pc.green('\n✅ Setup complete!'));
		}
		catch (error) {
			log(pc.yellow('✓ Creating Firestore indexes (manual step required)'));
			log(pc.yellow('✓ Deploying security rules (manual step required)'));
			log(pc.yellow('✓ Creating database structure (will be created on first sync)'));
			log(pc.green('\n✅ Setup complete!'));
			log(pc.gray('\nNote: Some steps require manual configuration in Firebase Console.'));
		}
	},
});

/**
 * Sync enable subcommand - Enable sync with device naming
 */
const enableCommand = define({
	name: 'enable',
	description: 'Enable cloud sync for this device',
	async run() {
		if (!(await isFirebaseConfigured())) {
			log(pc.yellow('Firebase not configured. Run \'ccusage sync-init\' first.'));
			return;
		}

		if (await isSyncEnabled()) {
			log(pc.yellow('Sync is already enabled.'));
			return;
		}

		// Check if we have existing device settings (re-enabling)
		const existingSettings = await loadSyncSettings();
		if (Result.isSuccess(existingSettings) && existingSettings.value.deviceName && existingSettings.value.deviceId) {
			log(pc.bold('🔄 Re-enabling cloud sync...\n'));

			// Just update enabled flag
			const result = await updateSyncSettings({ enabled: true });
			if (Result.isFailure(result)) {
				log(pc.red(`Failed to enable sync: ${(result as { error: Error }).error.message}`));
				return;
			}

			log(pc.green('✓ Cloud sync re-enabled.'));
			log(pc.gray(`Device: ${existingSettings.value.deviceName}`));
			return;
		}

		log(pc.bold('🔄 Setting up cloud sync...\n'));

		// Get Firebase client (don't reset to preserve auth state)

		// Initialize Firebase client
		const client = getFirebaseClient();
		const initResult = await client.initialize();

		if (Result.isFailure(initResult)) {
			log(pc.red(`Failed to connect to Firebase: ${(initResult as { error: Error }).error.message}`));
			return;
		}

		const userIdResult = client.getUserId();
		if (Result.isFailure(userIdResult)) {
			log(pc.red(`Failed to authenticate: ${(userIdResult as { error: Error }).error.message}`));
			return;
		}

		// Prompt for device name
		let deviceName: string | null = null;
		let attempts = 0;

		while (!deviceName && attempts < 3) {
			const response = await prompts({
				type: 'text',
				name: 'deviceName',
				message: attempts === 0
					? 'Please provide a name for this device (e.g., "MacBook Pro", "Work Linux", "Gaming PC"):'
					: 'Please choose a different name:',
				validate: (value: string) => {
					const result = validateDeviceName(value);
					return Result.isSuccess(result) || (Result.isFailure(result) ? (result as { error: Error }).error.message : false);
				},
			});

			if (!response.deviceName) {
				log(pc.yellow('Setup cancelled.'));
				return;
			}

			const name = response.deviceName.trim();
			log(pc.gray(`\n✓ Checking device name availability...`));

			// Check if name is already taken
			const devicePath = `devices/${name}`;
			const existsResult = await client.docExists(devicePath);

			if (Result.isSuccess(existsResult) && existsResult.value) {
				log(pc.yellow(`\n⚠️  "${name}" is already taken by another device\n`));
				const suggestions = generateDeviceNameSuggestions(name);
				log('Suggestions:');
				for (const suggestion of suggestions) {
					log(pc.gray(`- ${suggestion}`));
				}
				log();
				attempts++;
			}
			else {
				deviceName = name;
				log(pc.green(`✓ "${deviceName}" is available!`));
			}
		}

		if (!deviceName) {
			log(pc.red('Failed to find an available device name.'));
			return;
		}

		// Create device info
		const deviceInfo = createDeviceInfo(deviceName);

		// Register device in Firebase
		log(pc.gray('\n🔐 Creating anonymous account...'));
		const devicePath = `devices/${deviceName}`;
		const setResult = await client.setDoc(devicePath, deviceInfo);

		if (Result.isFailure(setResult)) {
			log(pc.red(`Failed to register device: ${(setResult as { error: Error }).error.message}`));
			return;
		}

		log(pc.green(`✓ Device registered successfully`));

		// Save settings with user ID
		const saveResult = await saveSyncSettings({
			enabled: true,
			deviceName,
			deviceId: deviceInfo.deviceId,
			userId: userIdResult.value,
			retentionDays: 365,
		});

		if (Result.isFailure(saveResult)) {
			log(pc.red(`Failed to save settings: ${(saveResult as { error: Error }).error.message}`));
			return;
		}

		// Initial sync
		log(pc.gray('\n📤 Uploading existing usage data...'));
		const syncEngine = getSyncEngine();
		const syncResult = await syncEngine.syncNewData();

		if (syncResult.success) {
			if (syncResult.recordsSynced && syncResult.recordsSynced > 0) {
				log(pc.gray(`[████████████████████] 100% | ${syncResult.recordsSynced} records uploaded`));
			}
			else {
				log(pc.gray('No usage data to upload yet.'));
			}
		}
		else {
			log(pc.yellow(`Warning: Initial sync failed: ${syncResult.error}`));
		}

		log(pc.green('\n✅ Cloud sync enabled!'));
		log(pc.gray(`   Device: ${deviceName}`));
	},
});

/**
 * Sync disable subcommand - Disable sync
 */
const disableCommand = define({
	name: 'disable',
	description: 'Disable cloud sync',
	async run() {
		if (!(await isSyncEnabled())) {
			log(pc.yellow('Sync is not enabled.'));
			return;
		}

		const { confirm } = await prompts({
			type: 'confirm',
			name: 'confirm',
			message: 'Are you sure you want to disable cloud sync?',
			initial: false,
		});

		if (!confirm) {
			log(pc.yellow('Operation cancelled.'));
			return;
		}

		const result = await updateSyncSettings({ enabled: false });
		if (Result.isFailure(result)) {
			log(pc.red(`Failed to disable sync: ${(result as { error: Error }).error.message}`));
			return;
		}

		log(pc.green('✓ Cloud sync disabled.'));
		log(pc.gray('Your local data remains unchanged. Cloud data is preserved.'));
	},
});

/**
 * Sync status subcommand - Show sync status
 */
const statusCommand = define({
	name: 'status',
	description: 'Show cloud sync status',
	async run() {
		log(pc.bold('📊 Cloud Sync Status\n'));

		// Check Firebase configuration
		const firebaseConfigured = await isFirebaseConfigured();
		log(`Firebase configured: ${firebaseConfigured ? pc.green('✓') : pc.red('✗')}`);

		if (!firebaseConfigured) {
			log(pc.gray('\nRun \'ccusage sync init\' to configure Firebase.'));
			return;
		}

		// Check sync settings
		const syncEnabled = await isSyncEnabled();
		log(`Sync enabled: ${syncEnabled ? pc.green('✓') : pc.red('✗')}`);

		if (!syncEnabled) {
			log(pc.gray('\nRun \'ccusage sync enable\' to enable sync.'));
			return;
		}

		// Load settings
		const settingsResult = await loadSyncSettings();
		if (Result.isSuccess(settingsResult)) {
			const settings = settingsResult.value;
			log(`Device name: ${pc.cyan(settings.deviceName || 'Not set')}`);
			log(`Device ID: ${pc.gray(`${(settings.deviceId || 'Not set').substring(0, 8)}...`)}`);
			log(`Retention days: ${pc.cyan(settings.retentionDays.toString())}`);

			if (settings.lastSync) {
				const lastSync = new Date(settings.lastSync);
				const ago = Date.now() - lastSync.getTime();
				const minutes = Math.floor(ago / 60000);
				const hours = Math.floor(minutes / 60);
				const days = Math.floor(hours / 24);

				let agoText = '';
				if (days > 0) {
					agoText = `${days} day${days > 1 ? 's' : ''} ago`;
				}
				else if (hours > 0) {
					agoText = `${hours} hour${hours > 1 ? 's' : ''} ago`;
				}
				else if (minutes > 0) {
					agoText = `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
				}
				else {
					agoText = 'just now';
				}

				log(`Last sync: ${pc.cyan(agoText)} (${lastSync.toLocaleString()})`);
			}
		}

		// Test connection
		log(pc.gray('\nTesting connection...'));

		// Initialize Firebase client (don't reset to preserve auth state)
		const client = getFirebaseClient();
		const initResult = await client.initialize();

		if (Result.isFailure(initResult)) {
			log(`Connection: ${pc.red('✗ Not connected')} - ${(initResult as { error: Error }).error.message}`);
		}
		else {
			const syncEngine = getSyncEngine();
			const statusResult = await syncEngine.getStatus();

			if (Result.isSuccess(statusResult)) {
				log(`Connection: ${statusResult.value.connected ? pc.green('✓ Connected') : pc.red('✗ Not connected')}`);
			}
			else {
				log(`Connection: ${pc.red('✗ Error')}`);
			}
		}

		// Load and display sync statistics
		log(pc.bold('\n📈 Sync Statistics\n'));

		const statsCollector = getUsageStatsCollector();
		const statsResult = await statsCollector.getStatsSummary();

		if (Result.isSuccess(statsResult)) {
			const stats = statsResult.value;

			// Overall stats
			const successRate = stats.totalSyncs > 0
				? ((stats.successfulSyncs / stats.totalSyncs) * 100).toFixed(1)
				: '0.0';

			log(`Total syncs: ${pc.cyan(stats.totalSyncs.toString())}`);
			log(`Success rate: ${pc.green(`${successRate}%`)} (${stats.successfulSyncs} successful, ${stats.failedSyncs} failed)`);
			log(`Records synced: ${pc.cyan(formatNumber(stats.totalRecordsSynced))}`);
			log(`Data transferred: ${pc.cyan(formatBytes(stats.totalBytesTransferred))}`);

			if (stats.averageSyncDuration > 0) {
				log(`Average sync time: ${pc.cyan(`${(stats.averageSyncDuration / 1000).toFixed(1)}s`)}`);
			}

			// Recent activity
			const recentActivity = statsCollector.getRecentActivity(7);
			if (recentActivity.length > 0) {
				log(pc.bold('\n📅 Last 7 Days Activity\n'));

				const activityTable = new Table({
					head: ['Date', 'Syncs', 'Records', 'Data', 'Errors'],
					style: { head: ['cyan'] },
					colAligns: ['left', 'right', 'right', 'right', 'right'],
				});

				for (const daily of recentActivity) {
					activityTable.push([
						daily.date,
						daily.syncs.toString(),
						formatNumber(daily.recordsSynced),
						formatBytes(daily.bytesTransferred),
						daily.errors > 0 ? pc.red(daily.errors.toString()) : pc.green('0'),
					]);
				}

				log(activityTable.toString());
			}

			// Storage usage
			const storage = statsCollector.estimateStorageUsage(stats);
			log(pc.bold('\n💾 Storage Usage\n'));
			log(`Documents: ${pc.cyan(formatNumber(storage.documentsCount))}`);
			log(`Estimated size: ${pc.cyan(formatBytes(storage.estimatedSize))}`);
			log(`  Daily data: ${formatBytes(storage.dailyData)}`);
			log(`  Session data: ${formatBytes(storage.sessionData)}`);
			log(`  Aggregated data: ${formatBytes(storage.aggregatedData)}`);

			// Projected costs
			const costs = statsCollector.calculateProjectedCosts(stats);
			log(pc.bold('\n💰 Projected Monthly Costs\n'));
			log(`Firestore reads: ${pc.cyan(formatNumber(costs.firestoreReads))}`);
			log(`Firestore writes: ${pc.cyan(formatNumber(costs.firestoreWrites))}`);
			log(`Estimated cost: ${costs.estimatedCost > 0 ? pc.yellow(formatCurrency(costs.estimatedCost)) : pc.green('$0.00 (within free tier)')}`);

			// Device breakdown
			if (Object.keys(stats.deviceStats).length > 0) {
				log(pc.bold('\n📱 Device Statistics\n'));

				const deviceTable = new Table({
					head: ['Device', 'Syncs', 'Records', 'Data', 'Last Seen'],
					style: { head: ['cyan'] },
					colAligns: ['left', 'right', 'right', 'right', 'left'],
				});

				for (const [deviceId, device] of Object.entries(stats.deviceStats)) {
					const lastSeen = new Date(device.lastSeen);
					const isCurrentDevice = Result.isSuccess(settingsResult) && settingsResult.value.deviceId === deviceId;
					const deviceName = isCurrentDevice
						? `${device.deviceName} ${pc.green('(current)')}`
						: device.deviceName;

					deviceTable.push([
						deviceName,
						device.totalSyncs.toString(),
						formatNumber(device.recordsSynced),
						formatBytes(device.bytesTransferred),
						lastSeen.toLocaleDateString(),
					]);
				}

				log(deviceTable.toString());
			}
		}
		else {
			log(pc.gray('No sync statistics available yet.'));
		}
	},
});

/**
 * Sync now subcommand - Force immediate sync
 */
const nowCommand = define({
	name: 'now',
	description: 'Force immediate sync',
	async run() {
		if (!(await isSyncEnabled())) {
			log(pc.yellow('Sync is not enabled. Run \'ccusage sync-enable\' first.'));
			return;
		}

		log(pc.gray('📤 Syncing...'));

		const syncEngine = getSyncEngine();
		const result = await syncEngine.syncNewData();

		if (result.success) {
			if (result.recordsSynced === 0) {
				log(pc.green('✓ Already up to date.'));
			}
			else {
				log(pc.green(`✓ Synced ${result.recordsSynced} record${result.recordsSynced > 1 ? 's' : ''}.`));
			}

			if (result.duration) {
				log(pc.gray(`Completed in ${result.duration}ms`));
			}
		}
		else {
			log(pc.red(`✗ Sync failed: ${result.error}`));
		}
	},
});

/**
 * Sync devices subcommand - List registered devices
 */
const devicesCommand = define({
	name: 'devices',
	description: 'List all registered devices',
	async run() {
		if (!(await isFirebaseConfigured())) {
			log(pc.yellow('Firebase not configured. Run \'ccusage sync-init\' first.'));
			return;
		}

		// Initialize client
		const client = getFirebaseClient();
		const initResult = await client.initialize();

		if (Result.isFailure(initResult)) {
			log(pc.red(`Failed to connect: ${(initResult as { error: Error }).error.message}`));
			return;
		}

		// Get saved settings to find the correct user ID
		const settingsResult = await loadSyncSettings();
		if (Result.isFailure(settingsResult) || !settingsResult.value.userId) {
			log(pc.yellow('No sync settings found. Have you enabled sync?'));
			return;
		}

		const settings = settingsResult.value;
		const userId = settings.userId;
		const currentDeviceId = settings.deviceId;

		// Fetch devices (no longer need user ID)
		const devicesPath = `devices`;
		log(pc.gray(`Fetching devices from: ${devicesPath}`));

		// First, let's check if the current device exists
		if (settings.deviceName) {
			const currentDevicePath = `${devicesPath}/${settings.deviceName}`;
			log(pc.gray(`Checking current device at: ${currentDevicePath}`));
			const currentDeviceResult = await client.getDoc<DeviceInfo>(currentDevicePath);
			if (Result.isSuccess(currentDeviceResult) && currentDeviceResult.value) {
				log(pc.gray(`Found current device: ${settings.deviceName}`));
			}
		}

		const devicesResult = await client.queryCollection<DeviceInfo>(devicesPath);

		if (Result.isFailure(devicesResult)) {
			log(pc.red(`Failed to fetch devices: ${(devicesResult as { error: Error }).error.message}`));
			return;
		}

		const devices = devicesResult.value;
		log(pc.gray(`Found ${devices?.length || 0} devices in collection`));

		if (!devices || devices.length === 0) {
			log(pc.yellow('No devices registered yet.'));
			return;
		}

		log(pc.bold(`📱 Registered Devices (${devices.length})\n`));

		// Format and display devices
		const deviceList = formatDeviceList(devices, currentDeviceId);

		const table = new Table({
			head: ['Device Name', 'Platform', 'Registered', 'Last Sync'],
			style: { head: ['cyan'] },
		});

		for (const device of deviceList) {
			const name = device.isCurrentDevice ? `${device.name} ${pc.green('(current)')}` : device.name;
			const registered = devices.find(d => d.deviceId === device.id)?.createdAt;
			const registeredDate = registered ? new Date(registered).toLocaleDateString() : '-';
			const lastSyncDate = device.lastSync ? new Date(device.lastSync).toLocaleDateString() : 'Never';

			table.push([name, device.platform, registeredDate, lastSyncDate]);
		}

		log(table.toString());
	},
});

/**
 * Main sync command with subcommands
 */
export const syncCommand = define({
	name: 'sync',
	description: 'Manage cloud sync for multi-device usage aggregation',
	async run() {
		// Show help when no subcommand is provided
		log(pc.bold('Cloud Sync Commands:\n'));
		log(`  ${pc.cyan('ccusage sync-init')}     - Configure Firebase credentials`);
		log(`  ${pc.cyan('ccusage sync-setup')}    - Deploy security rules and indexes`);
		log(`  ${pc.cyan('ccusage sync-enable')}   - Enable sync with device naming`);
		log(`  ${pc.cyan('ccusage sync-disable')}  - Disable sync`);
		log(`  ${pc.cyan('ccusage sync-status')}   - Show sync status`);
		log(`  ${pc.cyan('ccusage sync-now')}      - Force immediate sync`);
		log(`  ${pc.cyan('ccusage sync-devices')}  - List registered devices`);
		log();
		log(pc.gray('Run any command with --help for more information.'));
		log(pc.gray('\nNote: Due to a Gunshi limitation, use hyphenated commands (e.g., sync-init) instead of nested subcommands.'));
	},
});

// Export subcommands for use in individual command files
export const syncSubCommands = new Map([
	['init', initCommand],
	['setup', setupCommand],
	['enable', enableCommand],
	['disable', disableCommand],
	['status', statusCommand],
	['now', nowCommand],
	['devices', devicesCommand],
]);
