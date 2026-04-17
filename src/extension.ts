/**
 * @module extension
 * Main entry point for the CARTA VS Code extension.
 * Handles command registration, sidebar initialization, and folder history management.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { closeWebviewForInstance, openViewerForInstance } from './browser';
import { CartaManager } from './cartaManager';
import { getConfig, getWorkspaceFolderPath, promptForTargetFolder, validateLaunchCapacity } from './config';
import { RecentFoldersTreeProvider, RunningViewerItem, RunningViewersTreeProvider } from './views';
import { CartaInstance } from './types';
import { logger } from './logger';

/**
 * Extracts a valid CARTA instance ID from command arguments.
 * Supports string IDs or TreeItem objects.
 */
function getInstanceId(arg: unknown): string | undefined {
	if (typeof arg === 'string' && arg.length > 0) {
		return arg;
	}

	if (arg instanceof RunningViewerItem) {
		return arg.instance.id;
	}

	if (typeof arg === 'object' && arg !== null && 'id' in arg) {
		const { id } = arg as { id?: unknown };
		if (typeof id === 'string' && id.length > 0) {
			return id;
		}
	}
	logger.warn(`Could not extract a valid instance ID from argument:`, arg);
	return undefined;
}

/**
 * Manages the persistent list of recently opened folders using VS Code's globalState.
 */
class RecentFoldersManager {
	private static readonly STORAGE_KEY = 'recentFolders';
	private static readonly MAX_ITEMS = 15;
	private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();

	/** Notify when the history list is modified */
	readonly onDidChange = this.onDidChangeEmitter.event;

	constructor(private readonly context: vscode.ExtensionContext) {}

	/** Retrieves the ordered list of folder paths from global storage. */
	getRecentFolders(): string[] {
		return this.context.globalState.get<string[]>(RecentFoldersManager.STORAGE_KEY, []);
	}

	/** Adds a new folder to the top of the history, removing duplicates and enforcing limits. */
	async addFolder(folderPath: string): Promise<void> {
		logger.info(`Adding folder to recent list: ${folderPath}`);
		let recents = this.getRecentFolders();
		recents = recents.filter((f) => f !== folderPath);
		recents.unshift(folderPath);

		if (recents.length > RecentFoldersManager.MAX_ITEMS) {
			recents = recents.slice(0, RecentFoldersManager.MAX_ITEMS);
		}

		await this.context.globalState.update(RecentFoldersManager.STORAGE_KEY, recents);
		this.onDidChangeEmitter.fire();
	}

	/** Wipes the recent folder history. */
	async clearHistory(): Promise<void> {
		logger.info('Clearing recent folder history.');
		await this.context.globalState.update(RecentFoldersManager.STORAGE_KEY, []);
		this.onDidChangeEmitter.fire();
	}
}

/** Interface for folder selections in QuickPick menus */
interface FolderQuickPickItem extends vscode.QuickPickItem {
	path: string;
}

/** Interface for clear-history actions in QuickPick menus */
interface ActionQuickPickItem extends vscode.QuickPickItem {
	action: string;
}

/**
 * Checks if an instance is crashed and shows a warning if so.
 * @returns True if the instance was crashed and handled.
 */
async function handleCrashedInstance(instanceId: string, manager: CartaManager, actionName: string): Promise<boolean> {
	const instance = manager.getInstance(instanceId);
	if (instance?.status === 'crashed') {
		logger.warn(`Action '${actionName}' on crashed instance #${instanceId}.`);
		vscode.window.showWarningMessage(
			`CARTA: Server process for #${instanceId} is not present and we cannot reconnect. It was killed for some reason not through this extension.`,
			'Dismiss'
		);

		if (actionName === 'stop' || actionName === 'open') {
			logger.info(`Cleaning up crashed instance #${instanceId} from the UI.`);
			manager.stopInstance(instanceId);
		}
		return true;
	}
	return false;
}

/**
 * Provides a helpful error message when an executable is missing or invalid.
 */
