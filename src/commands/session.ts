import process from 'node:process';
import { define } from 'gunshi';
import pc from 'picocolors';
import { sharedCommandConfig } from '../_shared-args.ts';
import { formatCurrency, formatModelsDisplayMultiline, formatNumber, pushBreakdownRows, ResponsiveTable } from '../_utils.ts';
import {
	calculateTotals,
	createTotalsObject,
	getTotalTokens,
} from '../calculate-cost.ts';
import { determineDataSource, formatDataSource } from '../cloud-sync/cloud-indicator.ts';
import { getCommandExecutor } from '../cloud-sync/command-executor.ts';
import { formatDateCompact, loadSessionData } from '../data-loader.ts';
import { detectMismatches, printMismatchReport } from '../debug.ts';
import { log, logger } from '../logger.ts';

export const sessionCommand = define({
	name: 'session',
	description: 'Show usage report grouped by conversation session',
	...sharedCommandConfig,
	args: {
		...sharedCommandConfig.args,
		cloud: {
			type: 'boolean',
			description: 'Show aggregated data from all devices (cloud sync)',
			default: false,
		},
		local: {
			type: 'boolean',
			description: 'Force local-only mode (no cloud data)',
			default: false,
		},
	},
	async run(ctx) {
		const executor = getCommandExecutor();

		return executor.execute('session', ctx.values, async () => {
			if (ctx.values.json) {
				logger.level = 0;
			}

			// Determine data source based on flags
			const dataSource = determineDataSource({ cloud: ctx.values.cloud, local: ctx.values.local });

			if (dataSource === 'cloud' && !ctx.values.local) {
				// TODO: Load cloud data when cloud sync is available
				// For now, fall back to local data
				logger.warn('Cloud sync not yet fully implemented, showing local data');
			}

			const sessionData = await loadSessionData({
				since: ctx.values.since,
				until: ctx.values.until,
				mode: ctx.values.mode,
				order: ctx.values.order,
				offline: ctx.values.offline,
			});

			if (sessionData.length === 0) {
				if (ctx.values.json) {
					log(JSON.stringify([]));
				}
				else {
					logger.warn('No Claude usage data found.');
				}
				process.exit(0);
			}

			// Calculate totals
			const totals = calculateTotals(sessionData);

			// Show debug information if requested
			if (ctx.values.debug && !ctx.values.json) {
				const mismatchStats = await detectMismatches(undefined);
				printMismatchReport(mismatchStats, ctx.values.debugSamples);
			}

			if (ctx.values.json) {
			// Output JSON format
				const jsonOutput = {
					sessions: sessionData.map(data => ({
						sessionId: data.sessionId,
						inputTokens: data.inputTokens,
						outputTokens: data.outputTokens,
						cacheCreationTokens: data.cacheCreationTokens,
						cacheReadTokens: data.cacheReadTokens,
						totalTokens: getTotalTokens(data),
						totalCost: data.totalCost,
						lastActivity: data.lastActivity,
						modelsUsed: data.modelsUsed,
						modelBreakdowns: data.modelBreakdowns,
						projectPath: data.projectPath,
					})),
					totals: createTotalsObject(totals),
				};
				log(JSON.stringify(jsonOutput, null, 2));
			}
			else {
			// Print header with data source indicator
				const headerText = `Claude Code Token Usage Report - By Session ${formatDataSource(dataSource)}`;
				logger.box(headerText);

				// Create table with compact mode support
				const table = new ResponsiveTable({
					head: [
						'Session',
						'Models',
						'Input',
						'Output',
						'Cache Create',
						'Cache Read',
						'Total Tokens',
						'Cost (USD)',
						'Last Activity',
					],
					style: {
						head: ['cyan'],
					},
					colAligns: [
						'left',
						'left',
						'right',
						'right',
						'right',
						'right',
						'right',
						'right',
						'left',
					],
					dateFormatter: formatDateCompact,
					compactHead: [
						'Session',
						'Models',
						'Input',
						'Output',
						'Cost (USD)',
						'Last Activity',
					],
					compactColAligns: [
						'left',
						'left',
						'right',
						'right',
						'right',
						'left',
					],
					compactThreshold: 100,
				});

				// Add session data
				let maxSessionLength = 0;
				for (const data of sessionData) {
					const sessionDisplay = data.sessionId.split('-').slice(-2).join('-'); // Display last two parts of session ID

					maxSessionLength = Math.max(maxSessionLength, sessionDisplay.length);

					// Main row
					table.push([
						sessionDisplay,
						formatModelsDisplayMultiline(data.modelsUsed),
						formatNumber(data.inputTokens),
						formatNumber(data.outputTokens),
						formatNumber(data.cacheCreationTokens),
						formatNumber(data.cacheReadTokens),
						formatNumber(getTotalTokens(data)),
						formatCurrency(data.totalCost),
						data.lastActivity,
					]);

					// Add model breakdown rows if flag is set
					if (ctx.values.breakdown) {
					// Session has 1 extra column before data and 1 trailing column
						pushBreakdownRows(table, data.modelBreakdowns, 1, 1);
					}
				}

				// Add empty row for visual separation before totals
				table.push([
					'',
					'',
					'',
					'',
					'',
					'',
					'',
					'',
					'',
				]);

				// Add totals
				table.push([
					pc.yellow('Total'),
					'', // Empty for Models column in totals
					pc.yellow(formatNumber(totals.inputTokens)),
					pc.yellow(formatNumber(totals.outputTokens)),
					pc.yellow(formatNumber(totals.cacheCreationTokens)),
					pc.yellow(formatNumber(totals.cacheReadTokens)),
					pc.yellow(formatNumber(getTotalTokens(totals))),
					pc.yellow(formatCurrency(totals.totalCost)),
					'',
				]);

				log(table.toString());

				// Show guidance message if in compact mode
				if (table.isCompactMode()) {
					logger.info('\nRunning in Compact Mode');
					logger.info('Expand terminal width to see cache metrics and total tokens');
				}
			}
		});
	},
});
