import * as vscode from 'vscode';
import { openViewerForInstance } from './browser';
import { CartaManager } from './cartaManager';
import { getConfig, getWorkspaceFolderPath, promptForTargetFolder, validateLaunchCapacity } from './config';
import { RunningViewerItem, RunningViewersTreeProvider } from './views';

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

export function activate(context: vscode.ExtensionContext) {
	const manager = new CartaManager();
	const runningProvider = new RunningViewersTreeProvider(manager);
	let lastSelectedFolderPath: string | undefined;

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('carta-running', runningProvider),
		runningProvider,
	);

	const openCommand = vscode.commands.registerCommand('carta-in-vscode.open', async () => {
		const config = getConfig();
		const capacityError = validateLaunchCapacity(config);
		if (capacityError) {
			vscode.window.showErrorMessage(`CARTA: ${capacityError}`);
			return;
		}

		const folderPath = await promptForTargetFolder(lastSelectedFolderPath);
		if (!folderPath) {
			return;
		}

		lastSelectedFolderPath = folderPath;

		try {
			const instance = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Starting CARTA server...',
					cancellable: true,
				},
				(_progress, token) => manager.startInstance(config, folderPath, token)
			);

			if (instance.url) {
				await openViewerForInstance(instance.url, config);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to start CARTA server.';
			if (message === 'Cancelled by user') {
				vscode.window.showInformationMessage('CARTA: Startup cancelled');
				return;
			}

			vscode.window.showErrorMessage(`CARTA: ${message}`);
		}
	});

	const openWorkspaceCommand = vscode.commands.registerCommand('carta-in-vscode.openWorkspace', async () => {
		const config = getConfig();
		const capacityError = validateLaunchCapacity(config);
		if (capacityError) {
			vscode.window.showErrorMessage(`CARTA: ${capacityError}`);
			return;
		}

		const workspaceFolderPath = getWorkspaceFolderPath();
		if (!workspaceFolderPath) {
			vscode.window.showErrorMessage('CARTA: Open Workspace requires an open workspace folder.');
			return;
		}

		try {
			const instance = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Starting CARTA server from workspace folder...',
					cancellable: true,
				},
				(_progress, token) => manager.startInstance(config, workspaceFolderPath, token)
			);

			if (instance.url) {
				await openViewerForInstance(instance.url, config);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to start CARTA server.';
			if (message === 'Cancelled by user') {
				vscode.window.showInformationMessage('CARTA: Startup cancelled');
				return;
			}

			vscode.window.showErrorMessage(`CARTA: ${message}`);
		}
	});

	const stopAllCommand = vscode.commands.registerCommand('carta-in-vscode.stopAll', () => {
		const stoppedCount = manager.stopAll();
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

		await openViewerForInstance(instance.url, config);
	});

	const stopInstanceCommand = vscode.commands.registerCommand('carta-in-vscode.stopInstance', (arg: unknown) => {
		const instanceId = getInstanceId(arg);
		if (!instanceId) {
			return;
		}

		const stopped = manager.stopInstance(instanceId);
		if (stopped) {
			vscode.window.showInformationMessage(`CARTA: Stopped server #${instanceId}`);
		}
	});

	context.subscriptions.push(openCommand, openWorkspaceCommand, stopCommand, stopAllCommand, openInstanceCommand, stopInstanceCommand);
}

export function deactivate() {}