async function handleExecutableError(error: unknown, type: 'carta' | 'browser') {
	const message = error instanceof Error ? error.message : String(error);
	logger.error(`Executable error (${type}): ${message}`, error);

	const buttons: string[] = ['Open Settings'];
	if (type === 'carta') {
		buttons.push('Download CARTA');
	}

	const selection = await vscode.window.showErrorMessage(
		`CARTA: ${type === 'carta' ? 'CARTA executable' : 'Browser'} error: ${message}`,
		...buttons
	);

	if (selection === 'Open Settings') {
		logger.info(`User selected 'Open Settings' from error message.`);
		await vscode.commands.executeCommand('workbench.action.openSettings', 'carta-in-vscode');
	} else if (selection === 'Download CARTA') {
		logger.info(`User selected 'Download CARTA' from error message.`);
		await vscode.env.openExternal(vscode.Uri.parse('https://cartavis.org/#download'));
	}
}

/**
 * Displays informational feedback without creating persistent modal-like notifications.
 */
function showTransientInfo(message: string, timeoutMs = 3500): void {
	vscode.window.setStatusBarMessage(message, timeoutMs);
}

/**
 * Resolves the instance from command args and warns if it cannot be found.
 */
function resolveInstanceFromArg(arg: unknown, manager: CartaManager): CartaInstance | undefined {
	const instanceId = getInstanceId(arg);
	if (!instanceId) {
		return undefined;
	}

	const instance = manager.getInstance(instanceId);
	if (!instance) {
		logger.warn(`Command failed: instance #${instanceId} not found.`);
		vscode.window.showWarningMessage(`CARTA: Instance #${instanceId} not found`);
		return undefined;
	}

	return instance;
}

/**
 * Builds the externally reachable authenticated URL for an instance.
 */
async function getAuthenticatedViewerUrl(instance: CartaInstance): Promise<string> {
	if (!instance.base_url) {
		throw new Error('Instance URL is not ready yet.');
	}

	if (!instance.authToken) {
		throw new Error('Instance token is not ready yet.');
	}

	const resolvedUri = await vscode.env.asExternalUri(vscode.Uri.parse(instance.base_url));
	const finalUrl = new URL(resolvedUri.toString());
	finalUrl.searchParams.set('token', instance.authToken);
	return finalUrl.toString();
}

/**
 * Extension entry point. Called by VS Code when any activationEvents are triggered.
 */
let manager: CartaManager;

/**
 * Extension entry point. Called by VS Code when any activationEvents are triggered.
 */
