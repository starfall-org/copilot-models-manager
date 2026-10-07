import * as vscode from 'vscode';
import { CopilotConfigService } from './copilotConfig';
import { defaultContextWindow, defaultMaxInputTokens, defaultMaxOutputTokens, normalizeBaseUrl } from './providerClient';
import { ProviderStore } from './providerStore';
import { ModelsTreeProvider, ProviderNode } from './modelsTree';
import { ManagedModel } from './types';
import { ModelTarget, persistAndRefresh, resolveProvider, resolveModel } from './commandShared';
import { showManagedQuickPick, pickRequiredBoolean, pickOptionalBoolean, pickOptionalApiType, pickEditTools, pickReasoningEfforts, optionalBooleanLabel, optionalNumberLabel, editRequestHeaders, editJsonObject, validateHttpUrl, validateObjectJson, askOptionalPositiveInteger } from './quickInput';
import { setModelApiType, setThinkingState } from './reasoningEffort';

export async function addModel(
	store: ProviderStore,
	config: CopilotConfigService,
	tree: ModelsTreeProvider,
	node?: ProviderNode,
): Promise<void> {
	const provider = await resolveProvider(store, node);
	if (!provider) {
		return;
	}

	let draft: ManagedModel = {
		id: '',
		name: '',
		enabled: true,
		source: 'manual',
		toolCalling: true,
		vision: false,
		contextWindow: defaultContextWindow(),
		maxInputTokens: defaultMaxInputTokens(),
		maxOutputTokens: defaultMaxOutputTokens(),
	};

	while (true) {
		const action = await showManagedQuickPick([
			{ label: '$(symbol-key) id', description: draft.id || 'Required', value: 'id' },
			{ label: '$(edit) name', description: draft.name || 'Required', value: 'name' },
			{ label: '$(link) url', description: draft.url ?? 'Generated from provider base URL', value: 'url' },
			{ label: '$(symbol-enum) apiType', description: draft.apiType ?? `Inherit: ${provider.apiType}`, value: 'apiType' },
			{ label: '$(tools) toolCalling', description: String(draft.toolCalling), value: 'toolCalling' },
			{ label: '$(eye) vision', description: String(draft.vision), value: 'vision' },
			{ label: '$(lightbulb) thinking', description: optionalBooleanLabel(draft.thinking), value: 'thinking' },
			{ label: '$(lightbulb-autofix) adaptiveThinking', description: optionalBooleanLabel(draft.adaptiveThinking), value: 'adaptiveThinking' },
			{ label: '$(symbol-number) minThinkingBudget', description: optionalNumberLabel(draft.minThinkingBudget), value: 'minThinkingBudget' },
			{ label: '$(symbol-number) maxThinkingBudget', description: optionalNumberLabel(draft.maxThinkingBudget), value: 'maxThinkingBudget' },
			{ label: '$(pulse) streaming', description: optionalBooleanLabel(draft.streaming), value: 'streaming' },
			{ label: '$(wrench) editTools', description: draft.editTools?.join(', ') || 'Unset', value: 'editTools' },
			{ label: '$(symbol-number) contextWindow', description: optionalNumberLabel(draft.contextWindow), value: 'contextWindow' },
			{ label: '$(symbol-number) maxInputTokens', description: optionalNumberLabel(draft.maxInputTokens), value: 'maxInputTokens' },
			{ label: '$(symbol-number) maxOutputTokens', description: optionalNumberLabel(draft.maxOutputTokens), value: 'maxOutputTokens' },
			{ label: '$(shield) zeroDataRetentionEnabled', description: optionalBooleanLabel(draft.zeroDataRetentionEnabled), value: 'zeroDataRetentionEnabled' },
			{ label: '$(list-unordered) supportsReasoningEffort', description: draft.supportsReasoningEffort?.join(', ') || 'Unset', value: 'supportsReasoningEffort' },
			{ label: '$(symbol-enum) reasoningEffortFormat', description: draft.reasoningEffortFormat ?? 'Unset', value: 'reasoningEffortFormat' },
			{ label: '$(settings-gear) modelOptions', description: draft.modelOptions ? JSON.stringify(draft.modelOptions) : 'Unset', value: 'modelOptions' },
			{ label: '$(json) requestHeaders', description: draft.requestHeaders ? JSON.stringify(draft.requestHeaders) : 'Unset', value: 'requestHeaders' },
			{ label: '$(save) Save Model', description: `Add model to ${provider.name}`, value: 'save' },
		], {
			title: `Add Model to ${provider.name}`,
			placeHolder: 'Edit model fields, then choose Save Model',
			ignoreFocusOut: true,
			matchOnDescription: true,
		}, () => ({ label: '$(save) Save Model', description: `Add model to ${provider.name}`, value: 'save' }));
		if (!action) {
			return;
		}

		switch (action.value) {
			case 'id': {
				const value = await vscode.window.showInputBox({
					title: 'Model ID',
					value: draft.id,
					ignoreFocusOut: true,
					validateInput: value => {
						const id = value.trim();
						if (!id) {
							return 'Model ID is required.';
						}
						return provider.models.some(item => item.id === id)
							? `Model ID "${id}" already exists in this provider.`
							: undefined;
					},
				});
				if (value === undefined) {
					continue;
				}
				const oldId = draft.id;
				draft = { ...draft, id: value.trim() };
				if (!draft.name || draft.name === oldId) {
					draft = { ...draft, name: value.trim() };
				}
				break;
			}
			case 'name': {
				const value = await vscode.window.showInputBox({
					title: 'Model Display Name',
					value: draft.name,
					ignoreFocusOut: true,
					validateInput: value => value.trim() ? undefined : 'Display name is required.',
				});
				if (value === undefined) {
					continue;
				}
				draft = { ...draft, name: value.trim() };
				break;
			}
			case 'url': {
				const value = await vscode.window.showInputBox({
					title: 'Model URL Override',
					prompt: 'Leave empty to generate the model URL from the provider base URL.',
					value: draft.url ?? '',
					ignoreFocusOut: true,
					validateInput: value => !value.trim() ? undefined : validateHttpUrl(value),
				});
				if (value === undefined) {
					continue;
				}
				draft = { ...draft, url: value.trim() || undefined };
				break;
			}
			case 'apiType': {
				const value = await pickOptionalApiType('Model API Type', provider.apiType, draft.apiType);
				if (value.cancelled) {
					continue;
				}
				draft = setModelApiType(draft, provider.apiType, value.value);
				break;
			}
			case 'toolCalling': {
				const value = await pickRequiredBoolean('Tool Calling', draft.toolCalling);
				if (value === undefined) {
					continue;
				}
				draft = { ...draft, toolCalling: value };
				break;
			}
			case 'vision': {
				const value = await pickRequiredBoolean('Vision', draft.vision);
				if (value === undefined) {
					continue;
				}
				draft = { ...draft, vision: value };
				break;
			}
			case 'thinking': {
				const value = await pickOptionalBoolean('thinking', draft.thinking);
				if (value.cancelled) {
					continue;
				}
				draft = setThinkingState(draft, provider.apiType, value.value);
				break;
			}
			case 'adaptiveThinking':
			case 'streaming':
			case 'zeroDataRetentionEnabled': {
				const current = draft[action.value];
				const value = await pickOptionalBoolean(action.label.replace(/^\$\([^)]*\)\s*/, ''), current);
				if (value.cancelled) {
					continue;
				}
				draft = { ...draft, [action.value]: value.value };
				break;
			}
			case 'minThinkingBudget':
			case 'maxThinkingBudget':
			case 'contextWindow':
			case 'maxInputTokens':
			case 'maxOutputTokens': {
				const current = draft[action.value];
				const value = await askOptionalPositiveInteger(action.label.replace(/^\$\([^)]*\)\s*/, ''), current);
				draft = { ...draft, [action.value]: value };
				break;
			}
			case 'editTools': {
				const value = await pickEditTools(draft.editTools);
				if (value === null) {
					continue;
				}
				draft = { ...draft, editTools: value.length ? value : undefined };
				break;
			}
			case 'supportsReasoningEffort': {
				const value = await pickReasoningEfforts(draft.apiType ?? provider.apiType, draft.supportsReasoningEffort);
				if (value === null) {
					continue;
				}
				draft = { ...draft, supportsReasoningEffort: value.length ? value : undefined };
				break;
			}
			case 'reasoningEffortFormat': {
				const value = await pickOptionalApiType('Reasoning Effort Format', provider.apiType, draft.reasoningEffortFormat);
				if (value.cancelled) {
					continue;
				}
				draft = { ...draft, reasoningEffortFormat: value.value };
				break;
			}
			case 'modelOptions': {
				const value = await editJsonObject(
					'Model Options',
					'JSON object sent with each model request. Empty removes the property.',
					draft.modelOptions,
					validateObjectJson,
				);
				if (value.cancelled) {
					continue;
				}
				draft = { ...draft, modelOptions: value.value };
				break;
			}
			case 'requestHeaders': {
				const value = await editRequestHeaders('Request Headers', draft.requestHeaders);
				if (value.cancelled) {
					continue;
				}
				draft = { ...draft, requestHeaders: value.value };
				break;
			}
			case 'save': {
				if (!draft.id.trim()) {
					void vscode.window.showWarningMessage('Model ID is required.');
					continue;
				}
				if (!draft.name.trim()) {
					void vscode.window.showWarningMessage('Model display name is required.');
					continue;
				}
				if (provider.models.some(item => item.id === draft.id)) {
					void vscode.window.showWarningMessage(`Model "${draft.id}" is already configured for this provider.`);
					continue;
				}
				await store.saveProvider({
					...provider,
					models: [...provider.models, draft],
					updatedAt: Date.now(),
				});
				await persistAndRefresh(store, config, tree);
				return;
			}
		}
	}
}

