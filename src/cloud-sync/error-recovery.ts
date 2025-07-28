import { Result } from '@praha/byethrow';
import pc from 'picocolors';
import { logger } from '../logger.ts';

/**
 * Error types that can be recovered from
 */
export enum RecoverableError {
	NetworkTimeout = 'NETWORK_TIMEOUT',
	NetworkUnavailable = 'NETWORK_UNAVAILABLE',
	AuthExpired = 'AUTH_EXPIRED',
	RateLimited = 'RATE_LIMITED',
	ServerError = 'SERVER_ERROR',
	QuotaExceeded = 'QUOTA_EXCEEDED',
}

/**
 * Recovery strategies for different error types
 */
export enum RecoveryStrategy {
	Retry = 'RETRY',
	RetryWithBackoff = 'RETRY_WITH_BACKOFF',
	QueueForLater = 'QUEUE_FOR_LATER',
	RefreshAuth = 'REFRESH_AUTH',
	WaitAndRetry = 'WAIT_AND_RETRY',
	Fail = 'FAIL',
}

/**
 * Error recovery configuration
 */
export type ErrorRecoveryConfig = {
	maxRetries: number;
	initialBackoffMs: number;
	maxBackoffMs: number;
	backoffMultiplier: number;
};

/**
 * Recovery result
 */
export type RecoveryResult = {
	recovered: boolean;
	strategy: RecoveryStrategy;
	retriesUsed: number;
	message?: string;
};

/**
 * Default recovery configuration
 */
const DEFAULT_CONFIG: ErrorRecoveryConfig = {
	maxRetries: 3,
	initialBackoffMs: 1000,
	maxBackoffMs: 30000,
	backoffMultiplier: 2,
};

/**
 * Error recovery system with automatic retry logic
 */
export class ErrorRecovery {
	constructor(private config: ErrorRecoveryConfig = DEFAULT_CONFIG) {}

	/**
	 * Analyze error and determine recovery strategy
	 */
	analyzeError(error: Error): { type: RecoverableError | null; strategy: RecoveryStrategy } {
		const errorMessage = error.message.toLowerCase();

		// Network timeout
		if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
			return { type: RecoverableError.NetworkTimeout, strategy: RecoveryStrategy.RetryWithBackoff };
		}

		// Network unavailable
		if (
			errorMessage.includes('network')
			|| errorMessage.includes('enotfound')
			|| errorMessage.includes('econnrefused')
		) {
			return { type: RecoverableError.NetworkUnavailable, strategy: RecoveryStrategy.QueueForLater };
		}

		// Auth expired
		if (errorMessage.includes('auth') || errorMessage.includes('unauthorized')) {
			return { type: RecoverableError.AuthExpired, strategy: RecoveryStrategy.RefreshAuth };
		}

		// Rate limited
		if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
			return { type: RecoverableError.RateLimited, strategy: RecoveryStrategy.WaitAndRetry };
		}

		// Server error
		if (errorMessage.includes('500') || errorMessage.includes('503') || errorMessage.includes('server error')) {
			return { type: RecoverableError.ServerError, strategy: RecoveryStrategy.RetryWithBackoff };
		}

		// Quota exceeded
		if (errorMessage.includes('quota') || errorMessage.includes('limit exceeded')) {
			return { type: RecoverableError.QuotaExceeded, strategy: RecoveryStrategy.Fail };
		}

		// Unknown error
		return { type: null, strategy: RecoveryStrategy.Fail };
	}

	/**
	 * Attempt to recover from an error
	 */
	async recover<T>(
		operation: () => Promise<Result<T, Error>>,
		error: Error,
		context?: string,
	): Promise<Result<T, Error>> {
		const { type, strategy } = this.analyzeError(error);

		if (type === null) {
			return Result.fail(error);
		}

		logger.debug(`Error recovery: ${type} - Strategy: ${strategy}`, context);

		switch (strategy) {
			case RecoveryStrategy.Retry:
				return this.retryOperation(operation, 1, 0);

			case RecoveryStrategy.RetryWithBackoff:
				return this.retryWithBackoff(operation);

			case RecoveryStrategy.QueueForLater:
				return Result.fail(new Error(`Operation queued for later: ${error.message}`));

			case RecoveryStrategy.RefreshAuth:
				// TODO: Implement auth refresh
				return Result.fail(new Error('Authentication refresh required'));

			case RecoveryStrategy.WaitAndRetry:
				// Wait 60 seconds for rate limiting
				await this.delay(60000);
				return this.retryOperation(operation, 1, 0);

			case RecoveryStrategy.Fail:
			default:
				return Result.fail(error);
		}
	}

	/**
	 * Retry operation with exponential backoff
	 */
	private async retryWithBackoff<T>(
		operation: () => Promise<Result<T, Error>>,
	): Promise<Result<T, Error>> {
		let lastError: Error | null = null;
		let backoffMs = this.config.initialBackoffMs;

		for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
			const result = await operation();

			if (Result.isSuccess(result)) {
				if (attempt > 1) {
					logger.info(`Operation succeeded after ${attempt} attempts`);
				}
				return result;
			}

			lastError = result.error;

			// Don't retry on the last attempt
			if (attempt < this.config.maxRetries) {
				logger.debug(`Retry attempt ${attempt}/${this.config.maxRetries} failed, backing off ${backoffMs}ms`);
				await this.delay(backoffMs);

				// Increase backoff for next attempt
				backoffMs = Math.min(backoffMs * this.config.backoffMultiplier, this.config.maxBackoffMs);
			}
		}

		return Result.fail(lastError || new Error('Operation failed after retries'));
	}

	/**
	 * Simple retry operation
	 */
	private async retryOperation<T>(
		operation: () => Promise<Result<T, Error>>,
		maxAttempts: number,
		delayMs: number,
	): Promise<Result<T, Error>> {
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			if (attempt > 1 && delayMs > 0) {
				await this.delay(delayMs);
			}

			const result = await operation();
			if (Result.isSuccess(result)) {
				return result;
			}

			lastError = result.error;
		}

		return Result.fail(lastError || new Error('Operation failed'));
	}

	/**
	 * Get user-friendly error message with recovery suggestions
	 */
	getUserMessage(error: Error): string {
		const { type, strategy } = this.analyzeError(error);

		switch (type) {
			case RecoverableError.NetworkTimeout:
				return `${pc.yellow('Network timeout')} - Check your internet connection and try again`;

			case RecoverableError.NetworkUnavailable:
				return `${pc.red('Network unavailable')} - Your changes will sync when you're back online`;

			case RecoverableError.AuthExpired:
				return `${pc.yellow('Authentication expired')} - Run 'ccusage sync link' to reconnect`;

			case RecoverableError.RateLimited:
				return `${pc.yellow('Rate limited')} - Too many requests, please wait a moment`;

			case RecoverableError.ServerError:
				return `${pc.red('Server error')} - Firebase is having issues, please try again later`;

			case RecoverableError.QuotaExceeded:
				return `${pc.red('Quota exceeded')} - Check your Firebase usage limits`;

			default:
				return `${pc.red('Error')}: ${error.message}`;
		}
	}

	/**
	 * Delay helper
	 */
	private async delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

