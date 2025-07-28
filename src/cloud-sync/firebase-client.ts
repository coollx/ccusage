import type { FirebaseApp } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';
import type { Database } from 'firebase/database';
import type { CollectionReference, DocumentData, DocumentReference, Firestore } from 'firebase/firestore';
import type { SyncStatus } from './_types.ts';
import type { SyncEngineV2 } from './sync-engine-v2.ts';
import { Result } from '@praha/byethrow';
import { log } from '../logger.ts';
import { loadFirebaseConfig } from './config-manager.ts';
import { RealtimeManager } from './realtime-manager.ts';
import { UnifiedSyncEngine } from './unified-sync-engine.ts';

/**
 * Firebase client wrapper for cloud sync operations
 * Provides typed wrappers around Firebase SDK operations
 */
export class FirebaseClient {
	private app: FirebaseApp | null = null;
	private auth: Auth | null = null;
	private firestore: Firestore | null = null;
	private database: Database | null = null;
	private currentUser: User | null = null;
	private initialized = false;
	private realtimeManager: RealtimeManager | null = null;
	private unifiedSyncEngine: UnifiedSyncEngine | null = null;
	private syncEngine: SyncEngineV2 | null = null;

	/**
	 * Initializes Firebase with the user's configuration
	 */
	async initialize(): Promise<Result<void, Error>> {
		if (this.initialized) {
			return Result.succeed(undefined);
		}

		// Load config
		const configResult = await loadFirebaseConfig();
		if (Result.isFailure(configResult)) {
			return configResult;
		}

		const config = configResult.value;

		// Dynamic imports to avoid loading Firebase SDK until needed
		try {
			const { initializeApp } = await import('firebase/app');
			const { getAuth, signInAnonymously, setPersistence, browserLocalPersistence } = await import('firebase/auth');
			const { getFirestore } = await import('firebase/firestore');
			const { getDatabase } = await import('firebase/database');

			// Initialize Firebase app
			this.app = initializeApp({
				apiKey: config.apiKey,
				authDomain: config.authDomain,
				projectId: config.projectId,
				databaseURL: config.databaseURL,
			});

			// Initialize services
			this.auth = getAuth(this.app);
			this.firestore = getFirestore(this.app);
			this.database = getDatabase(this.app);

			// Wait for auth state to be restored
			const { onAuthStateChanged } = await import('firebase/auth');
			const user = await new Promise<User | null>((resolve) => {
				const unsubscribe = onAuthStateChanged(this.auth!, (user) => {
					unsubscribe();
					resolve(user);
				});
			});

			if (user) {
				this.currentUser = user;
			}
			else {
				// Sign in anonymously only if no existing session
				const userCredential = await signInAnonymously(this.auth);
				this.currentUser = userCredential.user;
			}

			if (!this.currentUser) {
				throw new Error('Anonymous sign-in succeeded but no user returned');
			}

			// Initialize realtime manager
			this.realtimeManager = new RealtimeManager();
			this.realtimeManager.initialize(this.database);

			// Initialize unified sync engine
			this.unifiedSyncEngine = new UnifiedSyncEngine();
			const syncEngineInitResult = this.unifiedSyncEngine.initialize(this);
			if (Result.isFailure(syncEngineInitResult)) {
				throw syncEngineInitResult.error;
			}

			this.initialized = true;
		}
		catch (error: any) {
			return Result.fail(new Error(`Failed to initialize Firebase: ${error.message}`));
		}

		return Result.succeed(undefined);
	}

	/**
	 * Gets the current user ID
	 */
	getUserId(): Result<string, Error> {
		if (this.currentUser === null) {
			return Result.fail(new Error('Not authenticated'));
		}
		return Result.succeed(this.currentUser.uid);
	}

	/**
	 * Gets sync status information
	 */
	async getSyncStatus(): Promise<SyncStatus> {
		if (!this.initialized) {
			return {
				enabled: false,
				connected: false,
				error: 'Firebase not initialized',
			};
		}

		const userIdResult: Result<string, Error> = this.getUserId();
		if (Result.isFailure(userIdResult)) {
			return {
				enabled: true,
				connected: false,
				error: (userIdResult as { error: Error }).error.message,
			};
		}

		return {
			enabled: true,
			connected: true,
		};
	}

	/**
	 * Gets a Firestore collection reference
	 */
	async collection(path: string): Promise<Result<CollectionReference<DocumentData>, Error>> {
		if (this.firestore === null) {
			return Result.fail(new Error('Firestore not initialized'));
		}

		try {
			const { collection } = (await import('firebase/firestore'));
			return Result.succeed(collection(this.firestore, path));
		}
		catch (error: any) {
			log(`[FirebaseClient] Get collection failed for ${path}:`, error?.message || 'Unknown error');
			return Result.fail(error as Error);
		}
	}

