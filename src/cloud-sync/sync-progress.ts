import pc from 'picocolors';
import { log } from '../logger.ts';

/**
 * Progress tracking interface
 */
export type ProgressOptions = {
	total: number;
	label?: string;
	showRate?: boolean;
	showETA?: boolean;
	width?: number;
};

/**
 * Progress update data
 */
export type ProgressUpdate = {
	current: number;
	increment?: number;
	message?: string;
};

/**
 * Progress tracker for long-running operations
 */
export class ProgressTracker {
	private current = 0;
	private startTime: number;
	private lastUpdate = 0;
	private updateInterval = 100; // ms between updates

	constructor(private options: ProgressOptions) {
		this.startTime = Date.now();
	}

	/**
	 * Update progress
	 */
	update(update: ProgressUpdate): void {
		if (update.increment) {
			this.current += update.increment;
		}
		else {
			this.current = update.current;
		}

		// Throttle updates
		const now = Date.now();
		if (now - this.lastUpdate < this.updateInterval && this.current < this.options.total) {
			return;
		}
		this.lastUpdate = now;

		this.render(update.message);
	}

	/**
	 * Complete the progress
	 */
	complete(message?: string): void {
		this.current = this.options.total;
		this.render(message, true);
		log(''); // New line after progress
	}

	/**
	 * Render progress bar
	 */
	private render(message?: string, complete = false): void {
		const { total, label = 'Progress', showRate = true, showETA = true, width = 30 } = this.options;

		// Calculate percentage
		const percentage = Math.min(100, Math.round((this.current / total) * 100));

		// Build progress bar
		const filled = Math.round((percentage / 100) * width);
		const empty = width - filled;
		const bar = `[${pc.green('█'.repeat(filled))}${pc.gray('░'.repeat(empty))}]`;

		// Calculate rate and ETA
		const elapsed = Date.now() - this.startTime;
		const rate = this.current / (elapsed / 1000);
		const remaining = total - this.current;
		const eta = remaining / rate;

		// Build status line
		let status = `${label}: ${bar} ${percentage}% | ${this.current}/${total}`;

		if (showRate && rate > 0) {
			status += ` | ${rate.toFixed(1)}/s`;
		}

		if (showETA && !complete && eta > 0 && isFinite(eta)) {
			const etaText = this.formatTime(eta);
			status += ` | ETA: ${etaText}`;
		}

		if (message) {
			status += ` | ${message}`;
		}

		// Clear line and write status
		process.stdout.write(`\r${' '.repeat(process.stdout.columns || 80)}\r`);
		process.stdout.write(status);

		if (complete) {
			process.stdout.write('\n');
		}
	}

	/**
	 * Format time in seconds to human-readable format
	 */
	private formatTime(seconds: number): string {
		if (seconds < 60) {
			return `${Math.round(seconds)}s`;
		}
		else if (seconds < 3600) {
			const minutes = Math.floor(seconds / 60);
			const secs = Math.round(seconds % 60);
			return `${minutes}m ${secs}s`;
		}
		else {
			const hours = Math.floor(seconds / 3600);
			const minutes = Math.floor((seconds % 3600) / 60);
			return `${hours}h ${minutes}m`;
		}
	}
}

/**
 * Create a simple spinner for indeterminate progress
 */
export class Spinner {
	private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
	private current = 0;
	private interval: NodeJS.Timeout | null = null;

	/**
	 * Start the spinner
	 */
	start(message: string): void {
		this.stop(); // Ensure any existing spinner is stopped

		this.interval = setInterval(() => {
			process.stdout.write(`\r${pc.cyan(this.frames[this.current])} ${message}`);
			this.current = (this.current + 1) % this.frames.length;
		}, 80);
	}

	/**
	 * Stop the spinner
	 */
	stop(finalMessage?: string): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}

		// Clear the line
		process.stdout.write(`\r${' '.repeat(process.stdout.columns || 80)}\r`);

		if (finalMessage) {
			log(finalMessage);
		}
	}
}

/**
 * Create progress tracker for sync operations
 */
export function createSyncProgress(totalRecords: number): ProgressTracker {
	return new ProgressTracker({
		total: totalRecords,
		label: '📤 Syncing',
		showRate: true,
		showETA: true,
		width: 20,
	});
}

/**
 * Create progress tracker for download operations
 */
