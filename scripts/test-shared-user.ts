#!/usr/bin/env bun
/**
 * Test shared user sync
 */

import { getSyncEngine } from '../src/cloud-sync/sync-engine.ts';
import { log } from '../src/logger.ts';

async function testSharedUser() {
	log('🔍 Testing Shared User Sync\n');

	// Run sync
	log('Running sync with shared user ID...');
	const syncEngine = getSyncEngine();
	const syncResult = await syncEngine.syncNewData();

	if (syncResult.success) {
		log(`✅ Sync completed successfully!`);
		log(`   Records synced: ${syncResult.recordsSynced}`);
		log(`   Duration: ${syncResult.duration}ms`);
		log(`\n📍 View your data at:`);
		log(`   https://console.firebase.google.com/project/ccusage-sync/firestore/data/~2Fusers~2Fshared-ccusage-user`);
	}
	else {
		log(`❌ Sync failed: ${syncResult.error}`);
	}
}

testSharedUser().catch((error) => {
	console.error('Test error:', error);
	process.exit(1);
});
