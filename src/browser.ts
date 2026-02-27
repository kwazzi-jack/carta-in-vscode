/**
 * @module browser
 * Logic for opening and managing CARTA viewer surfaces (Webviews, Simple Browser, External Browser).
 */

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { CartaConfig } from './types';
import { validateExecutablePath } from './validation';
import { logger } from './logger';

/** Internal tracking for active Webview panels and their current URLs */
const webviewPanels = new Map<string, { panel: vscode.WebviewPanel, url: string }>();

/**
 * Commands VS Code to open a URL in the built-in Simple Browser.
 */
async function openInSimpleBrowser(url: string): Promise<void> {
	logger.info(`Opening '${url}' in Simple Browser.`);
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
		logger.info(`Spawning external browser: ${executablePath} ${[...args, url].join(' ')}`);
		const child = spawn(executablePath, [...args, url], {
			detached: true,
			stdio: 'ignore',
			shell: false,
		});
		child.on('error', (err) => {
			logger.error(`Failed to spawn external browser '${executablePath}': ${err.message}`);
			reject(err);
		});
		child.unref();
		resolve();
	});
}

/**
 * Generates the HTML boilerplate for the Webview iframe.
 * @param finalUrl The authenticated CARTA URL (resolved to external URI).
 */
function getWebviewContent(finalUrl: string): string {
	const url = new URL(finalUrl);
	logger.debug(`[Webview] Creating content with iframe src: ${finalUrl}`);
	logger.debug(`[Webview] Granting frame-src access to origin: ${url.origin}`);

	return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${url.origin}; style-src 'unsafe-inline';">
            <title>CARTA Viewer</title>
            <style>
                body, html { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }
                iframe { border: none; height: 100%; width: 100%; }
            </style>
        </head>
        <body>
            <iframe src="${finalUrl}"></iframe>
        </body>
        </html>
    `;
}

/**
 * Manages the creation and focusing of a VS Code Webview panel for a CARTA instance.
 * @param instanceId The unique ID of the CARTA server.
 * @param finalUrl The fully resolved and authenticated CARTA URL.
 * @param folderName Display name for the tab title.
 * @param extensionUri Base URI of the extension for resource loading (icons).
 */
async function openInWebview(instanceId: string, finalUrl: string, folderName: string, extensionUri: vscode.Uri): Promise<void> {
	const entry = webviewPanels.get(instanceId);

	if (entry) {
		logger.info(`[Instance #${instanceId}] Revealing existing webview panel.`);
		if (entry.url !== finalUrl) {
			logger.info(`[Instance #${instanceId}] URL changed, updating webview content.`);
			entry.url = finalUrl;
			entry.panel.webview.html = getWebviewContent(finalUrl);
		}
		entry.panel.reveal(vscode.ViewColumn.Active);
		return;
	}

	logger.info(`[Instance #${instanceId}] Creating new webview panel for folder: ${folderName}`);
	const panel = vscode.window.createWebviewPanel(
		`cartaViewer-${instanceId}`,
		`carta:${instanceId}:${folderName}/`,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
		}
	);

	panel.iconPath = vscode.Uri.joinPath(extensionUri, 'images', 'carta-for-vscode-icon.png');
	panel.webview.html = getWebviewContent(finalUrl);

	panel.onDidDispose(() => {
		logger.info(`[Instance #${instanceId}] Webview panel disposed.`);
		webviewPanels.delete(instanceId);
	}, null);

	webviewPanels.set(instanceId, { panel, url: finalUrl });
}

/**
 * Explicitly disposes and removes the webview associated with a specific instance.
 */
export function closeWebviewForInstance(instanceId: string): void {
	const entry = webviewPanels.get(instanceId);
	if (entry) {
		logger.info(`Closing webview for instance #${instanceId}.`);
		entry.panel.dispose();
		webviewPanels.delete(instanceId);
	}
}

/**
 * Primary entry point for launching the viewer. Dispatches to the correct handler based on config.
 * @param instanceId ID of the CARTA instance.
 * @param baseUrl The raw, unresolved base URL from the CARTA process.
 * @param authToken The authentication token for the session.
 * @param folderName Name of the folder being served.
 * @param config Current extension configuration.
 * @param extensionUri Extension base URI.
 */
export async function openViewerForInstance(instanceId: string, baseUrl: string, authToken: string, folderName: string, config: CartaConfig, extensionUri: vscode.Uri): Promise<void> {
	logger.info(`[Instance #${instanceId}] Opening viewer for base URL: ${baseUrl}`);
	logger.debug(` > Auth Token: ${authToken}`);
	logger.debug(` > Viewer Mode: ${config.viewerMode}`);

	// 1. Resolve the base URL to a publicly accessible URI (handles remote port forwarding).
	const resolvedUri = await vscode.env.asExternalUri(vscode.Uri.parse(baseUrl));
	logger.debug(` > Resolved URI (after port forwarding): ${resolvedUri.toString()}`);

	// 2. Construct the final URL with the authentication token.
	const finalUrl = new URL(resolvedUri.toString());
	finalUrl.searchParams.set('token', authToken);
	const finalUrlString = finalUrl.toString();
	logger.info(`[Instance #${instanceId}] Constructed final authenticated URL: ${finalUrlString}`);

	// 3. Dispatch to the appropriate viewer.
	if (config.viewerMode === 'webview') {
		await openInWebview(instanceId, finalUrlString, folderName, extensionUri);
		return;
	}

	if (config.viewerMode === 'externalBrowser') {
		if (config.browserExecutablePath && !vscode.env.remoteName) {
			const validatedPath = await validateExecutablePath(config.browserExecutablePath, { type: 'browser' });
			await openWithExecutable(validatedPath, finalUrlString, config.browserExecutableArgs);
		} else {
			if (vscode.env.remoteName) {
				logger.info('In remote context, using vscode.env.openExternal to open on client machine.');
			}
			await vscode.env.openExternal(vscode.Uri.parse(finalUrlString));
		}
		return;
	}

	// Default to simpleBrowser, with a fallback to external.
	try {
		await openInSimpleBrowser(finalUrlString);
	} catch (error) {
		logger.warn(`Simple Browser failed to open, falling back to external browser. Error: ${error instanceof Error ? error.message : String(error)}`);
		await vscode.env.openExternal(vscode.Uri.parse(finalUrlString));
	}
}