export function activate(context: vscode.ExtensionContext) {
	logger.info('CARTA in VS Code extension is activating...');

	manager = new CartaManager();
	const recentManager = new RecentFoldersManager(context);
	const runningProvider = new RunningViewersTreeProvider(manager);
	const recentProvider = new RecentFoldersTreeProvider(
		() => recentManager.getRecentFolders(),
		(listener): (() => void) => {
			const sub = recentManager.onDidChange(listener);
			return () => { sub.dispose(); };
		}
	);
	let lastSelectedFolderPath: string | undefined;

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('carta-recent', recentProvider),
		vscode.window.registerTreeDataProvider('carta-running', runningProvider),
		runningProvider,
		recentProvider,
		logger // Add logger to subscriptions to ensure it's disposed
	);
	logger.info('Registered sidebar view providers.');

	/**
	 * Shared logic to initiate a CARTA server on a directory and open the viewer.
	 */
	async function startWithFolder(folderPath: string) {
		logger.info(`Executing start sequence for folder: ${folderPath}`);
		lastSelectedFolderPath = folderPath;
		const config = getConfig();
		const capacityError = validateLaunchCapacity(config);
		if (capacityError) {
			logger.error(`Launch capacity error: ${capacityError}`);
			vscode.window.showErrorMessage(`CARTA: ${capacityError}`);
			return;
		}

		try {
			const instance = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Starting CARTA on ${path.basename(folderPath)}...`,
					cancellable: true,
				},
				(_progress, token) => manager.startInstance(config, folderPath, token)
			);

			if (instance.base_url) {
				await recentManager.addFolder(folderPath);
				await openViewerForInstance(instance.id, instance.base_url, instance.authToken ?? '', path.basename(instance.folderPath), config, context.extensionUri);
			} else {
				logger.error(`Instance #${instance.id} started but returned no base_url.`);
			}
		} catch (error: unknown) {
			if (error instanceof Error && error.message === 'Cancelled by user') {
				logger.info('CARTA startup was cancelled by the user.');
				showTransientInfo('CARTA: Startup cancelled');
				return;
			}
			await handleExecutableError(error, 'carta');
		}
	}

	const openCommand = vscode.commands.registerCommand('carta-in-vscode.open', async () => {
		logger.info('Command executed: carta-in-vscode.open');
		const folderPath = await promptForTargetFolder(lastSelectedFolderPath);
		if (!folderPath) {
			logger.info('User cancelled folder selection.');
			return;
		}
		await startWithFolder(folderPath);
	});

	const openRecentCommand = vscode.commands.registerCommand('carta-in-vscode.openRecent', async () => {
		logger.info('Command executed: carta-in-vscode.openRecent');
		const recents = recentManager.getRecentFolders();
		if (recents.length === 0) {
			showTransientInfo('CARTA: No recent folders found.');
			return;
		}

		const items: FolderQuickPickItem[] = recents.map((f) => ({ label: path.basename(f), description: f, path: f }));
		const clearItem: vscode.QuickPickItem = { label: '', kind: vscode.QuickPickItemKind.Separator };
		const clearAction: ActionQuickPickItem = { label: '$(trash) Clear Recent History', action: 'clear' };
		const selection = await vscode.window.showQuickPick<(FolderQuickPickItem | ActionQuickPickItem | vscode.QuickPickItem)>([...items, clearItem, clearAction], {
			placeHolder: 'Select a recent folder to open with CARTA',
		});

		if (!selection) {
			logger.info('User cancelled "Open Recent" quick pick.');
			return;
		}

		if ('action' in selection) {
			await recentManager.clearHistory();
			showTransientInfo('CARTA: Recent history cleared.');
		} else if ('path' in selection) {
			await startWithFolder(selection.path);
		}
	});

	const openRecentFolderCommand = vscode.commands.registerCommand('carta-in-vscode.openRecentFolder', async (folderPath: string) => {
		logger.info(`Command executed: carta-in-vscode.openRecentFolder (for ${folderPath})`);
		await startWithFolder(folderPath);
	});

	const openWorkspaceCommand = vscode.commands.registerCommand('carta-in-vscode.openWorkspace', async () => {
		logger.info('Command executed: carta-in-vscode.openWorkspace');
		const workspaceFolderPath = getWorkspaceFolderPath();
		if (!workspaceFolderPath) {
			logger.error('Cannot open workspace folder: no workspace is open.');
			vscode.window.showErrorMessage('CARTA: Open Workspace requires an open workspace folder.');
			return;
		}
		await startWithFolder(workspaceFolderPath);
	});

	const stopAllCommand = vscode.commands.registerCommand('carta-in-vscode.stopAll', () => {
		logger.info('Command executed: carta-in-vscode.stopAll');
		const instances = manager.getInstances();
		const hasCrashed = instances.some(i => i.status === 'crashed');
		const stoppedCount = manager.stopAll();
		for (const instance of instances) {
			closeWebviewForInstance(instance.id);
		}

		if (hasCrashed) {
			vscode.window.showWarningMessage('CARTA: Some server processes were already dead and could not be reconnected. They were killed for some reason not through this extension.');
		}
		showTransientInfo(
			stoppedCount > 0 ? `CARTA: Stopped ${stoppedCount} server${stoppedCount === 1 ? '' : 's'}` : 'CARTA: No running servers'
		);
	});

	const stopCommand = vscode.commands.registerCommand('carta-in-vscode.stop', () => {
		logger.info('Command executed: carta-in-vscode.stop');
		const instances = manager.getInstances();
		if (instances.length === 0) {
			showTransientInfo('CARTA: No running servers');
			return;
		}
		const newest = instances[0];
		manager.stopInstance(newest.id);
		closeWebviewForInstance(newest.id);
		showTransientInfo(`CARTA: Stopped server #${newest.id}`);
	});

	const openInstanceCommand = vscode.commands.registerCommand('carta-in-vscode.openInstance', async (arg: unknown) => {
		logger.info('Command executed: carta-in-vscode.openInstance', { arg });
		const config = getConfig();
		const instanceId = getInstanceId(arg);
		if (!instanceId) return;

		const instance = manager.getInstance(instanceId);
		if (!instance) {
			logger.warn(`Open instance failed: instance #${instanceId} not found.`);
			return;
		}

		if (await handleCrashedInstance(instanceId, manager, 'open')) return;

		if (!instance.base_url) {
			logger.warn(`Instance #${instanceId} URL is not ready yet.`);
			vscode.window.showWarningMessage('CARTA: Instance URL is not ready yet');
			return;
		}

		try {
			await openViewerForInstance(instance.id, instance.base_url, instance.authToken ?? '', path.basename(instance.folderPath), config, context.extensionUri);
		} catch (error: unknown) {
			await handleExecutableError(error, 'browser');
		}
	});

	const stopInstanceCommand = vscode.commands.registerCommand('carta-in-vscode.stopInstance', async (arg: unknown) => {
		logger.info('Command executed: carta-in-vscode.stopInstance', { arg });
		const instanceId = getInstanceId(arg);
		if (!instanceId) return;

		if (await handleCrashedInstance(instanceId, manager, 'stop')) return;

		if (manager.stopInstance(instanceId)) {
			closeWebviewForInstance(instanceId);
			showTransientInfo(`CARTA: Stopped server #${instanceId}`);
		}
	});

	const restartInstanceCommand = vscode.commands.registerCommand('carta-in-vscode.restartInstance', async (arg: unknown) => {
		logger.info('Command executed: carta-in-vscode.restartInstance', { arg });
		const instanceId = getInstanceId(arg);
		if (!instanceId) return;

		const instance = manager.getInstance(instanceId);
		if (instance?.status === 'crashed') {
			await vscode.window.showWarningMessage(
				`CARTA: Server process for #${instanceId} is not present and we cannot reconnect. It was killed for some reason not through this extension.`,
				'Dismiss'
			);
		}

		const config = getConfig();
		try {
			const newInstance = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Restarting CARTA server #${instanceId}...`,
					cancellable: false,
				},
				(): Promise<CartaInstance> => manager.restartInstance(instanceId, config)
			);

			if (newInstance.base_url) {
				await openViewerForInstance(newInstance.id, newInstance.base_url, newInstance.authToken ?? '', path.basename(newInstance.folderPath), config, context.extensionUri);
			} else {
				logger.error(`Restarted instance #${newInstance.id} returned no base_url.`);
			}
		} catch (error: unknown) {
			await handleExecutableError(error, 'carta');
		}
	});

	const copyInstanceIdCommand = vscode.commands.registerCommand('carta-in-vscode.copyInstanceId', async (arg: unknown) => {
		logger.info('Command executed: carta-in-vscode.copyInstanceId', { arg });
		const instanceId = getInstanceId(arg);
		if (!instanceId) return;

		const instance = manager.getInstance(instanceId);
		if (!instance) {
			logger.warn(`Copy instance ID failed: instance #${instanceId} not found.`);
			vscode.window.showWarningMessage(`CARTA: Instance #${instanceId} not found`);
			return;
		}

		const sessionIds = manager.getSessionIds(instanceId);
		const clipboardText = [
			`instanceId=${instance.id}`,
			`port=${instance.port}`,
			`folderPath=${instance.folderPath}`,
			`sessionIds=${sessionIds.length > 0 ? sessionIds.join(',') : 'none'}`,
		].join('\n');

		await vscode.env.clipboard.writeText(clipboardText);
		showTransientInfo(
			sessionIds.length > 0
				? `CARTA: Copied instance #${instance.id} with ${sessionIds.length} session ID${sessionIds.length === 1 ? '' : 's'}`
				: `CARTA: Copied instance #${instance.id} (no sessions observed yet)`
		);
	});

	const focusInstanceCommand = vscode.commands.registerCommand('carta-in-vscode.focusInstance', async (arg: unknown) => {
		logger.info('Command executed: carta-in-vscode.focusInstance', { arg });
		await vscode.commands.executeCommand('carta-in-vscode.openInstance', arg);
	});

	const copyInstanceUrlCommand = vscode.commands.registerCommand('carta-in-vscode.copyInstanceUrl', async (_arg: unknown) => {
		logger.info('Command executed: carta-in-vscode.copyInstanceUrl', { arg: _arg });
		const instance = resolveInstanceFromArg(_arg, manager);
		if (!instance) return;

		try {
			const finalUrl = await getAuthenticatedViewerUrl(instance);
			await vscode.env.clipboard.writeText(finalUrl);
			showTransientInfo(`CARTA: Copied URL for instance #${instance.id}`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			vscode.window.showWarningMessage(`CARTA: ${message}`);
		}
	});

	const copyInstanceTokenCommand = vscode.commands.registerCommand('carta-in-vscode.copyInstanceToken', async (_arg: unknown) => {
		logger.info('Command executed: carta-in-vscode.copyInstanceToken', { arg: _arg });
		const instance = resolveInstanceFromArg(_arg, manager);
		if (!instance) return;

		if (!instance.authToken) {
			vscode.window.showWarningMessage(`CARTA: Token is not ready for instance #${instance.id}`);
			return;
		}

		await vscode.env.clipboard.writeText(instance.authToken);
		showTransientInfo(`CARTA: Copied token for instance #${instance.id}`);
	});

	const copyInstanceSessionIdsCommand = vscode.commands.registerCommand('carta-in-vscode.copyInstanceSessionIds', async (_arg: unknown) => {
		logger.info('Command executed: carta-in-vscode.copyInstanceSessionIds', { arg: _arg });
		const instance = resolveInstanceFromArg(_arg, manager);
		if (!instance) return;

		const sessionIds = manager.getSessionIds(instance.id);
		const text = sessionIds.length > 0 ? sessionIds.join('\n') : 'none';
		await vscode.env.clipboard.writeText(text);

		showTransientInfo(
			sessionIds.length > 0
				? `CARTA: Copied ${sessionIds.length} session ID${sessionIds.length === 1 ? '' : 's'} for instance #${instance.id}`
				: `CARTA: No sessions observed yet for instance #${instance.id}`
		);
	});

	const openInstanceFolderCommand = vscode.commands.registerCommand('carta-in-vscode.openInstanceFolder', async (_arg: unknown) => {
		logger.info('Command executed: carta-in-vscode.openInstanceFolder', { arg: _arg });
		const instance = resolveInstanceFromArg(_arg, manager);
		if (!instance) return;

		const folderUri = vscode.Uri.file(instance.folderPath);
		try {
			const isInWorkspace = vscode.workspace.getWorkspaceFolder(folderUri) !== undefined;
			if (isInWorkspace) {
				await vscode.commands.executeCommand('revealInExplorer', folderUri);
				showTransientInfo(`CARTA: Revealed folder for instance #${instance.id}`);
				return;
			}

			await vscode.env.openExternal(folderUri);
			showTransientInfo(`CARTA: Opened folder for instance #${instance.id}`);
		} catch (error: unknown) {
			logger.warn(`Reveal in explorer failed for instance #${instance.id}: ${error instanceof Error ? error.message : String(error)}`);
			await vscode.env.openExternal(folderUri);
			showTransientInfo(`CARTA: Opened folder for instance #${instance.id}`);
		}
	});

	const openInstanceLogCommand = vscode.commands.registerCommand('carta-in-vscode.openInstanceLog', async (_arg: unknown) => {
		logger.info('Command executed: carta-in-vscode.openInstanceLog', { arg: _arg });
		const instance = resolveInstanceFromArg(_arg, manager);
		if (!instance) return;

		const logPath = path.join(os.homedir(), '.carta', 'log', 'carta.log');
		if (!fs.existsSync(logPath)) {
			const choice = await vscode.window.showWarningMessage(
				`CARTA: Log file not found at ${logPath}`,
				'Open Extension Logs Folder'
			);
			if (choice === 'Open Extension Logs Folder') {
				await vscode.commands.executeCommand('workbench.action.openLogsFolder');
			}
			return;
		}

		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(logPath));
		await vscode.window.showTextDocument(document, { preview: false });
		showTransientInfo(`CARTA: Opened log file for instance #${instance.id}`);
	});

	const ctxRestartInstanceCommand = vscode.commands.registerCommand('carta-in-vscode.ctx.restartInstance', async (arg: unknown) => {
		await vscode.commands.executeCommand('carta-in-vscode.restartInstance', arg);
	});

	const ctxStopInstanceCommand = vscode.commands.registerCommand('carta-in-vscode.ctx.stopInstance', async (arg: unknown) => {
		await vscode.commands.executeCommand('carta-in-vscode.stopInstance', arg);
	});

	const ctxFocusInstanceCommand = vscode.commands.registerCommand('carta-in-vscode.ctx.focusInstance', async (arg: unknown) => {
		await vscode.commands.executeCommand('carta-in-vscode.focusInstance', arg);
	});

	const ctxCopyInstanceUrlCommand = vscode.commands.registerCommand('carta-in-vscode.ctx.copyInstanceUrl', async (arg: unknown) => {
		await vscode.commands.executeCommand('carta-in-vscode.copyInstanceUrl', arg);
	});

	const ctxCopyInstanceTokenCommand = vscode.commands.registerCommand('carta-in-vscode.ctx.copyInstanceToken', async (arg: unknown) => {
		await vscode.commands.executeCommand('carta-in-vscode.copyInstanceToken', arg);
	});

	const ctxCopyInstanceSessionIdsCommand = vscode.commands.registerCommand('carta-in-vscode.ctx.copyInstanceSessionIds', async (arg: unknown) => {
		await vscode.commands.executeCommand('carta-in-vscode.copyInstanceSessionIds', arg);
	});

	const ctxOpenInstanceFolderCommand = vscode.commands.registerCommand('carta-in-vscode.ctx.openInstanceFolder', async (arg: unknown) => {
		await vscode.commands.executeCommand('carta-in-vscode.openInstanceFolder', arg);
	});

	const ctxOpenInstanceLogCommand = vscode.commands.registerCommand('carta-in-vscode.ctx.openInstanceLog', async (arg: unknown) => {
		await vscode.commands.executeCommand('carta-in-vscode.openInstanceLog', arg);
	});

	context.subscriptions.push(
		openCommand,
		openRecentCommand,
		openRecentFolderCommand,
		openWorkspaceCommand,
		stopCommand,
		stopAllCommand,
		openInstanceCommand,
		stopInstanceCommand,
		restartInstanceCommand,
		copyInstanceIdCommand,
		focusInstanceCommand,
		copyInstanceUrlCommand,
		copyInstanceTokenCommand,
		copyInstanceSessionIdsCommand,
		openInstanceFolderCommand,
		openInstanceLogCommand,
		ctxRestartInstanceCommand,
		ctxStopInstanceCommand,
		ctxFocusInstanceCommand,
		ctxCopyInstanceUrlCommand,
		ctxCopyInstanceTokenCommand,
		ctxCopyInstanceSessionIdsCommand,
		ctxOpenInstanceFolderCommand,
		ctxOpenInstanceLogCommand
	);
	logger.info('All CARTA commands registered.');
}

/**
 * Called by VS Code when the extension is disabled or closed.
 */
export function deactivate() {
	logger.info('CARTA in VS Code extension is deactivating.');
	if (manager) {
		manager.stopAll();
	}
}
