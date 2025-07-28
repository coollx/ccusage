#!/usr/bin/env bun
/**
 * Check all user IDs that have been created in Firebase
 */

import { Result } from '@praha/byethrow';
import { getFirebaseClient } from '../src/cloud-sync/firebase-client.ts';
import { log } from '../src/logger.ts';

async function checkFirebaseUsers() {
	log('🔍 Checking Firebase Users\n');

	// Initialize Firebase client
	const client = getFirebaseClient();
	const initResult = await client.initialize();

	if (Result.isFailure(initResult)) {
		log('❌ Failed to initialize Firebase:', (initResult as { error: Error }).error.message);
		return;
	}

	// Get current Firebase user
	const userIdResult = client.getUserId();
	if (Result.isFailure(userIdResult)) {
		log('❌ Failed to get user ID');
		return;
	}

	const currentUserId = userIdResult.value;
	log(`📝 Current Firebase auth user ID: ${currentUserId}`);
	log(`📝 Saved user ID in settings: xLMCqTj9h6Z81x1KsrXd5EJkctl1\n`);

	// List of known user IDs from our logs
	const knownUserIds = [
		'xLMCqTj9h6Z81x1KsrXd5EJkctl1', // Saved in settings
		'TXBPpd4yvHT33RZivWb7IGUhEmq1',
		'rmZaNInKZZfKtjsd70wGs5xjUv83',
		'YmgTy3OrlNNL7JtIsGUfDq336fA3',
		'pYe6Avx4qBOvJOifwY8Wn0wBSF92',
		'rn4cqmkMRnMsewsK4OjBcrfI43h2',
		'uio2lbNWC1ZIBpT1coeZyPZzVO12',
		'qu60LDs8UpTFWZvcw7Cm5qx4VRv2',
		currentUserId, // Add current user
	];

	// Remove duplicates
	const uniqueUserIds = [...new Set(knownUserIds)];

	log(`Checking ${uniqueUserIds.length} unique user IDs for data...\n`);

	for (const userId of uniqueUserIds) {
		log(`\n📁 Checking user: ${userId}`);
		log(`   ${userId === currentUserId ? '(Current Firebase user)' : ''}`);
		log(`   ${userId === 'xLMCqTj9h6Z81x1KsrXd5EJkctl1' ? '(Saved in settings)' : ''}`);

		// Check devices
		const devicesPath = `users/${userId}/devices`;
		const devicesResult = await client.queryCollection(devicesPath);

		if (Result.isSuccess(devicesResult)) {
			log(`   ✅ Access granted - Found ${devicesResult.value.length} devices`);

			for (const device of devicesResult.value) {
				log(`      - Device: ${device.id}`);

				// Check usage documents for this device
				const usagePath = `users/${userId}/devices/${device.id}/usage`;
				const usageResult = await client.queryCollection(usagePath);

				if (Result.isSuccess(usageResult)) {
					log(`        Usage docs: ${usageResult.value.length}`);
					// Show first few dates
					const dates = usageResult.value.slice(0, 3).map(doc => doc.id).join(', ');
					if (dates) {
						log(`        Dates: ${dates}${usageResult.value.length > 3 ? '...' : ''}`);
					}
				}
			}
		}
		else {
			log(`   ❌ Access denied or no data`);
		}
	}

	await client.disconnect();
	log('\n\n✅ Check completed');
}

checkFirebaseUsers().catch((error) => {
	console.error('Script error:', error);
	process.exit(1);
});
