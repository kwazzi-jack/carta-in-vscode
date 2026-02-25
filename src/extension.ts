import * as path from 'path';
import * as vscode from 'vscode';
import { closeWebviewForInstance, openViewerForInstance } from './browser';
import { CartaManager } from './cartaManager';
import { getConfig, getWorkspaceFolderPath, promptForTargetFolder, validateLaunchCapacity } from './config';
import { RecentFoldersTreeProvider, RunningViewerItem, RunningViewersTreeProvider } from './views';
import { CartaInstance } from './types';

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

	return undefined;
}

class RecentFoldersManager {
	private static readonly STORAGE_KEY = 'recentFolders';
	private static readonly MAX_ITEMS = 15;
	private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();

	readonly onDidChange = this.onDidChangeEmitter.event;

	constructor(private readonly context: vscode.ExtensionContext) {}

	getRecentFolders(): string[] {
		return this.context.globalState.get<string[]>(RecentFoldersManager.STORAGE_KEY, []);
	}

	async addFolder(folderPath: string): Promise<void> {
		let recents = this.getRecentFolders();
		recents = recents.filter((f) => f !== folderPath);
		recents.unshift(folderPath);

		if (recents.length > RecentFoldersManager.MAX_ITEMS) {
			recents = recents.slice(0, RecentFoldersManager.MAX_ITEMS);
		}

		await this.context.globalState.update(RecentFoldersManager.STORAGE_KEY, recents);
		this.onDidChangeEmitter.fire();
	}

	async clearHistory(): Promise<void> {
		await this.context.globalState.update(RecentFoldersManager.STORAGE_KEY, []);
		this.onDidChangeEmitter.fire();
	}
}

interface FolderQuickPickItem extends vscode.QuickPickItem {
	path: string;
}

interface ActionQuickPickItem extends vscode.QuickPickItem {
	action: string;
}

export function activate(context: vscode.ExtensionContext) {
	const manager = new CartaManager();
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
	);

	async function startWithFolder(folderPath: string) {
		const config = getConfig();
		const capacityError = validateLaunchCapacity(config);
		if (capacityError) {
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

			if (instance.url) {
				await recentManager.addFolder(folderPath);
				await openViewerForInstance(instance.id, instance.url, path.basename(instance.folderPath), config, context.extensionUri);
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Failed to start CARTA server.';
			if (message === 'Cancelled by user') {
				vscode.window.showInformationMessage('CARTA: Startup cancelled');
				return;
			}
			vscode.window.showErrorMessage(`CARTA: ${message}`);
		}
	}

	const openCommand = vscode.commands.registerCommand('carta-in-vscode.open', async () => {
		const folderPath = await promptForTargetFolder(lastSelectedFolderPath);
		if (!folderPath) {
			return;
		}
		lastSelectedFolderPath = folderPath;
		await startWithFolder(folderPath);
	});

	const openRecentCommand = vscode.commands.registerCommand('carta-in-vscode.openRecent', async () => {
		const recents = recentManager.getRecentFolders();
		if (recents.length === 0) {
			vscode.window.showInformationMessage('CARTA: No recent folders found.');
			return;
		}

		const items: FolderQuickPickItem[] = recents.map((f) => ({
			label: path.basename(f),
			description: f,
			path: f,
		}));

		const clearItem: vscode.QuickPickItem = { label: '', kind: vscode.QuickPickItemKind.Separator };
		const clearAction: ActionQuickPickItem = { label: '$(trash) Clear Recent History', action: 'clear' };

		const selection = await vscode.window.showQuickPick<(FolderQuickPickItem | ActionQuickPickItem | vscode.QuickPickItem)>([...items, clearItem, clearAction], {
			placeHolder: 'Select a recent folder to open with CARTA',
		});

		if (!selection) {
			return;
		}

		if ('action' in selection) {
			await recentManager.clearHistory();
			vscode.window.showInformationMessage('CARTA: Recent history cleared.');
			return;
		}

		if ('path' in selection) {
			await startWithFolder((selection as FolderQuickPickItem).path);
		}
	});

	const openRecentFolderCommand = vscode.commands.registerCommand('carta-in-vscode.openRecentFolder', async (folderPath: string) => {
		await startWithFolder(folderPath);
	});

	const openWorkspaceCommand = vscode.commands.registerCommand('carta-in-vscode.openWorkspace', async () => {
		const workspaceFolderPath = getWorkspaceFolderPath();
		if (!workspaceFolderPath) {
			vscode.window.showErrorMessage('CARTA: Open Workspace requires an open workspace folder.');
			return;
		}
		await startWithFolder(workspaceFolderPath);
	});

	const stopAllCommand = vscode.commands.registerCommand('carta-in-vscode.stopAll', () => {
		const instances = manager.getInstances();
		const stoppedCount = manager.stopAll();
		for (const instance of instances) {
			closeWebviewForInstance(instance.id);
		}
		vscode.window.showInformationMessage(
			stoppedCount > 0 ? `CARTA: Stopped ${stoppedCount} server${stoppedCount === 1 ? '' : 's'}` : 'CARTA: No running servers'
		);
	});

	const stopCommand = vscode.commands.registerCommand('carta-in-vscode.stop', () => {
		const instances = manager.getInstances();
		if (instances.length === 0) {
			vscode.window.showInformationMessage('CARTA: No running servers');
			return;
		}

		const newest = instances[0];
		manager.stopInstance(newest.id);
		closeWebviewForInstance(newest.id);
		vscode.window.showInformationMessage(`CARTA: Stopped server #${newest.id}`);
	});

	const openInstanceCommand = vscode.commands.registerCommand('carta-in-vscode.openInstance', async (arg: unknown) => {
		const config = getConfig();
		const instanceId = getInstanceId(arg);
		if (!instanceId) {
			return;
		}

		const instance = manager.getInstance(instanceId);
		if (!instance?.url) {
			vscode.window.showWarningMessage('CARTA: Instance URL is not ready yet');
			return;
		}

		await openViewerForInstance(instance.id, instance.url, path.basename(instance.folderPath), config, context.extensionUri);
	});

	const stopInstanceCommand = vscode.commands.registerCommand('carta-in-vscode.stopInstance', (arg: unknown) => {
		const instanceId = getInstanceId(arg);
		if (!instanceId) {
			return;
		}

		const stopped = manager.stopInstance(instanceId);
		if (stopped) {
			closeWebviewForInstance(instanceId);
			vscode.window.showInformationMessage(`CARTA: Stopped server #${instanceId}`);
		}
	});

	const restartInstanceCommand = vscode.commands.registerCommand('carta-in-vscode.restartInstance', async (arg: unknown) => {
		const instanceId = getInstanceId(arg);
		if (!instanceId) {
			return;
		}

		const config = getConfig();
		try {
			const instance = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Restarting CARTA server #${instanceId}...`,
					cancellable: false,
				},
				// eslint-disable-next-line @typescript-eslint/no-unsafe-call
				(): Promise<CartaInstance> => manager.restartInstance(instanceId, config)
			);

			if (instance.url) {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
				await openViewerForInstance(instance.id, instance.url, path.basename(instance.folderPath), config, context.extensionUri);
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Failed to restart CARTA server.';
			vscode.window.showErrorMessage(`CARTA: ${message}`);
		}
	});

	context.subscriptions.push(openCommand, openRecentCommand, openRecentFolderCommand, openWorkspaceCommand, stopCommand, stopAllCommand, openInstanceCommand, stopInstanceCommand, restartInstanceCommand);
}

export function deactivate() {}
