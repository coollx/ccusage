#!/usr/bin/env bun
/**
 * Test batch write directly
 */

import { Result } from '@praha/byethrow';
import { getFirebaseClient } from '../src/cloud-sync/firebase-client.ts';
import { log } from '../src/logger.ts';

async function testBatchWrite() {
	log('🔍 Testing Batch Write\n');

	// Initialize Firebase client
	const client = getFirebaseClient();
	const initResult = await client.initialize();

	if (Result.isFailure(initResult)) {
		log('❌ Failed to initialize Firebase:', (initResult as { error: Error }).error.message);
		return;
	}

	log('✅ Firebase initialized');

	// Get current user ID
	const userIdResult = client.getUserId();
	if (Result.isFailure(userIdResult)) {
		log('❌ Failed to get user ID');
		return;
	}

	const currentUserId = userIdResult.value;
	log(`📝 Current Firebase user ID: ${currentUserId}\n`);

	// Test with both user IDs
	const testUserIds = [
		{ id: currentUserId, label: 'Current Firebase user' },
		{ id: 'xLMCqTj9h6Z81x1KsrXd5EJkctl1', label: 'Saved user (from settings)' },
	];

	for (const { id: userId, label } of testUserIds) {
		log(`\n🧪 Testing with ${label}: ${userId}`);

		const timestamp = Date.now();
		const operations = [
			{
				path: `users/${userId}/test-write/doc-${timestamp}`,
				data: {
					timestamp: new Date().toISOString(),
					message: 'Test batch write',
					userId,
					label,
				},
			},
		];

		log(`   Path: ${operations[0].path}`);
		log('   Attempting batch write...');

		const writeResult = await client.batchWrite(operations);

		if (Result.isSuccess(writeResult)) {
			log('   ✅ Batch write reported success');

			// Try to read it back
			log('   Verifying write...');
			const readResult = await client.getDoc(operations[0].path);

			if (Result.isSuccess(readResult)) {
				if (readResult.value) {
					log('   ✅ Document verified - write succeeded!');
					log('   Data:', JSON.stringify(readResult.value, null, 2));
				}
				else {
					log('   ❌ Document not found - write failed silently');
				}
			}
			else {
				log('   ❌ Read failed:', (readResult as { error: Error }).error?.message || 'Unknown error');
			}
		}
		else {
			log('   ❌ Batch write failed:', (writeResult as { error: Error }).error?.message || 'Unknown error');
		}
	}

	await client.disconnect();
	log('\n\n✅ Test completed');
}

testBatchWrite().catch((error) => {
	console.error('Test error:', error);
	process.exit(1);
});
