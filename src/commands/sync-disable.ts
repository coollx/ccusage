import { syncSubCommands } from './sync.ts';

/**
 * Re-export the disable subcommand from sync.ts as a top-level command
 */
export const syncDisableCommand = syncSubCommands.get('disable')!;