	/**
	 * Gets a Firestore document reference
	 */
	async doc(path: string): Promise<Result<DocumentReference<DocumentData>, Error>> {
		if (this.firestore === null) {
			return Result.fail(new Error('Firestore not initialized'));
		}

		try {
			const { doc } = (await import('firebase/firestore'));
			return Result.succeed(doc(this.firestore, path));
		}
		catch (error: any) {
			log(`[FirebaseClient] Get doc reference failed for ${path}:`, error?.message || 'Unknown error');
			return Result.fail(error as Error);
		}
	}

	/**
	 * Sets data in a Firestore document
	 */
	async setDoc<T extends DocumentData>(path: string, data: T): Promise<Result<void, Error>> {
		const docResult: Result<DocumentReference<DocumentData>, Error> = await this.doc(path);
		if (Result.isFailure(docResult)) {
			return docResult;
		}

		try {
			const { setDoc } = await import('firebase/firestore');
			const docRef = (docResult as { value: DocumentReference<DocumentData> }).value;
			await setDoc(docRef, data);
			log(`[FirebaseClient] Document set successfully at ${path}`);
			return Result.succeed(undefined);
		}
		catch (error: any) {
			log(`[FirebaseClient] Set doc failed for ${path}:`, error?.message || 'Unknown error');
			return Result.fail(error as Error);
		}
	}

	/**
	 * Gets data from a Firestore document
	 */
	async getDoc<T extends DocumentData>(path: string): Promise<Result<T | null, Error>> {
		const docResult: Result<DocumentReference<DocumentData>, Error> = await this.doc(path);
		if (Result.isFailure(docResult)) {
			return docResult;
		}

		// Don't use Result.try - it seems to be broken
		try {
			const { getDoc } = await import('firebase/firestore');
			const docRef = (docResult as { value: DocumentReference<DocumentData> }).value;
			const snapshot = await getDoc(docRef);
			return Result.succeed(snapshot.exists() ? (snapshot.data() as T) : null);
		}
		catch (error: any) {
			log(`[FirebaseClient] Get doc failed for ${path}:`, error?.message || 'Unknown error');
			return Result.fail(error as Error);
		}
	}

