#!/usr/bin/env bun
/**
 * Debug Firebase device query issue
 */

import { Result } from '@praha/byethrow';
import { getFirebaseClient } from '../src/cloud-sync/firebase-client.ts';
import { log } from '../src/logger.ts';

async function debugDevices() {
	log('🔍 Debugging Firebase Device Queries\n');

	// Initialize Firebase client
	const client = getFirebaseClient();
	const initResult = await client.initialize();

	if (Result.isFailure(initResult)) {
		log('❌ Failed to initialize Firebase');
		return;
	}

	// 1. Check authentication status
	const userIdResult = client.getUserId();
	if (Result.isSuccess(userIdResult)) {
		log(`✅ Authenticated as: ${userIdResult.value}`);
	}
	else {
		log('❌ Not authenticated');
	}

	// 2. Test direct document access
	log('\n📄 Testing direct document access...');
	const devicePath = 'devices/Work MacBook';
	log(`Getting document at: ${devicePath}`);

	const docResult = await client.getDoc(devicePath);
	if (Result.isSuccess(docResult)) {
		if (docResult.value) {
			log('✅ Document exists!');
			log('Document data:', JSON.stringify(docResult.value, null, 2));
		}
		else {
			log('❌ Document does not exist');
		}
	}
	else {
		log('❌ Error getting document:', (docResult as { error: Error }).error?.message);
	}

	// 3. Test collection query
	log('\n📁 Testing collection query...');
	const collectionPath = 'devices';
	log(`Querying collection: ${collectionPath}`);

	const queryResult = await client.queryCollection(collectionPath);
	if (Result.isSuccess(queryResult)) {
		log(`✅ Query succeeded, found ${queryResult.value.length} documents`);
		for (const doc of queryResult.value) {
			log(`  - Document ID: ${doc.id || 'unknown'}`);
			log(`    Data:`, JSON.stringify(doc, null, 2));
		}
	}
	else {
		log('❌ Query failed:', (queryResult as { error: Error }).error?.message);
	}

	// 4. Try getting the raw Firestore instance to test queries directly
	log('\n🔧 Testing raw Firestore queries...');
	try {
		// Import Firestore modules
		const { collection, getDocs, doc, getDoc } = await import('firebase/firestore');
		const db = client.getFirestore();

		if (!db) {
			log('❌ No Firestore instance available');
		}
		else {
			// Test direct doc get
			log('Testing direct doc get...');
			const docRef = doc(db, 'devices', 'Work MacBook');
			const docSnap = await getDoc(docRef);

			if (docSnap.exists()) {
				log('✅ Direct doc get succeeded!');
				log('Document data:', docSnap.data());
			}
			else {
				log('❌ Document not found with direct get');
			}

			// Test collection query
			log('\nTesting direct collection query...');
			const devicesRef = collection(db, 'devices');
			const querySnap = await getDocs(devicesRef);

			log(`✅ Found ${querySnap.size} documents in direct query`);
			querySnap.forEach((doc) => {
				log(`  - ${doc.id}:`, doc.data());
			});
		}
	}
	catch (error) {
		log('❌ Error in raw Firestore tests:', error);
	}

	// 5. Check usage subcollection
	log('\n📊 Checking usage subcollection...');
	const usagePath = 'devices/Work MacBook/usage';
	const usageResult = await client.queryCollection(usagePath);

	if (Result.isSuccess(usageResult)) {
		log(`✅ Found ${usageResult.value.length} usage documents`);
		for (const doc of usageResult.value.slice(0, 3)) {
			log(`  - ${doc.id}: $${doc.totalCost?.toFixed(2) || '0.00'}`);
		}
	}
	else {
		log('❌ Failed to query usage documents');
	}

	// 6. Test if disconnect is the issue
	log('\n🔌 Testing disconnect...');
	log('Calling disconnect()...');
	await client.disconnect();
	log('✅ Disconnect completed');

	log('\n🎯 Debugging completed');
	log('\n💡 Summary:');
	log('- If direct doc access works but collection query fails, it might be a query issue');
	log('- If the program hangs after this, it\'s a connection cleanup issue');
	log('- Check if the document ID contains special characters or encoding issues');

	// Force exit to ensure the script doesn't hang
	log('\nForcing process exit in 2 seconds...');
	setTimeout(() => {
		log('Exiting...');
		process.exit(0);
	}, 2000);
}

debugDevices().catch((error) => {
	console.error('Debug error:', error);
	process.exit(1);
});
