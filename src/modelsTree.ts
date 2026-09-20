import * as vscode from 'vscode';
import { ManagedProvider } from './types';
import { ProviderStore } from './providerStore';

export class ProviderNode {
	readonly kind = 'provider';
	constructor(public readonly provider: ManagedProvider) {}
}

export class ModelsTreeProvider implements vscode.TreeDataProvider<ProviderNode> {
	private readonly changeEmitter = new vscode.EventEmitter<ProviderNode | undefined | null | void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	constructor(private readonly store: ProviderStore) {}

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(element: ProviderNode): vscode.TreeItem {
		const provider = element.provider;
		const selected = provider.models.filter(model => model.enabled !== false).length;
		const item = new vscode.TreeItem(provider.name, vscode.TreeItemCollapsibleState.None);
		item.id = `provider:${provider.id}`;
		item.contextValue = 'copilotModelsManager.provider';
		item.iconPath = new vscode.ThemeIcon('server-environment');
		item.description = `${provider.apiType} · ${selected}/${provider.models.length}`;
		item.tooltip = new vscode.MarkdownString(
			[
				`**${provider.name}**`,
				'',
				`API type: \`${provider.apiType}\``,
				`Base URL: \`${provider.baseUrl}\``,
				`Selected models: ${selected}/${provider.models.length}`,
			].join('\n'),
		);
		return item;
	}

	getChildren(): ProviderNode[] {
		return this.store.getProviders().map(provider => new ProviderNode(provider));
	}
}
