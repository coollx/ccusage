#!/usr/bin/env node

/**
 * Firebase setup script for ccusage cloud sync
 *
 * This script helps users set up their Firebase project with:
 * - Security rules
 * - Firestore indexes
 * - Initial database structure
 *
 * Usage: node scripts/firebase-setup.js
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

// ANSI color codes
const colors = {
	red: '\x1B[31m',
	green: '\x1B[32m',
	yellow: '\x1B[33m',
	blue: '\x1B[34m',
	gray: '\x1B[90m',
	reset: '\x1B[0m',
};

function log(message, color = 'reset') {
	console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Security rules template for Firestore
 */
const FIRESTORE_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow authenticated users full access to everything
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}`;

// Firestore indexes configuration is documented in the setup instructions below

async function loadFirebaseConfig() {
	try {
		const configPath = join(homedir(), '.ccusage', 'firebase.json');
		const data = await readFile(configPath, 'utf-8');
		return JSON.parse(data);
	}
	catch {
		throw new Error('Firebase config not found. Run "ccusage sync init" first.');
	}
}

async function main() {
	log('🔥 Firebase Setup for ccusage\n', 'blue');

	try {
		// Load Firebase configuration
		const config = await loadFirebaseConfig();
		log(`Project ID: ${config.projectId}`, 'gray');
		log('');

		// Display instructions
		log('📋 Setup Instructions:\n', 'yellow');

		log('1. Security Rules (firestore.rules):', 'green');
		log('   Copy the following rules to your Firebase Console:', 'gray');
		log(`   https://console.firebase.google.com/project/${config.projectId}/firestore/rules\n`, 'gray');
		console.log(FIRESTORE_RULES);
		log('');

		log('2. Firestore Indexes:', 'green');
		log('   Create these indexes in your Firebase Console:', 'gray');
		log(`   https://console.firebase.google.com/project/${config.projectId}/firestore/indexes\n`, 'gray');

		log('   Index 1: Collection "usage" (within devices/*)', 'gray');
		log('   - Field: date (Ascending)', 'gray');
		log('   - Field: lastUpdated (Descending)', 'gray');
		log('');

		log('   Index 2: Collection "devices"', 'gray');
		log('   - Field: createdAt (Descending)', 'gray');
		log('');

		log('3. Enable Authentication:', 'green');
		log('   Enable Anonymous Authentication in Firebase Console:', 'gray');
		log(`   https://console.firebase.google.com/project/${config.projectId}/authentication/providers`, 'gray');
		log('');

		log('✅ Setup complete!', 'green');
		log('');
		log('Next steps:', 'gray');
		log('1. Apply the security rules and indexes above in Firebase Console', 'gray');
		log('2. Enable Anonymous Authentication', 'gray');
		log('3. Run "ccusage sync enable" to start syncing', 'gray');
	}
	catch (error) {
		log(`❌ Error: ${error.message}`, 'red');
		process.exit(1);
	}
}

// Run the setup
main().catch((error) => {
	log(`❌ Unexpected error: ${error.message}`, 'red');
	process.exit(1);
});
