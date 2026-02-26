/**
 * @module views
 * Visual components for the VS Code activity bar, including tree items and data providers.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { CartaManager } from './cartaManager';
import { CartaInstance } from './types';

/**
 * Represents a row in the "Running Viewers" sidebar view.
 */
export class RunningViewerItem extends vscode.TreeItem {
	constructor(public readonly instance: CartaInstance) {
		// Use the folder name as the primary title
		super(path.basename(instance.folderPath) + "/", vscode.TreeItemCollapsibleState.None);
		// Show instance metadata as a dimmed description
		this.description = `#${instance.id} · ${instance.port}`;
		
		if (instance.status === 'crashed') {
			this.tooltip = `CARTA process died unexpectedly (#${instance.id})`;
			this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('notificationsWarningIcon.foreground'));
		} else {
			this.tooltip = instance.url ?? `Starting on 127.0.0.1:${instance.port}...`;
			this.iconPath = new vscode.ThemeIcon(instance.url ? 'vm-active' : 'loading~spin');
		}

		this.contextValue = 'cartaInstance';
		
		// If the server is ready or crashed, make the row clickable.
		if (instance.url || instance.status === 'crashed') {
			this.command = {
				command: 'carta-in-vscode.openInstance',
				title: instance.status === 'crashed' ? 'Show Crash Warning' : 'Open Viewer',
				arguments: [instance.id],
			};
		}
		this.id = instance.id;
	}
}

/**
 * Data provider that connects the CartaManager's state to the "Running Viewers" tree view.
 */
export class RunningViewersTreeProvider implements vscode.TreeDataProvider<RunningViewerItem>, vscode.Disposable {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<RunningViewerItem | undefined>();
	private readonly unsubscribeManager: () => void;

	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

	constructor(private readonly manager: CartaManager) {
		// Automatically refresh the UI whenever the manager's instances change.
		this.unsubscribeManager = this.manager.onDidChange(() => this.refresh());
	}

	dispose(): void {
		this.unsubscribeManager();
		this.onDidChangeTreeDataEmitter.dispose();
	}

	/**
	 * Force a re-render of the tree view.
	 */
	refresh(): void {
		this.onDidChangeTreeDataEmitter.fire(undefined);
	}

	getTreeItem(element: RunningViewerItem): vscode.TreeItem {
		return element;
	}

	getChildren(): RunningViewerItem[] {
		return this.manager.getInstances().map((instance) => new RunningViewerItem(instance));
	}
}

/**
 * Represents a row in the "Recent Folders" sidebar view.
 */
export class RecentFolderItem extends vscode.TreeItem {
	constructor(public readonly folderPath: string) {
		super(path.basename(folderPath) + "/", vscode.TreeItemCollapsibleState.None);
		this.description = folderPath;
		this.tooltip = folderPath;
		this.iconPath = new vscode.ThemeIcon('folder');
		this.contextValue = 'recentFolder';
		this.command = {
			command: 'carta-in-vscode.openRecentFolder',
			title: 'Open Recent Folder',
			arguments: [folderPath],
		};
	}
}

/**
 * Data provider for the "Recent Folders" sidebar view.
 */
export class RecentFoldersTreeProvider implements vscode.TreeDataProvider<RecentFolderItem>, vscode.Disposable {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<RecentFolderItem | undefined>();
	private readonly unsubscribe: () => void;

	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

	/**
	 * @param getRecents Function to retrieve the current list of paths.
	 * @param onDidChange Function to subscribe to updates in the recent folder history.
	 */
	constructor(private readonly getRecents: () => string[], onDidChange: (listener: () => void) => () => void) {
		this.unsubscribe = onDidChange(() => this.refresh());
	}

	dispose(): void {
		this.unsubscribe();
		this.onDidChangeTreeDataEmitter.dispose();
	}

	refresh(): void {
		this.onDidChangeTreeDataEmitter.fire(undefined);
	}

	getTreeItem(element: RecentFolderItem): vscode.TreeItem {
		return element;
	}

	getChildren(): RecentFolderItem[] {
		return this.getRecents().slice(0, 10).map((folder) => new RecentFolderItem(folder));
	}
}