	/**
	 * Queries a Firestore collection
	 */
	async queryCollection<T extends DocumentData>(
		collectionPath: string,
		queryFn?: (collection: CollectionReference) => any,
	): Promise<Result<T[], Error>> {
		const collectionResult: Result<CollectionReference<DocumentData>, Error> = await this.collection(collectionPath);
		if (Result.isFailure(collectionResult)) {
			return collectionResult;
		}

		// Don't use Result.try - it seems to be broken
		try {
			const { getDocs } = await import('firebase/firestore');

			const collectionRef = (collectionResult as { value: CollectionReference<DocumentData> }).value;
			const query = queryFn !== undefined ? queryFn(collectionRef) : collectionRef;

			const snapshot = await getDocs(query);

			return Result.succeed(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as T)));
		}
		catch (error: any) {
			log(`[FirebaseClient] Query collection failed:`, error?.message || 'Unknown error');
			return Result.fail(error as Error);
		}
	}

	/**
	 * Creates a batch write operation
	 */
	async batchWrite(operations: Array<{ path: string; data: DocumentData }>): Promise<Result<void, Error>> {
		if (this.firestore === null) {
			return Result.fail(new Error('Firestore not initialized'));
		}

		log(`[FirebaseClient] Starting batch write with ${operations.length} operations`);

		// Log first operation for debugging
		if (operations.length > 0) {
			log(`[FirebaseClient] First operation path: ${operations[0].path}`);
			log(`[FirebaseClient] First operation data:`, JSON.stringify(operations[0].data, null, 2));
		}

		// Don't use Result.try - it seems to be broken
		try {
			log(`[FirebaseClient] Importing Firebase modules...`);
			const { writeBatch, doc, getDoc } = await import('firebase/firestore');
			log(`[FirebaseClient] Creating batch...`);
			const batch = writeBatch(this.firestore);

			for (const op of operations) {
				log(`[FirebaseClient] Adding to batch: ${op.path}`);
				const docRef = doc(this.firestore, op.path);
				batch.set(docRef, op.data);
			}

			log(`[FirebaseClient] Committing batch...`);
			await batch.commit();
			log(`[FirebaseClient] Batch commit completed`);

			// Verify write by reading back first document
			if (operations.length > 0) {
				const firstPath = operations[0].path;
				log(`[FirebaseClient] Verifying write at: ${firstPath}`);
				try {
					const verifyRef = doc(this.firestore, firstPath);
					const verifySnap = await getDoc(verifyRef);
					if (verifySnap.exists()) {
						log(`[FirebaseClient] ✓ Write verified - document exists at ${firstPath}`);
					}
					else {
						log(`[FirebaseClient] ✗ Write failed - document NOT found at ${firstPath}`);
						log(`[FirebaseClient] This may be due to permission issues`);
					}
				}
				catch (verifyError: any) {
					log(`[FirebaseClient] ✗ Verification error:`, verifyError?.message || 'Unknown error');
					log(`[FirebaseClient] Error code:`, verifyError?.code);
				}
			}

			return Result.succeed(undefined);
		}
		catch (error: any) {
			log(`[FirebaseClient] ❌ Batch write failed:`, error?.message || 'Unknown error');
			log(`[FirebaseClient] Error code:`, error?.code);
			log(`[FirebaseClient] Error stack:`, error?.stack);
			return Result.fail(error as Error);
		}
	}

	/**
	 * Checks if a document exists
	 */
	async docExists(path: string): Promise<Result<boolean, Error>> {
		const docResult: Result<DocumentReference<DocumentData>, Error> = await this.doc(path);
		if (Result.isFailure(docResult)) {
			return docResult;
		}

		try {
			const { getDoc } = await import('firebase/firestore');
			const docRef = (docResult as { value: DocumentReference<DocumentData> }).value;
			const snapshot = await getDoc(docRef);
			return Result.succeed(snapshot.exists());
		}
		catch (error: any) {
			log(`[FirebaseClient] Doc exists check failed for ${path}:`, error?.message || 'Unknown error');
			return Result.fail(error as Error);
		}
	}

	/**
	 * Gets the sync engine instance
	 */
	getSyncEngine(): SyncEngineV2 | null {
		return this.syncEngine;
	}

	/**
	 * Sets the sync engine instance
	 */
	setSyncEngine(syncEngine: SyncEngineV2): void {
		this.syncEngine = syncEngine;
	}

	/**
	 * Gets the unified sync engine
	 */
	getUnifiedSyncEngine(): UnifiedSyncEngine | null {
		return this.unifiedSyncEngine;
	}

	/**
	 * Gets the realtime manager
	 */
	getRealtimeManager(): RealtimeManager | null {
		return this.realtimeManager;
	}

	/**
	 * Subscribes to realtime updates at a specific path
	 */
	async subscribeToRealtimeUpdates(
		path: string,
		callback: (data: any) => void,
	): Promise<Result<() => void, Error>> {
		if (!this.realtimeManager) {
			return Result.fail(new Error('Realtime manager not initialized'));
		}

		return this.realtimeManager.subscribe(path, callback);
	}

	/**
	 * Updates realtime data at a specific path
	 */
	async updateRealtimeData(path: string, data: any): Promise<Result<void, Error>> {
		if (!this.realtimeManager) {
			return Result.fail(new Error('Realtime manager not initialized'));
		}

		return this.realtimeManager.update(path, data);
	}

	/**
	 * Disconnects from Firebase
	 */
	async disconnect(): Promise<void> {
		// Stop unified sync engine
		if (this.unifiedSyncEngine) {
			await this.unifiedSyncEngine.stop();
		}

		// Disconnect realtime manager
		if (this.realtimeManager) {
			await this.realtimeManager.disconnect();
		}

		// Sign out
		if (this.auth !== null && this.currentUser !== null) {
			await this.auth.signOut();
		}

		// Go offline for database
		if (this.database) {
			const { goOffline } = await import('firebase/database');
			goOffline(this.database);
		}

		this.app = null;
		this.auth = null;
		this.firestore = null;
		this.database = null;
		this.currentUser = null;
		this.realtimeManager = null;
		this.unifiedSyncEngine = null;
		this.syncEngine = null;
		this.initialized = false;
	}
}

/**
 * Singleton instance of Firebase client
 */
let firebaseClient: FirebaseClient | null = null;

/**
 * Gets or creates the Firebase client instance
 */
export function getFirebaseClient(): FirebaseClient {
	if (firebaseClient === null) {
		firebaseClient = new FirebaseClient();
	}
	return firebaseClient;
}

/**
 * Resets the Firebase client (mainly for testing)
 */
export function resetFirebaseClient(): void {
	if (firebaseClient !== null) {
		void firebaseClient.disconnect();
		firebaseClient = null;
	}
}

if (import.meta.vitest != null) {
	const { describe, it, expect, beforeEach, afterEach } = import.meta.vitest;

	describe('firebase-client', () => {
		let client: FirebaseClient;

		beforeEach(() => {
			resetFirebaseClient();
			client = getFirebaseClient();
		});

		afterEach(async () => {
			await client.disconnect();
			resetFirebaseClient();
		});

		describe('initialization', () => {
			it('should handle missing config gracefully', async () => {
				const result: Result<void, Error> = await client.initialize();
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result)) {
					expect((result as { error: Error }).error.message).toContain('Firebase config not found');
				}
			});

			it('should return sync status when not initialized', async () => {
				const status = await client.getSyncStatus();
				expect(status.enabled).toBe(false);
				expect(status.connected).toBe(false);
				expect(status.error).toContain('not initialized');
			});
		});

		describe('singleton behavior', () => {
			it('should return same instance', () => {
				const client1 = getFirebaseClient();
				const client2 = getFirebaseClient();
				expect(client1).toBe(client2);
			});

			it('should create new instance after reset', () => {
				const client1 = getFirebaseClient();
				resetFirebaseClient();
				const client2 = getFirebaseClient();
				expect(client1).not.toBe(client2);
			});
		});
	});
}
