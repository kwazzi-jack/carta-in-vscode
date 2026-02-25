import * as path from 'path';
import * as vscode from 'vscode';
import { CartaManager } from './cartaManager';
import { CartaInstance } from './types';

export class RunningViewerItem extends vscode.TreeItem {
	constructor(public readonly instance: CartaInstance) {
		super(`#${instance.id} · ${instance.port}`, vscode.TreeItemCollapsibleState.None);
		this.description = path.basename(instance.folderPath);
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
