/**
 * Cleanup function to ensure Firebase connections are closed
 */
import { getFirebaseClient } from '../cloud-sync/firebase-client.ts';

export async function cleanupFirebase(): Promise<void> {
	try {
		const client = getFirebaseClient();
		await client.disconnect();
	}
	catch {
		// Ignore errors during cleanup
	}
}
