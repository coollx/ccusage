import { syncSubCommands } from './sync.ts';

/**
 * Re-export the devices subcommand from sync.ts as a top-level command
 */
export const syncDevicesCommand = syncSubCommands.get('devices')!;