export async function editModel(
	store: ProviderStore,
	config: CopilotConfigService,
	tree: ModelsTreeProvider,
	node?: ModelTarget,
): Promise<void> {
	const resolved = await resolveModel(store, node);
	if (!resolved) {
		return;
	}
	let { provider, model } = resolved;

	while (true) {

		const action = await showManagedQuickPick([
			{ label: '$(symbol-key) id', description: model.id, value: 'id' },
			{ label: '$(edit) name', description: model.name, value: 'name' },
			{ label: '$(link) url', description: model.url ?? 'Generated from provider base URL', value: 'url' },
			{ label: '$(symbol-enum) apiType', description: model.apiType ?? `Inherit: ${provider.apiType}`, value: 'apiType' },
			{ label: '$(tools) toolCalling', description: String(model.toolCalling), value: 'toolCalling' },
			{ label: '$(eye) vision', description: String(model.vision), value: 'vision' },
			{ label: '$(lightbulb) thinking', description: optionalBooleanLabel(model.thinking), value: 'thinking' },
			{ label: '$(lightbulb-autofix) adaptiveThinking', description: optionalBooleanLabel(model.adaptiveThinking), value: 'adaptiveThinking' },
			{ label: '$(symbol-number) minThinkingBudget', description: optionalNumberLabel(model.minThinkingBudget), value: 'minThinkingBudget' },
			{ label: '$(symbol-number) maxThinkingBudget', description: optionalNumberLabel(model.maxThinkingBudget), value: 'maxThinkingBudget' },
			{ label: '$(pulse) streaming', description: optionalBooleanLabel(model.streaming), value: 'streaming' },
			{ label: '$(wrench) editTools', description: model.editTools?.join(', ') || 'Unset', value: 'editTools' },
			{ label: '$(symbol-number) contextWindow', description: optionalNumberLabel(model.contextWindow), value: 'contextWindow' },
			{ label: '$(symbol-number) maxInputTokens', description: optionalNumberLabel(model.maxInputTokens), value: 'maxInputTokens' },
			{ label: '$(symbol-number) maxOutputTokens', description: optionalNumberLabel(model.maxOutputTokens), value: 'maxOutputTokens' },
			{ label: '$(shield) zeroDataRetentionEnabled', description: optionalBooleanLabel(model.zeroDataRetentionEnabled), value: 'zeroDataRetentionEnabled' },
			{ label: '$(list-unordered) supportsReasoningEffort', description: model.supportsReasoningEffort?.join(', ') || 'Unset', value: 'supportsReasoningEffort' },
			{ label: '$(symbol-enum) reasoningEffortFormat', description: model.reasoningEffortFormat ?? 'Unset', value: 'reasoningEffortFormat' },
			{ label: '$(settings-gear) modelOptions', description: model.modelOptions ? JSON.stringify(model.modelOptions) : 'Unset', value: 'modelOptions' },
			{ label: '$(json) requestHeaders', description: model.requestHeaders ? JSON.stringify(model.requestHeaders) : 'Unset', value: 'requestHeaders' },
		], {
			title: `Edit ${model.name}`,
			placeHolder: 'Choose one model property to edit',
			ignoreFocusOut: true,
			matchOnDescription: true,
		}, () => undefined);
		if (!action) {
			return;
		}

		let next = { ...model };

		switch (action.value) {
			case 'id': {
				const value = await vscode.window.showInputBox({
					title: 'Model ID',
					prompt: 'Identifier sent to the provider API.',
					value: model.id,
					ignoreFocusOut: true,
					validateInput: value => {
						const id = value.trim();
						if (!id) {
							return 'Model ID is required.';
						}
						if (provider.models.some(item => item.id === id && item.id !== model.id)) {
							return `Model ID "${id}" already exists in this provider.`;
						}
						return undefined;
					},
				});
				if (value === undefined) {
					continue;
				}
				next.id = value.trim();
				next.source = 'manual';
				break;
			}
			case 'name': {
				const value = await vscode.window.showInputBox({
					title: 'Model Display Name',
					value: model.name,
					ignoreFocusOut: true,
					validateInput: value => value.trim() ? undefined : 'Display name is required.',
				});
				if (value === undefined) {
					continue;
				}
				next.name = value.trim();
				break;
			}
			case 'url': {
				const value = await vscode.window.showInputBox({
					title: 'Model URL Override',
					prompt: 'Leave empty to generate the model URL from the provider base URL.',
					value: model.url ?? '',
					ignoreFocusOut: true,
					validateInput: value => !value.trim() ? undefined : validateHttpUrl(value),
				});
				if (value === undefined) {
					continue;
				}
				next.url = value.trim() || undefined;
				break;
			}
			case 'apiType': {
				const value = await pickOptionalApiType('Model API Type', provider.apiType, model.apiType);
				if (value.cancelled) {
					continue;
				}
				next = setModelApiType(next, provider.apiType, value.value);
				break;
			}
			case 'toolCalling': {
				const value = await pickRequiredBoolean('Tool Calling', model.toolCalling);
				if (value === undefined) {
					continue;
				}
				next.toolCalling = value;
				break;
			}
			case 'vision': {
				const value = await pickRequiredBoolean('Vision', model.vision);
				if (value === undefined) {
					continue;
				}
				next.vision = value;
				break;
			}
			case 'thinking': {
				const value = await pickOptionalBoolean('thinking', next.thinking);
				if (value.cancelled) {
					continue;
				}
				next = setThinkingState(next, provider.apiType, value.value);
				break;
			}
			case 'adaptiveThinking':
			case 'streaming':
			case 'zeroDataRetentionEnabled': {
				const current = next[action.value];
				const value = await pickOptionalBoolean(action.label.replace(/^\$\([^)]*\)\s*/, ''), current);
				if (value.cancelled) {
					continue;
				}
				next = { ...next, [action.value]: value.value };
				break;
			}
			case 'minThinkingBudget':
			case 'maxThinkingBudget':
			case 'contextWindow':
			case 'maxInputTokens':
			case 'maxOutputTokens': {
				const current = next[action.value];
				const value = await askOptionalPositiveInteger(action.label.replace(/^\$\([^)]*\)\s*/, ''), current);
				next = { ...next, [action.value]: value };
				break;
			}
			case 'editTools': {
				const value = await pickEditTools(model.editTools);
				if (value === null) {
					continue;
				}
				next.editTools = value.length ? value : undefined;
				break;
			}
			case 'supportsReasoningEffort': {
				const value = await pickReasoningEfforts(next.apiType ?? provider.apiType, next.supportsReasoningEffort);
				if (value === null) {
					continue;
				}
				next.supportsReasoningEffort = value.length ? value : undefined;
				break;
			}
			case 'reasoningEffortFormat': {
				const value = await pickOptionalApiType('Reasoning Effort Format', provider.apiType, model.reasoningEffortFormat);
				if (value.cancelled) {
					continue;
				}
				next.reasoningEffortFormat = value.value;
				break;
			}
			case 'modelOptions': {
				const value = await editJsonObject(
					'Model Options',
					'JSON object sent with each model request. Empty removes the property.',
					model.modelOptions,
					validateObjectJson,
				);
				if (value.cancelled) {
					continue;
				}
				next.modelOptions = value.value;
				break;
			}
			case 'requestHeaders': {
				const value = await editRequestHeaders('Request Headers', model.requestHeaders);
				if (value.cancelled) {
					continue;
				}
				next.requestHeaders = value.value;
				break;
			}
		}
	
		const models = provider.models.map(item => item.id === model.id ? next : item);
		provider = { ...provider, models, updatedAt: Date.now() };
		model = next;
		await store.saveProvider(provider);
		await persistAndRefresh(store, config, tree);
	}
}

