import * as vscode from 'vscode';
import { ManagedModel, ManagedProvider } from './types';
import { ProviderStore } from './providerStore';

export type ModelsTreeNode = ProviderNode | ModelNode;

export class ProviderNode {
	readonly kind = 'provider';
	constructor(public readonly provider: ManagedProvider) {}
}

export class ModelNode {
	readonly kind = 'model';
	constructor(
		public readonly provider: ManagedProvider,
		public readonly model: ManagedModel,
	) {}
}

export class ModelsTreeProvider implements vscode.TreeDataProvider<ModelsTreeNode> {
	private readonly changeEmitter = new vscode.EventEmitter<ModelsTreeNode | undefined | null | void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	constructor(private readonly store: ProviderStore) {}

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(element: ModelsTreeNode): vscode.TreeItem {
		if (element.kind === 'provider') {
			const provider = element.provider;
			const selected = provider.models.filter(model => model.enabled !== false).length;
			const item = new vscode.TreeItem(
				provider.name,
				selected > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
			);
			item.id = `provider:${provider.id}`;
			item.contextValue = 'copilotModelsManager.provider';
			item.iconPath = new vscode.ThemeIcon('server-environment');
			item.description = `${provider.apiType} · ${selected} models`;
			item.tooltip = new vscode.MarkdownString(
				[
					`**${provider.name}**`,
					'',
					`API type: \`${provider.apiType}\``,
					`Base URL: \`${provider.baseUrl}\``,
					`Selected models: ${selected}`,
					`Copilot apiKey field: ${provider.copilotApiKey !== undefined ? 'preserved from chatLanguageModels.json' : 'not present'}`,
				].join('\n'),
			);
			return item;
		}

		const model = element.model;
		const item = new vscode.TreeItem(model.name, vscode.TreeItemCollapsibleState.None);
		item.id = `model:${element.provider.id}:${model.id}`;
		item.contextValue = model.thinking === true
			? 'copilotModelsManager.model.thinking'
			: 'copilotModelsManager.model.noThinking';
		item.iconPath = new vscode.ThemeIcon(model.toolCalling ? 'sparkle' : 'symbol-variable');
		const capabilities = [
			model.toolCalling ? 'tools' : undefined,
			model.vision ? 'vision' : undefined,
			model.thinking ? 'thinking' : undefined,
		].filter(Boolean);
		item.description = capabilities.join(' · ') || model.id;
		item.tooltip = new vscode.MarkdownString(
			[
				`**${model.name}**`,
				'',
				`ID: \`${model.id}\``,
				`Tool calling: ${model.toolCalling ? 'yes' : 'no'}`,
				`Vision: ${model.vision ? 'yes' : 'no'}`,
				`Thinking: ${model.thinking ? 'yes' : 'no'}`,
				model.contextWindow ? `Context window: ${model.contextWindow.toLocaleString()} tokens` : undefined,
				model.maxOutputTokens ? `Max output: ${model.maxOutputTokens.toLocaleString()} tokens` : undefined,
			].filter(Boolean).join('\n'),
		);
		item.command = {
			command: 'copilotModelsManager.editModel',
			title: 'Edit Model',
			arguments: [{ providerId: element.provider.id, modelId: model.id }],
		};
		return item;
	}

	getChildren(element?: ModelsTreeNode): ModelsTreeNode[] {
		if (!element) {
			return this.store.getProviders().map(provider => new ProviderNode(provider));
		}
		if (element.kind === 'provider') {
			return element.provider.models
				.filter(model => model.enabled !== false)
				.map(model => new ModelNode(element.provider, model));
		}
		return [];
	}
}