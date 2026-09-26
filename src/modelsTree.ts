import * as vscode from 'vscode';
import { ManagedModel, ManagedProvider } from './types';
import { ProviderStore } from './providerStore';

const PROVIDER_SORT_STATE_KEY = 'providerSortMode';

export type ProviderSortBy = 'time' | 'name' | 'quantity';
export type ProviderSortDirection = 'ascending' | 'descending';
export interface ProviderSortState {
	by: ProviderSortBy;
	directions: Record<ProviderSortBy, ProviderSortDirection>;
}

interface LegacyProviderSortState {
	by: ProviderSortBy;
	direction: ProviderSortDirection;
}

const DEFAULT_PROVIDER_SORT_DIRECTIONS: Record<ProviderSortBy, ProviderSortDirection> = {
	time: 'descending',
	name: 'ascending',
	quantity: 'descending',
};

function normalizeProviderSortState(
	saved: ProviderSortState | LegacyProviderSortState | ProviderSortBy | undefined,
): ProviderSortState {
	const directions = { ...DEFAULT_PROVIDER_SORT_DIRECTIONS };
	if (!saved) {
		return { by: 'time', directions };
	}
	if (typeof saved === 'string') {
		return { by: saved, directions };
	}
	if ('directions' in saved) {
		return {
			by: saved.by,
			directions: { ...directions, ...saved.directions },
		};
	}
	directions[saved.by] = saved.direction;
	return { by: saved.by, directions };
}

export function sortManagedProviders(
	providers: readonly ManagedProvider[],
	sortState: ProviderSortState,
): ManagedProvider[] {
	const direction = sortState.directions[sortState.by] === 'ascending' ? 1 : -1;
	return [...providers].sort((left, right) => {
		if (sortState.by === 'name') {
			return direction * left.name.localeCompare(
				right.name,
				undefined,
				{ sensitivity: 'base', numeric: true },
			);
		}
		if (sortState.by === 'quantity') {
			const leftCount = left.models.filter(model => model.enabled !== false).length;
			const rightCount = right.models.filter(model => model.enabled !== false).length;
			const quantityComparison = leftCount - rightCount;
			return quantityComparison !== 0
				? direction * quantityComparison
				: left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });
		}
		const timeComparison = left.createdAt - right.createdAt;
		return timeComparison !== 0
			? direction * timeComparison
			: left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });
	});
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
		const saved = state.get<ProviderSortState | LegacyProviderSortState | ProviderSortBy>(PROVIDER_SORT_STATE_KEY);
		this.sortState = normalizeProviderSortState(saved);
	}

	getSortState(): ProviderSortState {
		return {
			by: this.sortState.by,
			directions: { ...this.sortState.directions },
		};
	}

	async setSortState(sortState: ProviderSortState): Promise<void> {
		const sortTypes: ProviderSortBy[] = ['time', 'name', 'quantity'];
		const changed = this.sortState.by !== sortState.by
			|| sortTypes.some(by => this.sortState.directions[by] !== sortState.directions[by]);
		this.sortState = {
			by: sortState.by,
			directions: { ...sortState.directions },
		};
		if (changed) {
			await this.state.update(PROVIDER_SORT_STATE_KEY, this.sortState);
		}
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
			const providers = sortManagedProviders(this.store.getProviders(), this.sortState);
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
