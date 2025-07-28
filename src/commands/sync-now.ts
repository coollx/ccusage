import { syncSubCommands } from './sync.ts';

/**
 * Re-export the now subcommand from sync.ts as a top-level command
 */
export const syncNowCommand = syncSubCommands.get('now')!;