export async function copyModelId(
	store: ProviderStore,
	node?: ModelTarget,
): Promise<void> {
	const resolved = await resolveModel(store, node);
	if (!resolved) {
		return;
	}
	await vscode.env.clipboard.writeText(resolved.model.id);
	void vscode.window.showInformationMessage(`Model ID copied: ${resolved.model.id}`);
}

export async function setModelThinking(
	store: ProviderStore,
	config: CopilotConfigService,
	tree: ModelsTreeProvider,
	node: ModelTarget | undefined,
	enabled: boolean,
): Promise<void> {
	const resolved = await resolveModel(store, node);
	if (!resolved) {
		return;
	}
	const { provider, model } = resolved;
	const next = setThinkingState(model, provider.apiType, enabled ? true : undefined);
	if (!enabled) {
		delete next.thinking;
	}

	const models = provider.models.map(item => item.id === model.id ? next : item);
	await store.saveProvider({ ...provider, models, updatedAt: Date.now() });
	await persistAndRefresh(store, config, tree);
}

export async function removeModel(
	store: ProviderStore,
	config: CopilotConfigService,
	tree: ModelsTreeProvider,
	node?: ModelTarget,
): Promise<void> {
	const resolved = await resolveModel(store, node);
	if (!resolved) {
		return;
	}
	const { provider, model } = resolved;
	const answer = await vscode.window.showWarningMessage(
		`Delete "${model.name}" from ${provider.name}?`,
		{ modal: true },
		'Delete',
	);
	if (answer !== 'Delete') {
		return;
	}
	await store.saveProvider({
		...provider,
		models: provider.models.filter(item => item.id !== model.id),
		updatedAt: Date.now(),
	});
	await persistAndRefresh(store, config, tree);
}

