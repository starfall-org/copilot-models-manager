import * as vscode from 'vscode';
import { ManagedModel, ManagedProvider } from './types';
import { ProviderStore } from './providerStore';

const PROVIDER_SORT_STATE_KEY = 'providerSortMode';

export type ProviderSortBy = 'time' | 'name';
export type ProviderSortDirection = 'ascending' | 'descending';
export interface ProviderSortState {
	by: ProviderSortBy;
	direction: ProviderSortDirection;
}
export type ModelsTreeNode = RootNode | ProviderNode | ModelNode;

export class RootNode {
	readonly kind = 'root';
	constructor(public readonly label: string) {}
}

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
	private sortState: ProviderSortState;

	constructor(
		private readonly store: ProviderStore,
		private readonly state: vscode.Memento,
	) {
		const saved = state.get<ProviderSortState | ProviderSortBy>(PROVIDER_SORT_STATE_KEY);
		this.sortState = typeof saved === 'string'
			? { by: saved, direction: saved === 'time' ? 'descending' : 'ascending' }
			: saved ?? { by: 'time', direction: 'descending' };
	}

	getSortState(): ProviderSortState {
		return { ...this.sortState };
	}

	async setSortState(sortState: ProviderSortState): Promise<void> {
		if (this.sortState.by === sortState.by && this.sortState.direction === sortState.direction) {
			return;
		}
		this.sortState = { ...sortState };
		await this.state.update(PROVIDER_SORT_STATE_KEY, this.sortState);
		this.refresh();
	}

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(element: ModelsTreeNode): vscode.TreeItem {
		if (element.kind === 'root') {
			const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
			item.id = 'root:providers';
			item.contextValue = 'copilotModelsManager.root';
			return item;
		}

		if (element.kind === 'provider') {
			const provider = element.provider;
			const selected = provider.models.filter(model => model.enabled !== false).length;
			const item = new vscode.TreeItem(
				provider.name,
				selected > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
			);
			item.id = `provider:${provider.id}`;
			item.contextValue = selected > 0
				? 'copilotModelsManager.provider.withModels'
				: 'copilotModelsManager.provider.withoutModels';
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
			return [new RootNode('Model Providers')];
		}
		if (element.kind === 'root') {
			const providers = [...this.store.getProviders()];
			providers.sort((left, right) => {
				const direction = this.sortState.direction === 'ascending' ? 1 : -1;
				if (this.sortState.by === 'name') {
					return direction * left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });
				}
				const timeComparison = left.createdAt - right.createdAt;
				return timeComparison !== 0
					? direction * timeComparison
					: left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });
			});
			return providers.map(provider => new ProviderNode(provider));
		}
		if (element.kind === 'provider') {
			return element.provider.models
				.filter(model => model.enabled !== false)
				.map(model => new ModelNode(element.provider, model));
		}
		return [];
	}

}
