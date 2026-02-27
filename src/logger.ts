/**
 * @module logger
 * Centralized logging for the CARTA extension.
 */

import * as vscode from 'vscode';

/**
 * A VS Code output channel with logging enabled.
 *
 * This will create a "CARTA" output channel in the "Output" tab.
 * The `log: true` option also directs logs to a file on disk, which can be found
 * by running the "Developer: Open Extension Logs Folder" command in VS Code.
 */
export const logger = vscode.window.createOutputChannel("CARTA", { log: true });
