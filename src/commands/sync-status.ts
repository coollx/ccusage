import { syncSubCommands } from './sync.ts';

/**
 * Re-export the status subcommand from sync.ts as a top-level command
 */
export const syncStatusCommand = syncSubCommands.get('status')!;
