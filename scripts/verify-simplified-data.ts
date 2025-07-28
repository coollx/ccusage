#!/usr/bin/env bun
/**
 * Verify Firebase data with simplified structure
 */

import { Result } from '@praha/byethrow';
import { getFirebaseClient } from '../src/cloud-sync/firebase-client.ts';
import { log } from '../src/logger.ts';

async function verifyData() {
	log('🔍 Verifying Firebase Data (Simplified Structure)\n');

	// Initialize Firebase client
	const client = getFirebaseClient();
	const initResult = await client.initialize();

	if (Result.isFailure(initResult)) {
		log('❌ Failed to initialize Firebase');
		return;
	}

	// Check specific paths
	log('🔍 Checking simplified paths:\n');

	// 1. Check device document directly
	const devicePath = `devices/Work MacBook`;
	log(`Checking device at: ${devicePath}`);
	const deviceResult = await client.getDoc(devicePath);

	if (Result.isSuccess(deviceResult)) {
		if (deviceResult.value) {
			log('✅ Device document exists:', JSON.stringify(deviceResult.value, null, 2));
		}
		else {
			log('❌ Device document does not exist');
		}
	}
	else {
		log('❌ Failed to get device:', (deviceResult as { error: Error }).error?.message);
	}

	// 2. Check a usage document directly
	const usagePath = `devices/Work MacBook/usage/2025-07-14`;
	log(`\nChecking usage at: ${usagePath}`);
	const usageResult = await client.getDoc(usagePath);

	if (Result.isSuccess(usageResult)) {
		if (usageResult.value) {
			log('✅ Usage document exists');
			log(`   Date: ${usageResult.value.date}`);
			log(`   Total cost: $${usageResult.value.totalCost?.toFixed(2)}`);
			log(`   Total tokens: ${usageResult.value.totalTokens}`);
		}
		else {
			log('❌ Usage document does not exist');
		}
	}
	else {
		log('❌ Failed to get usage:', (usageResult as { error: Error }).error?.message);
	}

	// 3. List all devices
	log(`\nListing all devices...`);
	const devicesResult = await client.queryCollection('devices');

	if (Result.isSuccess(devicesResult)) {
		log(`✅ Found ${devicesResult.value.length} devices`);
		for (const device of devicesResult.value) {
			log(`   - ${device.id}: ${device.deviceName || 'unnamed'}`);
		}
	}
	else {
		log('❌ Failed to list devices');
	}

	// 4. List usage documents for Work MacBook
	const allUsagePath = `devices/Work MacBook/usage`;
	log(`\nListing usage documents at: ${allUsagePath}`);
	const allUsageResult = await client.queryCollection(allUsagePath);

	if (Result.isSuccess(allUsageResult)) {
		log(`✅ Found ${allUsageResult.value.length} usage documents`);
		for (const doc of allUsageResult.value.slice(0, 5)) {
			log(`   - ${doc.id}: $${doc.totalCost?.toFixed(2) || '0.00'}`);
		}
	}
	else {
		log('❌ Failed to list usage documents');
	}

	await client.disconnect();
	log('\n✅ Verification completed');
}

verifyData().catch((error) => {
	console.error('Verification error:', error);
	process.exit(1);
});
