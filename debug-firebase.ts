#!/usr/bin/env bun

import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import {
	collection,
	doc,
	getDoc,
	getDocs,
	getFirestore,
	limit,
	query,
	setDoc,
	Timestamp,
} from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { logger } from './src/logger.ts';

async function debugFirebase() {
	logger.info('🔍 Starting Firebase debug...');
	logger.info('Firebase config:', {
		...config,
		apiKey: config.apiKey ? '***' : 'MISSING',
	});

	// Initialize Firebase
	const app = initializeApp(config);
	const auth = getAuth(app);
	const db = getFirestore(app);

	// Wait for auth state
	const user = await new Promise((resolve) => {
		onAuthStateChanged(auth, (user) => {
			resolve(user);
		});
	});

	if (!user) {
		logger.error('❌ Not authenticated!');
		return;
	}

	logger.info('✅ Authenticated as:', user.uid);
	logger.info('Email:', user.email);

	// 1. List all collections under the user
	logger.info('\n📁 Checking user collections...');
	try {
		const userDocRef = doc(db, 'users', user.uid);
		const userDoc = await getDoc(userDocRef);

		if (userDoc.exists()) {
			logger.info('User document exists:', userDoc.data());
		}
		else {
			logger.warn('User document does NOT exist');
		}

		// Check devices collection
		const devicesRef = collection(db, `users/${user.uid}/devices`);
		const devicesSnapshot = await getDocs(devicesRef);
		logger.info(`Found ${devicesSnapshot.size} devices`);

		devicesSnapshot.forEach((doc) => {
			logger.info(`Device: ${doc.id}`, doc.data());
		});

		// Check usage collection
		const usageRef = collection(db, `users/${user.uid}/usage`);
		const usageQuery = query(usageRef, limit(5));
		const usageSnapshot = await getDocs(usageQuery);
		logger.info(`Found ${usageSnapshot.size} usage documents (showing first 5)`);

		usageSnapshot.forEach((doc) => {
			logger.info(`Usage: ${doc.id}`, doc.data());
		});

		// Check sessions collection
		const sessionsRef = collection(db, `users/${user.uid}/sessions`);
		const sessionsQuery = query(sessionsRef, limit(5));
		const sessionsSnapshot = await getDocs(sessionsQuery);
		logger.info(`Found ${sessionsSnapshot.size} session documents (showing first 5)`);

		sessionsSnapshot.forEach((doc) => {
			logger.info(`Session: ${doc.id}`, doc.data());
		});
	}
	catch (error) {
		logger.error('Error listing collections:', error);
	}

	// 2. Try to read specific documents
	logger.info('\n📖 Trying to read specific paths...');
	const paths = [
		`users/${user.uid}`,
		`users/${user.uid}/devices/Work MacBook`,
		`users/${user.uid}/usage/2025-01-27`,
		`users/${user.uid}/sessions/test-session`,
	];

	for (const path of paths) {
		try {
			const docRef = doc(db, path);
			const docSnapshot = await getDoc(docRef);

			if (docSnapshot.exists()) {
				logger.info(`✅ ${path} exists:`, docSnapshot.data());
			}
			else {
				logger.info(`❌ ${path} does NOT exist`);
			}
		}
		catch (error) {
			logger.error(`Error reading ${path}:`, error);
		}
	}

	// 3. Try a test write
	logger.info('\n✍️ Testing write operations...');
	const testId = `debug-${nanoid(6)}`;
	const testData = {
		test: true,
		timestamp: Timestamp.now(),
		message: 'Debug test write',
		createdAt: new Date().toISOString(),
	};

	try {
		// Write to root of user document
		logger.info('Writing test data to user document...');
		await setDoc(doc(db, `users/${user.uid}`), {
			debugTest: testData,
		}, { merge: true });
		logger.info('✅ Successfully wrote to user document');

		// Read it back
		const userDoc = await getDoc(doc(db, `users/${user.uid}`));
		if (userDoc.exists() && userDoc.data()?.debugTest) {
			logger.info('✅ Verified test data in user document');
		}
		else {
			logger.error('❌ Could not verify test data in user document');
		}

		// Write to devices collection
		logger.info('\nWriting test device...');
		await setDoc(doc(db, `users/${user.uid}/devices/${testId}`), {
			name: testId,
			...testData,
		});
		logger.info('✅ Successfully wrote test device');

		// Read it back
		const deviceDoc = await getDoc(doc(db, `users/${user.uid}/devices/${testId}`));
		if (deviceDoc.exists()) {
			logger.info('✅ Verified test device:', deviceDoc.data());
		}
		else {
			logger.error('❌ Could not verify test device');
		}

		// Write to usage collection
		logger.info('\nWriting test usage data...');
		await setDoc(doc(db, `users/${user.uid}/usage/${testId}`), {
			date: testId,
			...testData,
		});
		logger.info('✅ Successfully wrote test usage data');

		// Read it back
		const usageDoc = await getDoc(doc(db, `users/${user.uid}/usage/${testId}`));
		if (usageDoc.exists()) {
			logger.info('✅ Verified test usage data:', usageDoc.data());
		}
		else {
			logger.error('❌ Could not verify test usage data');
		}
	}
	catch (error) {
		logger.error('❌ Write test failed:', error);
		if (error instanceof Error) {
			logger.error('Error details:', {
				message: error.message,
				stack: error.stack,
			});
		}
	}

	// 4. Check the actual sync data structure
	logger.info('\n🔍 Checking expected sync data structure...');
	try {
		// Check if the sync is writing to different paths
		const possiblePaths = [
			`users/${user.uid}/sync/devices`,
			`users/${user.uid}/syncData/devices`,
			`users/${user.uid}/data/devices`,
			`sync/${user.uid}/devices`,
			`devices/${user.uid}`,
		];

		for (const path of possiblePaths) {
			try {
				const ref = collection(db, path);
				const snapshot = await getDocs(query(ref, limit(1)));
				if (!snapshot.empty) {
					logger.warn(`Found data at unexpected path: ${path}`);
					snapshot.forEach((doc) => {
						logger.info(`Document at ${path}:`, doc.id, doc.data());
					});
				}
			}
			catch (e) {
				// Path doesn't exist or no permission
			}
		}
	}
	catch (error) {
		logger.error('Error checking alternative paths:', error);
	}

	// 5. List all top-level collections (if we have permission)
	logger.info('\n📚 Checking top-level collections...');
	try {
		const collections = ['users', 'devices', 'usage', 'sessions', 'sync'];
		for (const collName of collections) {
			try {
				const coll = collection(db, collName);
				const snapshot = await getDocs(query(coll, limit(1)));
				if (!snapshot.empty) {
					logger.info(`Collection '${collName}' exists with documents`);
				}
			}
			catch (e) {
				// No permission or doesn't exist
			}
		}
	}
	catch (error) {
		logger.error('Error checking collections:', error);
	}

	logger.info('\n✅ Debug complete!');
}

// Run the debug
debugFirebase().catch((error) => {
	logger.error('Fatal error:', error);
	process.exit(1);
});
