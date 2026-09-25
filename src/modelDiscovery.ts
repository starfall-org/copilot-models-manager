import * as vscode from 'vscode';
import { discoverModels } from './providerClient';
import { DiscoveredModel, ManagedModel, ManagedProvider } from './types';
import { QUICK_PICK_ACCEPT_BUTTON, QUICK_PICK_CANCEL_BUTTON } from './quickInput';

export async function withDiscovery(provider: ManagedProvider, apiKey: string | undefined): Promise<DiscoveredModel[]> {
	return vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: `Fetching models from ${provider.name}`,
		cancellable: false,
	}, () => discoverModels(provider, apiKey));
}

interface FetchedModelQuickPickItem extends vscode.QuickPickItem {
	model: DiscoveredModel;
}

export async function pickFetchedModels(
	provider: ManagedProvider,
	discovered: DiscoveredModel[],
): Promise<Set<string> | undefined> {
	const selectedIds = new Set(
		provider.models
			.filter(model => model.enabled !== false)
			.map(model => model.id),
	);
	const allItems: FetchedModelQuickPickItem[] = discovered.map(model => ({
		label: model.name,
		description: model.id === model.name ? undefined : model.id,
		detail: [
			model.contextWindow ? `${model.contextWindow.toLocaleString()} context` : undefined,
			model.toolCalling === true ? 'tools' : undefined,
			model.vision === true ? 'vision' : undefined,
			model.thinking === true ? 'thinking' : undefined,
		].filter(Boolean).join(' · '),
		alwaysShow: true,
		model,
	}));


	return new Promise(resolve => {
		const quickPick = vscode.window.createQuickPick<FetchedModelQuickPickItem>();
		quickPick.title = `Fetch Models — ${provider.name}`;
		quickPick.placeholder = 'Search models by name or model ID';
		quickPick.canSelectMany = true;
		quickPick.ignoreFocusOut = true;
		quickPick.matchOnDescription = true;
		quickPick.matchOnDetail = true;
		quickPick.buttons = [QUICK_PICK_ACCEPT_BUTTON, QUICK_PICK_CANCEL_BUTTON];

		let visibleItems = allItems;
		let updating = false;
		let accepted = false;

		const applyVisibleItems = (query: string): void => {
			const normalized = query.trim().toLocaleLowerCase();
			visibleItems = normalized
				? allItems.filter(item =>
					item.label.toLocaleLowerCase().includes(normalized) ||
					(item.description?.toLocaleLowerCase().includes(normalized) ?? false) ||
					(item.detail?.toLocaleLowerCase().includes(normalized) ?? false),
				)
				: allItems;

			updating = true;
			quickPick.items = visibleItems;
			quickPick.selectedItems = visibleItems.filter(item => selectedIds.has(item.model.id));
			updating = false;
		};

		const disposables = [
			quickPick.onDidChangeValue(value => applyVisibleItems(value)),
			quickPick.onDidChangeSelection(items => {
				if (updating) {
					return;
				}
				for (const item of visibleItems) {
					selectedIds.delete(item.model.id);
				}
				for (const item of items) {
					selectedIds.add(item.model.id);
				}
			}),
			quickPick.onDidTriggerButton(button => {
				if (button === QUICK_PICK_ACCEPT_BUTTON) {
					accepted = true;
					quickPick.hide();
				} else if (button === QUICK_PICK_CANCEL_BUTTON) {
					accepted = false;
					quickPick.hide();
				}
			}),
			quickPick.onDidAccept(() => {
				accepted = true;
				quickPick.hide();
			}),
			quickPick.onDidHide(() => {
				for (const disposable of disposables) {
					disposable.dispose();
				}
				quickPick.dispose();
				resolve(accepted ? new Set(selectedIds) : undefined);
			}),
		];

		applyVisibleItems('');
		quickPick.show();
	});
}

export function mergeDiscoveredModels(discovered: DiscoveredModel[], current: ManagedModel[]): ManagedModel[] {
	if (!discovered.length) {
		return current;
	}

	const remaining = new Map(discovered.map(model => [model.id, model]));
	const models: ManagedModel[] = [];

	// Preserve the existing model order. Models discovered for the first time are
	// appended afterwards so newly added models never jump ahead of older ones.
	for (const model of current) {
		const refreshed = remaining.get(model.id);
		if (refreshed) {
			models.push(mergeDiscoveredModel(refreshed, model, false));
			remaining.delete(model.id);
		} else if (model.source === 'manual') {
			models.push(model);
		}
	}

	for (const model of discovered) {
		if (remaining.has(model.id)) {
			models.push(mergeDiscoveredModel(model, undefined, false));
		}
	}

	return models;
}

function mergeDiscoveredModel(
	discovered: DiscoveredModel,
	existing?: ManagedModel,
	defaultEnabled = false,
): ManagedModel {
	return {
		id: discovered.id,
		name: existing?.name ?? discovered.name,
		enabled: existing ? existing.enabled !== false : defaultEnabled,
		source: existing?.source ?? 'discovered',
		url: existing?.url,
		apiType: existing?.apiType,
		toolCalling: existing?.toolCalling ?? discovered.toolCalling ?? true,
		vision: existing?.vision ?? discovered.vision ?? false,
		thinking: existing?.thinking ?? discovered.thinking,
		adaptiveThinking: existing?.adaptiveThinking,
		minThinkingBudget: existing?.minThinkingBudget,
		maxThinkingBudget: existing?.maxThinkingBudget,
		streaming: existing?.streaming,
		editTools: existing?.editTools,
		contextWindow: existing?.contextWindow ?? discovered.contextWindow,
		maxInputTokens: existing?.maxInputTokens ?? discovered.maxInputTokens,
		maxOutputTokens: existing?.maxOutputTokens ?? discovered.maxOutputTokens,
		zeroDataRetentionEnabled: existing?.zeroDataRetentionEnabled,
		supportsReasoningEffort: existing?.supportsReasoningEffort ?? discovered.supportsReasoningEffort,
		reasoningEffortFormat: existing?.reasoningEffortFormat,
		modelOptions: existing?.modelOptions,
		requestHeaders: existing?.requestHeaders,
	};
}

