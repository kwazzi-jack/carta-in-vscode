/**
 * @module browser
 * Logic for opening and managing CARTA viewer surfaces (Webviews, Simple Browser, External Browser).
 */

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { CartaConfig } from './types';
import { validateExecutablePath } from './validation';

/** Internal tracking for active Webview panels and their current URLs */
const webviewPanels = new Map<string, { panel: vscode.WebviewPanel, url: string }>();

/**
 * Commands VS Code to open a URL in the built-in Simple Browser.
 */
async function openInSimpleBrowser(url: string): Promise<void> {
	await vscode.commands.executeCommand('simpleBrowser.show', url);
}

/**
 * Spawns an external browser process directly using a specific executable.
 * @param executablePath Path to the browser binary (e.g. /usr/bin/google-chrome).
 * @param url The CARTA URL to open.
 * @param args Additional command line arguments.
 */
function openWithExecutable(executablePath: string, url: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(executablePath, [...args, url], {
			detached: true,
			stdio: 'ignore',
			shell: false,
		});

		child.on('error', reject);
		child.unref();
		resolve();
	});
}

/**
 * Generates the HTML boilerplate for the Webview iframe.
 * @param url The authenticated CARTA URL (resolved to external URI).
 */
function getWebviewContent(url: string): string {
	const uri = vscode.Uri.parse(url);
	const origin = `${uri.scheme}://${uri.authority}`;

	return `
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin} ${url}; style-src 'unsafe-inline';">
			<title>CARTA Viewer</title>
			<style>
				body, html { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }
				iframe { border: none; height: 100%; width: 100%; }
			</style>
		</head>
		<body>
			<iframe src="${url}"></iframe>
		</body>
		</html>
	`;
}

/**
 * Manages the creation and focusing of a VS Code Webview panel for a CARTA instance.
 * @param instanceId The unique ID of the CARTA server.
 * @param url The CARTA web interface URL.
 * @param resolvedUrl The resolved external URI for the viewer.
 * @param folderName Display name for the tab title.
 * @param extensionUri Base URI of the extension for resource loading (icons).
 */
async function openInWebview(instanceId: string, url: string, resolvedUrl: string, folderName: string, extensionUri: vscode.Uri): Promise<void> {
	const entry = webviewPanels.get(instanceId);

	if (entry) {
		// Only update the HTML if the URL has changed (e.g. token refreshed on restart)
		// to avoid redundant reloads on simple tab focus.
		if (entry.url !== url) {
			entry.url = url;
			entry.panel.webview.html = getWebviewContent(resolvedUrl);
		}
		entry.panel.reveal(vscode.ViewColumn.Active);
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		`cartaViewer-${instanceId}`,
		`carta:${instanceId}:${folderName}/`,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true, // Crucial for state preservation
		}
	);

	panel.iconPath = vscode.Uri.joinPath(extensionUri, 'images', 'carta-for-vscode-icon.png');
	panel.webview.html = getWebviewContent(resolvedUrl);

	panel.onDidDispose(() => {
		webviewPanels.delete(instanceId);
	}, null);

	webviewPanels.set(instanceId, { panel, url });
}

/**
 * Explicitly disposes and removes the webview associated with a specific instance.
 */
export function closeWebviewForInstance(instanceId: string): void {
	const entry = webviewPanels.get(instanceId);
	if (entry) {
		entry.panel.dispose();
		webviewPanels.delete(instanceId);
	}
}

/**
 * Primary entry point for launching the viewer. Dispatches to the correct handler based on config.
 * @param instanceId ID of the CARTA instance.
 * @param url Authenticated CARTA URL.
 * @param folderName Name of the folder being served.
 * @param config Current extension configuration.
 * @param extensionUri Extension base URI.
 */
export async function openViewerForInstance(instanceId: string, url: string, folderName: string, config: CartaConfig, extensionUri: vscode.Uri): Promise<void> {
	// Resolve the local URL to an external URI for SSH/Remote compatibility.
	// This ensures VS Code port forwarding is active and we have the correct public address.
	const resolvedUri = await vscode.env.asExternalUri(vscode.Uri.parse(url));
	const resolvedUrl = resolvedUri.toString();

	if (config.viewerMode === 'webview') {
		await openInWebview(instanceId, url, resolvedUrl, folderName, extensionUri);
		return;
	}

	if (config.viewerMode === 'externalBrowser') {
		// If running in a remote context (SSH, Codespaces, Docker), 
		// we cannot spawn a local browser process on the server side.
		// We fallback to openExternal which correctly triggers the browser on the user's client machine.
		if (config.browserExecutablePath && !vscode.env.remoteName) {
			const validatedPath = await validateExecutablePath(config.browserExecutablePath, { type: 'browser' });
			await openWithExecutable(validatedPath, resolvedUrl, config.browserExecutableArgs);
			return;
		}

		await vscode.env.openExternal(resolvedUri);
		return;
	}

	try {
		await openInSimpleBrowser(resolvedUrl);
	} catch {
		await vscode.env.openExternal(resolvedUri);
	}
}