/**
 * Global error recovery instance
 */
let errorRecovery: ErrorRecovery | null = null;

/**
 * Get error recovery instance
 */
export function getErrorRecovery(config?: ErrorRecoveryConfig): ErrorRecovery {
	if (!errorRecovery) {
		errorRecovery = new ErrorRecovery(config);
	}
	return errorRecovery;
}

/**
 * Wrap an operation with automatic error recovery
 */
export async function withErrorRecovery<T>(
	operation: () => Promise<Result<T, Error>>,
	context?: string,
): Promise<Result<T, Error>> {
	try {
		const result = await operation();
		if (Result.isSuccess(result)) {
			return result;
		}

		// Attempt recovery
		const recovery = getErrorRecovery();
		return recovery.recover(operation, result.error, context);
	}
	catch (error) {
		// Handle unexpected errors
		return Result.fail(error instanceof Error ? error : new Error(String(error)));
	}
}

// In-source tests
if (import.meta.vitest != null) {
	const { describe, it, expect, vi } = import.meta.vitest;

	describe('ErrorRecovery', () => {
		it('should identify network timeout errors', () => {
			const recovery = new ErrorRecovery();
			const { type, strategy } = recovery.analyzeError(new Error('Request timeout'));

			expect(type).toBe(RecoverableError.NetworkTimeout);
			expect(strategy).toBe(RecoveryStrategy.RetryWithBackoff);
		});

		it('should identify auth errors', () => {
			const recovery = new ErrorRecovery();
			const { type, strategy } = recovery.analyzeError(new Error('Unauthorized access'));

			expect(type).toBe(RecoverableError.AuthExpired);
			expect(strategy).toBe(RecoveryStrategy.RefreshAuth);
		});

		it('should identify rate limit errors', () => {
			const recovery = new ErrorRecovery();
			const { type, strategy } = recovery.analyzeError(new Error('Rate limit exceeded'));

			expect(type).toBe(RecoverableError.RateLimited);
			expect(strategy).toBe(RecoveryStrategy.WaitAndRetry);
		});

		it('should retry with backoff', async () => {
			const recovery = new ErrorRecovery({
				maxRetries: 3,
				initialBackoffMs: 10,
				maxBackoffMs: 100,
				backoffMultiplier: 2,
			});

			let attempts = 0;
			const operation = vi.fn().mockImplementation(async () => {
				attempts++;
				if (attempts < 3) {
					return Result.fail(new Error('Temporary failure'));
				}
				return Result.succeed('success');
			});

			const result = await recovery.recover(operation, new Error('Request timeout'));

			expect(Result.isSuccess(result)).toBe(true);
			expect(result.value).toBe('success');
			expect(attempts).toBe(3);
		});

		it('should provide user-friendly messages', () => {
			const recovery = new ErrorRecovery();

			const networkMsg = recovery.getUserMessage(new Error('ENOTFOUND'));
			expect(networkMsg).toContain('Network unavailable');

			const authMsg = recovery.getUserMessage(new Error('Unauthorized'));
			expect(authMsg).toContain('Authentication expired');
		});

		it('should handle unknown errors', () => {
			const recovery = new ErrorRecovery();
			const { type, strategy } = recovery.analyzeError(new Error('Unknown error'));

			expect(type).toBe(null);
			expect(strategy).toBe(RecoveryStrategy.Fail);
		});
	});
}
