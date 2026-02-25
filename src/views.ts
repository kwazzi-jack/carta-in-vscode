import * as path from 'path';
import * as vscode from 'vscode';
import { CartaManager } from './cartaManager';
import { CartaInstance } from './types';

export class RunningViewerItem extends vscode.TreeItem {
	constructor(public readonly instance: CartaInstance) {
		super(path.basename(instance.folderPath) + "/", vscode.TreeItemCollapsibleState.None);
		this.description = `#${instance.id} · ${instance.port}`;
		this.tooltip = instance.url ?? `Starting on localhost:${instance.port}...`;
		this.iconPath = new vscode.ThemeIcon(instance.url ? 'vm-active' : 'loading~spin');
		this.contextValue = 'cartaInstance';
		if (instance.url) {
			this.command = {
				command: 'carta-in-vscode.openInstance',
				title: 'Open Viewer',
				arguments: [instance.id],
			};
		}
		this.id = instance.id;
	}
}

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

export class RecentFoldersTreeProvider implements vscode.TreeDataProvider<RecentFolderItem>, vscode.Disposable {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<RecentFolderItem | undefined>();
	private readonly unsubscribe: () => void;

	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

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


export class RunningViewersTreeProvider implements vscode.TreeDataProvider<RunningViewerItem>, vscode.Disposable {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<RunningViewerItem | undefined>();
	private readonly unsubscribeManager: () => void;

	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

	constructor(private readonly manager: CartaManager) {
		this.unsubscribeManager = this.manager.onDidChange(() => this.refresh());
	}

	dispose(): void {
		this.unsubscribeManager();
		this.onDidChangeTreeDataEmitter.dispose();
	}

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
