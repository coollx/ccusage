import process from 'node:process';
import { cli } from 'gunshi';
import { description, name, version } from '../../package.json';
import { blocksCommand } from './blocks.ts';
import { cleanupFirebase } from './cleanup.ts';
import { dailyCommand } from './daily.ts';
import { mcpCommand } from './mcp.ts';
import { monthlyCommand } from './monthly.ts';
import { privacyCommand } from './privacy.ts';
import { sessionCommand } from './session.ts';
import { syncDevicesCommand } from './sync-devices.ts';
import { syncDisableCommand } from './sync-disable.ts';
import { syncEnableCommand } from './sync-enable.ts';
import { syncInitCommand } from './sync-init.ts';
import { syncNowCommand } from './sync-now.ts';
import { syncSetupCommand } from './sync-setup.ts';
import { syncStatusCommand } from './sync-status.ts';
import { syncCommand } from './sync.ts';

/**
 * Map of available CLI subcommands
 */
const subCommands = new Map();
subCommands.set('daily', dailyCommand);
subCommands.set('monthly', monthlyCommand);
subCommands.set('session', sessionCommand);
subCommands.set('blocks', blocksCommand);
subCommands.set('mcp', mcpCommand);
subCommands.set('sync', syncCommand);
subCommands.set('privacy', privacyCommand);
// Flattened sync subcommands (workaround for Gunshi limitation)
subCommands.set('sync-init', syncInitCommand);
subCommands.set('sync-setup', syncSetupCommand);
subCommands.set('sync-enable', syncEnableCommand);
subCommands.set('sync-disable', syncDisableCommand);
subCommands.set('sync-status', syncStatusCommand);
subCommands.set('sync-now', syncNowCommand);
subCommands.set('sync-devices', syncDevicesCommand);

/**
 * Default command when no subcommand is specified (defaults to daily)
 */
const mainCommand = dailyCommand;

// eslint-disable-next-line antfu/no-top-level-await
await cli(process.argv.slice(2), mainCommand, {
	name,
	version,
	description,
	subCommands,
	renderHeader: null,
});

// Clean up Firebase connections
await cleanupFirebase();
