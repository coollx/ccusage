#!/usr/bin/env bun
/**
 * Firebase Debug Script - Check what's actually in the database
 */

import { Result } from '@praha/byethrow';
import { getFirebaseClient } from '../src/cloud-sync/firebase-client.ts';
import { log } from '../src/logger.ts';

async function debugFirebase() {
	log('🔍 Firebase Debug Script\n');

	// Initialize Firebase client
	const client = getFirebaseClient();
	log('Initializing Firebase...');
	const initResult = await client.initialize();

	if (Result.isFailure(initResult)) {
		log('❌ Failed to initialize Firebase:', (initResult as { error: Error }).error.message);
		return;
	}

	log('✅ Firebase initialized');

	// Get user ID from Firebase
	const userIdResult = client.getUserId();
	if (Result.isFailure(userIdResult)) {
		log('❌ Failed to get user ID:', (userIdResult as { error: Error }).error.message);
		return;
	}

	const firebaseUserId = userIdResult.value;
	log(`📝 Firebase user ID: ${firebaseUserId}`);

	// Use the saved user ID instead
	const savedUserId = 'xLMCqTj9h6Z81x1KsrXd5EJkctl1';
	log(`📝 Saved user ID: ${savedUserId}`);
	log(`📝 Using saved user ID for queries\n`);

	const userId = savedUserId; // Use saved ID for all queries

	// Test 1: Check if user document exists
	log('Test 1: Checking user document...');
	const userDocPath = `users/${userId}`;
	const userDocResult = await client.docExists(userDocPath);
	log(`User doc exists at ${userDocPath}: ${Result.isSuccess(userDocResult) && userDocResult.value ? '✅ YES' : '❌ NO'}\n`);

	// Test 2: List devices
	log('Test 2: Listing devices...');
	const devicesPath = `users/${userId}/devices`;
	const devicesResult = await client.queryCollection(devicesPath);

	if (Result.isSuccess(devicesResult)) {
		log(`Found ${devicesResult.value.length} devices:`);
		for (const device of devicesResult.value) {
			log(`  - ${device.id || 'Unknown'}`);
		}
	}
	else {
		log('❌ Failed to query devices:', (devicesResult as { error: Error }).error?.message || 'Unknown error');
	}
	log();

	// Test 3: Check specific device
	log('Test 3: Checking Work MacBook device...');
	const devicePath = `users/${userId}/devices/Work MacBook`;
	const deviceResult = await client.getDoc(devicePath);

	if (Result.isSuccess(deviceResult)) {
		if (deviceResult.value) {
			log('✅ Device found:', JSON.stringify(deviceResult.value, null, 2));
		}
		else {
			log('❌ Device document does not exist');
		}
	}
	else {
		log('❌ Failed to get device:', (deviceResult as { error: Error }).error?.message || 'Unknown error');
	}
	log();

	// Test 4: List usage documents
	log('Test 4: Listing usage documents...');
	const usagePath = `users/${userId}/devices/Work MacBook/usage`;
	const usageResult = await client.queryCollection(usagePath);

	if (Result.isSuccess(usageResult)) {
		log(`Found ${usageResult.value.length} usage documents:`);
		for (const doc of usageResult.value) {
			log(`  - ${doc.id || 'Unknown'}`);
		}
	}
	else {
		log('❌ Failed to query usage:', (usageResult as { error: Error }).error?.message || 'Unknown error');
	}
	log();

	// Test 5: Try a test write
	log('Test 5: Attempting test write...');
	const testPath = `users/${userId}/test/debug-${Date.now()}`;
	const testData = {
		timestamp: new Date().toISOString(),
		message: 'Debug test write',
		userId,
	};

	const writeResult = await client.setDoc(testPath, testData);
	if (Result.isSuccess(writeResult)) {
		log('✅ Test write succeeded');

		// Verify the write
		const verifyResult = await client.getDoc(testPath);
		if (Result.isSuccess(verifyResult) && verifyResult.value) {
			log('✅ Test write verified - document exists');
			log('Data:', JSON.stringify(verifyResult.value, null, 2));
		}
		else {
			log('❌ Test write verification failed - document not found');
		}
	}
	else {
		log('❌ Test write failed:', (writeResult as { error: Error }).error?.message || 'Unknown error');
	}
	log();

	// Test 6: Try batch write
	log('Test 6: Attempting batch write...');
	const batchOps = [
		{
			path: `users/${userId}/test-batch/doc1`,
			data: { id: 'doc1', timestamp: new Date().toISOString() },
		},
		{
			path: `users/${userId}/test-batch/doc2`,
			data: { id: 'doc2', timestamp: new Date().toISOString() },
		},
	];

	const batchResult = await client.batchWrite(batchOps);
	if (Result.isSuccess(batchResult)) {
		log('✅ Batch write reported success');
	}
	else {
		log('❌ Batch write failed:', (batchResult as { error: Error }).error?.message || 'Unknown error');
	}
	log();

	// Test 7: Check authentication state
	log('Test 7: Authentication state...');
	const authStatus = await client.getSyncStatus();
	log('Auth status:', JSON.stringify(authStatus, null, 2));

	// Cleanup
	await client.disconnect();
	log('\n✅ Debug script completed');
}

// Run the debug script
debugFirebase().catch((error) => {
	console.error('Debug script error:', error);
	process.exit(1);
});
