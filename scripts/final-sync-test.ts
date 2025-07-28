#!/usr/bin/env bun
/**
 * Final sync test - run sync and verify data
 */

import { Result } from '@praha/byethrow';
import { getFirebaseClient } from '../src/cloud-sync/firebase-client.ts';
import { getSyncEngine } from '../src/cloud-sync/sync-engine.ts';
import { log } from '../src/logger.ts';

async function finalSyncTest() {
	log('🔍 Final Sync Test\n');

	// Run sync
	log('Running sync...');
	const syncEngine = getSyncEngine();
	const syncResult = await syncEngine.syncNewData();

	if (syncResult.success) {
		log(`✅ Sync completed: ${syncResult.recordsSynced} records synced`);
	}
	else {
		log(`❌ Sync failed: ${syncResult.error}`);
		return;
	}

	// Initialize Firebase client to check data
	const client = getFirebaseClient();
	const initResult = await client.initialize();

	if (Result.isFailure(initResult)) {
		log('❌ Failed to initialize Firebase');
		return;
	}

	// Get current user ID
	const userIdResult = client.getUserId();
	if (Result.isFailure(userIdResult)) {
		log('❌ Failed to get user ID');
		return;
	}

	const userId = userIdResult.value;
	log(`\n📝 Checking data for user: ${userId}`);

	// Check devices
	const devicesPath = `users/${userId}/devices`;
	const devicesResult = await client.queryCollection(devicesPath);

	if (Result.isSuccess(devicesResult)) {
		log(`\n✅ Found ${devicesResult.value.length} devices:`);

		for (const device of devicesResult.value) {
			log(`\n📱 Device: ${device.id}`);

			// Check usage documents
			const usagePath = `users/${userId}/devices/${device.id}/usage`;
			const usageResult = await client.queryCollection(usagePath);

			if (Result.isSuccess(usageResult)) {
				log(`   Usage documents: ${usageResult.value.length}`);

				// Show first document as sample
				if (usageResult.value.length > 0) {
					const firstDoc = usageResult.value[0];
					log(`   Sample document (${firstDoc.id}):`);
					log(`   - Total cost: $${firstDoc.totalCost?.toFixed(2) || '0.00'}`);
					log(`   - Total tokens: ${firstDoc.totalTokens || 0}`);
					log(`   - Models: ${firstDoc.models?.length || 0}`);
				}
			}
		}
	}
	else {
		log('❌ Failed to query devices');
	}

	await client.disconnect();
	log('\n\n✅ Test completed');
}

finalSyncTest().catch((error) => {
	console.error('Test error:', error);
	process.exit(1);
});
