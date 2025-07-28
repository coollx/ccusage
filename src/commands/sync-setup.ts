import { syncSubCommands } from './sync.ts';

/**
 * Re-export the setup subcommand from sync.ts as a top-level command
 */
export const syncSetupCommand = syncSubCommands.get('setup')!;
