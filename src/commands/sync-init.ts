import { syncSubCommands } from './sync.ts';

/**
 * Re-export the init subcommand from sync.ts as a top-level command
 */
export const syncInitCommand = syncSubCommands.get('init')!;
