/**
 * @module config
 * Configuration retrieval and validation for the extension.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { getPortRangeSize, parsePortRange } from './ports';
import { CartaConfig } from './types';

/**
 * Fetches the current configuration settings from the VS Code environment.
 * @returns A validated CartaConfig object.
 */
export function getConfig(): CartaConfig {
	const cfg = vscode.workspace.getConfiguration('carta-in-vscode');

	const portRangeRaw = cfg.get<string>('portRange', '3002-3099') ?? '3002-3099';

	return {
		executablePath: cfg.get<string>('executablePath', 'carta')?.trim() || 'carta',
		executableArgs: cfg.get<string[]>('executableArgs', []),
		portRange: parsePortRange(portRangeRaw),
		startupTimeout: cfg.get<number>('startupTimeout', -1),
		maxConcurrentServers: cfg.get<number>('maxConcurrentServers', 5),
		viewerMode: cfg.get<'webview' | 'simpleBrowser' | 'externalBrowser'>('viewerMode', 'webview'),
		browserExecutablePath: cfg.get<string>('browserExecutablePath', '')?.trim() || undefined,
		browserExecutableArgs: cfg.get<string[]>('browserExecutableArgs', []),
		environmentVariables: cfg.get<Record<string, string>>('environmentVariables', {}),
	};
}

/**
 * Validates whether the configured port range can accommodate the maximum allowed servers.
 * @param config The current CartaConfig.
 * @returns An error message if invalid, or undefined if valid.
 */
export function validateLaunchCapacity(config: CartaConfig): string | undefined {
	const rangeSize = getPortRangeSize(config.portRange);
	if (rangeSize < config.maxConcurrentServers) {
		return `Configured port range supports only ${rangeSize} concurrent ports, but maxConcurrentServers is ${config.maxConcurrentServers}.`;
	}

	return undefined;
}

/**
 * Retrieves the root path of the first open workspace folder.
 */
export function getWorkspaceFolderPath(): string | undefined {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return undefined;
	}

	return workspaceFolders[0].uri.fsPath;
}

/**
 * Determines the best starting point for the folder open dialog.
 * @param lastSelectedFolderPath Folder that was most recently used.
 */
function getPreferredDefaultUri(lastSelectedFolderPath?: string): vscode.Uri | undefined {
	if (lastSelectedFolderPath) {
		return vscode.Uri.file(lastSelectedFolderPath);
	}

	const activeDoc = vscode.window.activeTextEditor?.document;
	if (activeDoc?.uri.scheme === 'file') {
		const filePath = activeDoc.uri.fsPath;
		return vscode.Uri.file(path.dirname(filePath));
	}

	const workspacePath = getWorkspaceFolderPath();
	return workspacePath ? vscode.Uri.file(workspacePath) : undefined;
}

/**
 * Prompts the user to select a folder on their machine to serve with CARTA.
 * @param lastSelectedFolderPath Previous selection to start the dialog from.
 * @returns The selected folder path or undefined if the dialog was cancelled.
 */
export async function promptForTargetFolder(lastSelectedFolderPath?: string): Promise<string | undefined> {
	const folderUri = await vscode.window.showOpenDialog({
		canSelectFolders: true,
		canSelectFiles: false,
		openLabel: 'Open folder with CARTA',
		defaultUri: getPreferredDefaultUri(lastSelectedFolderPath),
	});

	if (!folderUri || folderUri.length === 0) {
		return undefined;
	}

	return folderUri[0].fsPath;
}
