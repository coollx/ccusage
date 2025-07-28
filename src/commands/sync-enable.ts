import { syncSubCommands } from './sync.ts';

/**
 * Re-export the enable subcommand from sync.ts as a top-level command
 */
export const syncEnableCommand = syncSubCommands.get('enable')!;
