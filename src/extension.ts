import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'child_process';

// --- Globals ---
let cartaProcess: ChildProcess | undefined;
let cartaPanel: vscode.WebviewPanel | undefined;

function getConfig(): { executablePath: string; port: number; startupTimeout: number; } {
	const cfg = vscode.workspace.getConfiguration('carta-in-vscode');
	return {
		executablePath: cfg.get<string>('executablePath', 'carta'), // defaults to `carta`
		port: cfg.get<number>('port', 3002), // defaults to 3002
		startupTimeout: cfg.get<number>('startupTimeout', 180000), //defaults to 180 seconds (3 minutes)
	};
}

async function getTargetFolder(): Promise<string | undefined> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders && workspaceFolders.length > 0) {
		return workspaceFolders[0].uri.fsPath;
	}

	const folderUri = await vscode.window.showOpenDialog({
		canSelectFolders: true,
		canSelectFiles: false,
		openLabel: 'Open folder with CARTA',
	});

	if (!folderUri || folderUri.length === 0) {
		return undefined; // User cancelled
	}

	return folderUri[0].fsPath;
}

function getWebviewHtml(cartaUrl: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en" style="height:100%; margin:0; padding:0;">
    <head>
      <meta charset="UTF-8"/>
      <meta
        http-equiv="Content-Security-Policy"
        content="default-src 'none'; frame-src *; style-src 'unsafe-inline';"
      />
      <style>
        body, html {
          margin: 0;
          padding: 0;
          height: 100%;
          overflow: hidden;
          background: #1e1e1e;
        }
        iframe {
          width: 100%;
          height: 100vh;
          border: none;
          display: block;
        }
      </style>
    </head>
    <body>
      <iframe src="${cartaUrl}" allowfullscreen></iframe>
    </body>
    </html>
  `;
}

function stopCarta() {
  if (cartaProcess) {
    cartaProcess.kill('SIGKILL');
    cartaProcess = undefined;
  }
  // Fetch port
  const { port } = getConfig();

  // Also force-kill anything still on the port
  spawn('fuser', ['-k', `${port}/tcp`], { shell: true });

  if (cartaPanel) {
    cartaPanel.dispose();
    cartaPanel = undefined;
  }
}

function openPanel(cartaUrl: string, context: vscode.ExtensionContext) {
	cartaPanel = vscode.window.createWebviewPanel(
		'carta-in-vscode',
		'Carta In VS Code',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			retainContextWhenHidden: true, // keeps CARTA alive when tab switching
		}
	);

	cartaPanel.webview.html = getWebviewHtml(cartaUrl);

	// Clean up when tab closes
	cartaPanel.onDidDispose(() => {
		cartaPanel = undefined;
		stopCarta();
	}, null, context.subscriptions);
}

export function activate(context: vscode.ExtensionContext) {

	// --- Command: Open CARTA ---
	const openCommand = vscode.commands.registerCommand('carta-in-vscode.open', async () => {
		// If panel exists, bring to focus
		if (cartaPanel) {
			cartaPanel.reveal();
			return;
		}

		// Get folder path
		const folderPath = await getTargetFolder();
		if (!folderPath) {
			return;
		}

		// Launch CARTA and wait for it to be ready
		vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Starting CARTA server...' }, () => new Promise<void>((resolve, reject) => {

				// Fetch config values
				const { executablePath, port, startupTimeout } = getConfig();

				// Spawn process
				cartaProcess = spawn(executablePath, [
					'--no_browser',
					'--host', 'localhost',
					'-p', port.toString(),
					folderPath
				], { shell: true });

				let resolved = false;

				function onReady(cartaUrl: string) {
					if (!resolved) {
						resolved = true;
						resolve();
						setTimeout(() => openPanel(cartaUrl, context), 500);
					}
				}

				function checkIfReady(output: string) {
					const match = output.match(/http:\/\/localhost:\d+\/\?token=[\w-]+/);
					if (match) {
						onReady(match[0]); // pass the full URL including token
					}
				}

				cartaProcess.stdout?.on('data', (data: Buffer) => {
					const output = data.toString();
					console.log('[CARTA stdout]', output);
					checkIfReady(output);
				});

				cartaProcess.stderr?.on('data', (data: Buffer) => {
					const output = data.toString();
					console.log('[CARTA stderr]', output);
					checkIfReady(output);
				});

				cartaProcess.on('error', (err) => {
					if (!resolved) {
						resolved = true;
						reject(err);
						vscode.window.showErrorMessage(
							`CARTA: Failed to start. Is it installed and on your PATH? Error: ${err.message}`
						);
					}
				});

				cartaProcess.on('close', (code) => {
					console.log(`[CARTA] process exited with code ${code}`);
					cartaProcess = undefined;
				});

				// Bail if CARTA does not respond
				setTimeout(() => {
					if (!resolved) {
						resolved = true;
						reject(new Error('Timeout'));
						vscode.window.showErrorMessage('CARTA: Timed out waiting for server to start');
					}
				}, startupTimeout);
			})
		);
	});

	// --- Command: Stop CARTA ---
	const stopCommand = vscode.commands.registerCommand('carta-in-vscode.stop', () => {
		stopCarta();
		vscode.window.showInformationMessage('CARTA: Server stopped');
	});

	context.subscriptions.push(openCommand, stopCommand);
}

// This method is called when your extension is deactivated
export function deactivate() { }
