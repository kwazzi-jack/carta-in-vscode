import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { CartaConfig } from './types';

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

export async function openViewerForInstance(url: string, config: CartaConfig): Promise<void> {
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
