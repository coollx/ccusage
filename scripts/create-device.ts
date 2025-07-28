#!/usr/bin/env bun
/**
 * Create device document in simplified structure
 */

import process from 'node:process';
import { Result } from '@praha/byethrow';
import { getFirebaseClient } from '../src/cloud-sync/firebase-client.ts';
import { log } from '../src/logger.ts';

async function createDevice() {
	log('🔧 Creating device document\n');

	// Initialize Firebase client
	const client = getFirebaseClient();
	const initResult = await client.initialize();

	if (Result.isFailure(initResult)) {
		log('❌ Failed to initialize Firebase');
		return;
	}

	// Create device document
	const devicePath = `devices/Work MacBook`;
	const deviceInfo = {
		deviceId: '787ab907-ce73-4686-b959-c87ab44dd30a',
		deviceName: 'Work MacBook',
		platform: process.platform,
		createdAt: new Date().toISOString(),
		syncVersion: 1,
	};

	log(`Creating device at: ${devicePath}`);
	const createResult = await client.setDoc(devicePath, deviceInfo);

	if (Result.isSuccess(createResult)) {
		log('✅ Device document created successfully');
	}
	else {
		log('❌ Failed to create device:', (createResult as { error: Error }).error?.message);
	}

	await client.disconnect();
	log('\n✅ Done');
}

createDevice().catch((error) => {
	console.error('Error:', error);
	process.exit(1);
});
