import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { CartaConfig } from './types';

const webviewPanels = new Map<string, { panel: vscode.WebviewPanel, url: string }>();

async function openInSimpleBrowser(url: string): Promise<void> {
	await vscode.commands.executeCommand('simpleBrowser.show', url);
}

function openWithExecutable(executablePath: string, url: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(executablePath, [url], {
			detached: true,
			stdio: 'ignore',
			shell: false,
		});

		child.on('error', reject);
		child.unref();
		resolve();
	});
}

function getWebviewContent(url: string): string {
	return `
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
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

function openInWebview(instanceId: string, url: string, folderName: string, extensionUri: vscode.Uri): Promise<void> {
	const entry = webviewPanels.get(instanceId);

	if (entry) {
		if (entry.url !== url) {
			entry.url = url;
			entry.panel.webview.html = getWebviewContent(url);
		}
		entry.panel.reveal(vscode.ViewColumn.Active);
		return Promise.resolve();
	}

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
	panel.webview.html = getWebviewContent(url);

	panel.onDidDispose(() => {
		webviewPanels.delete(instanceId);
	}, null);

	webviewPanels.set(instanceId, { panel, url });
	return Promise.resolve();
}

export function closeWebviewForInstance(instanceId: string): void {
	const entry = webviewPanels.get(instanceId);
	if (entry) {
		entry.panel.dispose();
		webviewPanels.delete(instanceId);
	}
}

export async function openViewerForInstance(instanceId: string, url: string, folderName: string, config: CartaConfig, extensionUri: vscode.Uri): Promise<void> {
	if (config.viewerMode === 'webview') {
		await openInWebview(instanceId, url, folderName, extensionUri);
		return;
	}

	if (config.viewerMode === 'externalBrowser') {
		if (config.browserExecutablePath) {
			await openWithExecutable(config.browserExecutablePath, url);
			return;
		}

		await vscode.env.openExternal(vscode.Uri.parse(url));
		return;
	}

	try {
		await openInSimpleBrowser(url);
	} catch {
		await vscode.env.openExternal(vscode.Uri.parse(url));
	}
}