export function createDownloadProgress(totalRecords: number): ProgressTracker {
	return new ProgressTracker({
		total: totalRecords,
		label: '📥 Downloading',
		showRate: true,
		showETA: true,
		width: 20,
	});
}

// In-source tests
if (import.meta.vitest != null) {
	const { describe, it, expect, vi, beforeEach, afterEach } = import.meta.vitest;

	describe('ProgressTracker', () => {
		let mockWrite: any;
		let originalWrite: any;

		beforeEach(() => {
			originalWrite = process.stdout.write;
			mockWrite = vi.fn();
			process.stdout.write = mockWrite;
		});

		afterEach(() => {
			process.stdout.write = originalWrite;
		});

		it('should create progress tracker with options', () => {
			const tracker = new ProgressTracker({
				total: 100,
				label: 'Test',
			});

			expect(tracker).toBeDefined();
		});

		it('should update progress', () => {
			const tracker = new ProgressTracker({
				total: 100,
				label: 'Test',
			});

			tracker.update({ current: 50 });

			// Check that progress was rendered
			expect(mockWrite).toHaveBeenCalled();
			const output = mockWrite.mock.calls.map((call: any[]) => call[0]).join('');
			expect(output).toContain('50%');
			expect(output).toContain('50/100');
		});

		it('should increment progress', async () => {
			const tracker = new ProgressTracker({
				total: 100,
				label: 'Test',
			});

			tracker.update({ increment: 25 });
			// Wait for throttle interval to pass
			await new Promise(resolve => setTimeout(resolve, 110));
			tracker.update({ increment: 25 });

			const output = mockWrite.mock.calls.map((call: any[]) => call[0]).join('');
			expect(output).toContain('50%');
		});

		it('should complete progress', () => {
			const tracker = new ProgressTracker({
				total: 100,
				label: 'Test',
			});

			tracker.complete('Done!');

			const output = mockWrite.mock.calls.map((call: any[]) => call[0]).join('');
			expect(output).toContain('100%');
			expect(output).toContain('Done!');
			expect(output).toContain('\n');
		});

		it('should format time correctly', () => {
			const tracker = new ProgressTracker({
				total: 100,
			});

			// Access private method for testing
			const formatTime = (tracker as any).formatTime.bind(tracker);

			expect(formatTime(30)).toBe('30s');
			expect(formatTime(90)).toBe('1m 30s');
			expect(formatTime(3660)).toBe('1h 1m');
		});

		it('should throttle updates', async () => {
			const tracker = new ProgressTracker({
				total: 100,
			});

			// Rapid updates
			for (let i = 0; i < 10; i++) {
				tracker.update({ current: i });
			}

			// Should have fewer calls than updates due to throttling
			expect(mockWrite.mock.calls.length).toBeLessThan(10);
		});
	});

	describe('Spinner', () => {
		let mockWrite: any;
		let originalWrite: any;

		beforeEach(() => {
			originalWrite = process.stdout.write;
			mockWrite = vi.fn();
			process.stdout.write = mockWrite;
		});

		afterEach(() => {
			process.stdout.write = originalWrite;
			vi.restoreAllMocks();
		});

		it('should start and stop spinner', async () => {
			const spinner = new Spinner();

			spinner.start('Loading...');

			// Wait for a few frames
			await new Promise(resolve => setTimeout(resolve, 200));

			spinner.stop();

			// Check that spinner was rendered
			expect(mockWrite).toHaveBeenCalled();
			const output = mockWrite.mock.calls.map((call: any[]) => call[0]).join('');
			expect(output).toContain('Loading...');
		});

		it('should display final message when stopping', async () => {
			// We need to spy on the logger module
			const loggerModule = await import('../logger.ts');
			const logSpy = vi.spyOn(loggerModule, 'log');

			const spinner = new Spinner();

			spinner.start('Loading...');
			spinner.stop('Complete!');

			// The log function should be called with final message
			expect(logSpy).toHaveBeenCalledWith('Complete!');
		});
	});

	describe('Helper functions', () => {
		it('should create sync progress tracker', () => {
			const progress = createSyncProgress(1000);
			expect(progress).toBeDefined();
		});

		it('should create download progress tracker', () => {
			const progress = createDownloadProgress(500);
			expect(progress).toBeDefined();
		});
	});
}
