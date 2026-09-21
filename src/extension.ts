import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CopilotConfigService } from './copilotConfig';
import { defaultContextWindow, defaultMaxOutputTokens, discoverModels, normalizeBaseUrl } from './providerClient';
import { ProviderStore } from './providerStore';
import { ModelNode, ModelsTreeProvider, ProviderNode } from './modelsTree';
import { ApiType, DiscoveredModel, EditToolName, ManagedModel, ManagedProvider } from './types';

interface ModelReference {
	providerId: string;
	modelId: string;
}

type ModelTarget = ModelReference | ModelNode;

const API_TYPES: Array<{ label: string; description: string; value: ApiType }> = [
	{ label: 'Chat Completions', description: 'OpenAI-compatible /v1/chat/completions', value: 'chat-completions' },
	{ label: 'Responses', description: 'OpenAI-compatible /v1/responses', value: 'responses' },
	{ label: 'Messages', description: 'Anthropic-compatible /v1/messages', value: 'messages' },
];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const store = new ProviderStore(context);
	const config = new CopilotConfigService(store);
	const tree = new ModelsTreeProvider(store);

	const configPath = config.getConfigPath();
	const configWatcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(vscode.Uri.file(path.dirname(configPath)), path.basename(configPath)),
	);
	let reloadTimer: NodeJS.Timeout | undefined;
	const scheduleReload = (): void => {
		if (reloadTimer) {
			clearTimeout(reloadTimer);
		}
		reloadTimer = setTimeout(() => {
			void config.loadProviders()
				.then(providers => store.replaceAll(providers))
				.catch(error => {
					const message = error instanceof Error ? error.message : String(error);
					void vscode.window.showErrorMessage(`Copilot Models Manager: ${message}`);
				});
		}, 100);
	};

	context.subscriptions.push(
		store,
		configWatcher,
		{ dispose: () => reloadTimer && clearTimeout(reloadTimer) },
		configWatcher.onDidCreate(scheduleReload),
		configWatcher.onDidChange(scheduleReload),
		configWatcher.onDidDelete(scheduleReload),
		vscode.window.registerTreeDataProvider('copilotModelsManager.providers', tree),
		store.onDidChange(() => tree.refresh()),
		register('copilotModelsManager.addProvider', () => addProvider(store, config, tree)),
		register('copilotModelsManager.openManageLanguageModels', () => vscode.commands.executeCommand('workbench.action.chat.manage')),
		register('copilotModelsManager.editProvider', (node?: ProviderNode) => editProvider(store, config, tree, node)),
		register('copilotModelsManager.manageCopilotApiKey', (node?: ProviderNode) => manageCopilotApiKey(store, node)),
		register('copilotModelsManager.copyApiKey', (node?: ProviderNode) => copyProviderApiKey(store, node)),
		register('copilotModelsManager.refreshProvider', (node?: ProviderNode) => refreshProvider(store, config, tree, node)),
		register('copilotModelsManager.refreshAll', () => refreshAll(store, config, tree)),
		register('copilotModelsManager.deleteProvider', (node?: ProviderNode) => deleteProvider(store, config, tree, node)),
		register('copilotModelsManager.addManualModel', (node?: ProviderNode) => addManualModel(store, config, tree, node)),
		register('copilotModelsManager.editModel', (node?: ModelTarget) => editModel(store, config, tree, node)),
		register('copilotModelsManager.copyModelId', (node?: ModelTarget) => copyModelId(store, node)),
		register('copilotModelsManager.setThinking', (node?: ModelTarget) => setModelThinking(store, config, tree, node, true)),
		register('copilotModelsManager.unsetThinking', (node?: ModelTarget) => setModelThinking(store, config, tree, node, false)),
		register('copilotModelsManager.removeModel', (node?: ModelTarget) => removeModel(store, config, tree, node)),
		register('copilotModelsManager.openConfig', () => config.openConfig()),
	);

	store.replaceAll(await config.loadProviders());
}

function register(command: string, callback: (...args: any[]) => unknown): vscode.Disposable {
	return vscode.commands.registerCommand(command, async (...args: any[]) => {
		try {
			await callback(...args);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Copilot Models Manager: ${message}`);
		}
	});
}

async function addProvider(
	store: ProviderStore,
	config: CopilotConfigService,
	tree: ModelsTreeProvider,
): Promise<void> {
	const now = Date.now();
	let draft: ManagedProvider = {
		id: randomUUID(),
		name: '',
		apiType: 'chat-completions',
		baseUrl: '',
		models: [],
		createdAt: now,
		updatedAt: now,
	};
	let discoveryApiKey: string | undefined;

	while (true) {
		const action = await showManagedQuickPick([
			{ label: '$(edit) name', description: draft.name || 'Required', value: 'name' },
			{ label: '$(link) baseUrl', description: draft.baseUrl || 'Required', value: 'url' },
			{ label: '$(symbol-enum) apiType', description: draft.apiType, value: 'type' },
			{ label: '$(key) discoveryApiKey', description: discoveryApiKey ? 'Set' : 'Unset', value: 'key' },
			{ label: '$(settings-gear) Open Copilot Manage…', description: draft.name ? `Filter: ${draft.name}` : 'Set provider name first', value: 'copilotManage' },
			{ label: '$(list-unordered) modelsPath', description: draft.modelsPath || 'Automatic /v1/models', value: 'modelsPath' },
			{ label: '$(json) requestHeaders', description: draft.requestHeaders ? JSON.stringify(draft.requestHeaders) : 'Unset', value: 'headers' },
			{ label: '$(save) Save Provider', description: 'Create this provider', value: 'save' },
		], {
			title: 'Add Provider',
			placeHolder: 'Edit provider fields, then choose Save Provider',
			ignoreFocusOut: true,
			matchOnDescription: true,
		}, () => ({ label: '$(save) Save Provider', description: 'Create this provider', value: 'save' }));

		if (!action) {
			return;
		}

		switch (action.value) {
			case 'name': {
				const value = await vscode.window.showInputBox({
					title: 'Provider Name',
					value: draft.name,
					ignoreFocusOut: true,
					validateInput: value => value.trim() ? undefined : 'Provider name is required.',
				});
				if (value === undefined) {
					continue;
				}
				draft = { ...draft, name: value.trim() };
				break;
			}
			case 'url': {
				const value = await vscode.window.showInputBox({
					title: 'Provider Base URL',
					value: draft.baseUrl,
					placeHolder: 'https://api.example.com/v1',
					ignoreFocusOut: true,
					validateInput: value => value.trim() ? validateHttpUrl(value) : 'Provider base URL is required.',
				});
				if (value === undefined) {
					continue;
				}
				draft = { ...draft, baseUrl: normalizeBaseUrl(value) };
				break;
			}
			case 'type': {
				const value = await pickApiType(draft.apiType);
				if (!value) {
					continue;
				}
				draft = { ...draft, apiType: value };
				break;
			}
			case 'key': {
				const value = await vscode.window.showInputBox({
					title: 'Discovery API Key',
					prompt: 'Stored only in this extension SecretStorage and used for Fetch Models.',
					password: true,
					value: discoveryApiKey ?? '',
					ignoreFocusOut: true,
				});
				if (value === undefined) {
					continue;
				}
				discoveryApiKey = value || undefined;
				break;
			}
			case 'copilotManage': {
				if (!draft.name.trim()) {
					void vscode.window.showWarningMessage('Set the provider name before opening Copilot Manage Language Models.');
					continue;
				}
				await vscode.commands.executeCommand('workbench.action.chat.manage', draft.name);
				continue;
			}
			case 'modelsPath': {
				const value = await vscode.window.showInputBox({
					title: 'Model List Endpoint',
					prompt: 'Absolute URL or path relative to the base URL. Empty uses automatic /v1/models.',
					value: draft.modelsPath ?? '',
					placeHolder: '/v1/models',
					ignoreFocusOut: true,
				});
				if (value === undefined) {
					continue;
				}
				draft = { ...draft, modelsPath: value.trim() || undefined };
				break;
			}
			case 'headers': {
				const value = await editRequestHeaders('Shared Request Headers', draft.requestHeaders);
				if (value.cancelled) {
					continue;
				}
				draft = { ...draft, requestHeaders: value.value };
				break;
			}
			case 'save': {
				if (!draft.name.trim()) {
					void vscode.window.showWarningMessage('Provider name is required.');
					continue;
				}
				if (!draft.baseUrl.trim()) {
					void vscode.window.showWarningMessage('Provider base URL is required.');
					continue;
				}
				if (validateHttpUrl(draft.baseUrl)) {
					void vscode.window.showWarningMessage('Provider base URL is invalid.');
					continue;
				}
				if (
					store.getProviders().some(provider => provider.name.toLowerCase() === draft.name.toLowerCase()) ||
					await config.hasProviderGroupName(draft.name)
				) {
					void vscode.window.showWarningMessage(`A language-model provider named "${draft.name}" already exists.`);
					continue;
				}

				draft = { ...draft, updatedAt: Date.now() };
				if (discoveryApiKey) {
					await store.setApiKey(draft.id, discoveryApiKey);
				}
				await store.saveProvider(draft);
				await persistAndRefresh(store, config, tree);
				return;
			}
		}
	}
}

async function editProvider(
	store: ProviderStore,
	config: CopilotConfigService,
	tree: ModelsTreeProvider,
	node?: ProviderNode,
): Promise<void> {
	const resolved = await resolveProvider(store, node);
	if (!resolved) {
		return;
	}
	let provider = resolved;

	while (true) {
		const action = await showManagedQuickPick([
			{ label: '$(edit) Rename Provider', value: 'rename' },
			{ label: '$(link) Change Base URL', value: 'url' },
			{ label: '$(symbol-enum) Change API Type', value: 'type' },
			{ label: '$(key) Update Discovery API Key', value: 'key' },
			{ label: '$(key) Update Copilot API Key…', value: 'copilotKey' },
			{ label: '$(list-unordered) Set Model List Endpoint', value: 'modelsPath' },
			{ label: '$(json) Set Shared Request Headers', value: 'headers' },
		], {
			title: `Edit ${provider.name}`,
			placeHolder: 'Choose one provider property to edit',
			ignoreFocusOut: true,
		}, () => undefined);
		if (!action) {
			return;
		}

		let next = { ...provider };
		let changed = true;

		switch (action.value) {
			case 'rename': {
				const value = await vscode.window.showInputBox({
					title: 'Provider Name',
					value: provider.name,
					ignoreFocusOut: true,
					validateInput: value => value.trim() ? undefined : 'Provider name is required.',
				});
				if (value === undefined) {
					continue;
				}
				const collision = store.getProviders().some(item =>
					item.id !== provider.id && item.name.toLowerCase() === value.trim().toLowerCase(),
				);
				if (collision) {
					void vscode.window.showErrorMessage(`Another managed provider is already named "${value.trim()}".`);
					continue;
				}
				next.name = value.trim();
				break;
			}
			case 'url': {
				const value = await vscode.window.showInputBox({
					title: 'Provider Base URL',
					value: provider.baseUrl,
					ignoreFocusOut: true,
					validateInput: validateHttpUrl,
				});
				if (value === undefined) {
					continue;
				}
				next.baseUrl = normalizeBaseUrl(value);
				break;
			}
			case 'type': {
				const value = await pickApiType(provider.apiType);
				if (!value) {
					continue;
				}
				next.apiType = value;
				break;
			}
			case 'key': {
				const value = await vscode.window.showInputBox({
					title: 'Discovery API Key',
					prompt: 'Used only by this extension to fetch the provider model list. Leave empty to remove it.',
					password: true,
					ignoreFocusOut: true,
				});
				if (value === undefined) {
					continue;
				}
				if (value) {
					await store.setApiKey(provider.id, value);
				} else {
					await store.deleteApiKey(provider.id);
				}
				changed = false;
				break;
			}
			case 'copilotKey': {
				await vscode.commands.executeCommand('workbench.action.chat.manage', provider.name);
				changed = false;
				continue;
			}
			case 'modelsPath': {
				const value = await vscode.window.showInputBox({
					title: 'Model List Endpoint',
					prompt: 'Optional. Absolute URL or a path relative to the base URL. Empty uses automatic /v1/models resolution.',
					value: provider.modelsPath ?? '',
					placeHolder: '/v1/models',
					ignoreFocusOut: true,
				});
				if (value === undefined) {
					continue;
				}
				next.modelsPath = value.trim() || undefined;
				break;
			}
			case 'headers': {
				const value = await editRequestHeaders('Shared Request Headers', provider.requestHeaders);
				if (value.cancelled) {
					continue;
				}
				next.requestHeaders = value.value;
				break;
			}
		}

		if (changed) {
			next.updatedAt = Date.now();
			provider = next;
			await store.saveProvider(provider);
			await persistAndRefresh(store, config, tree);
		}
	}
}

async function copyProviderApiKey(
	store: ProviderStore,
	node?: ProviderNode,
): Promise<void> {
	const provider = await resolveProvider(store, node);
	if (!provider) {
		return;
	}
	const apiKey = await store.getApiKey(provider.id);
	if (!apiKey) {
		void vscode.window.showInformationMessage(`${provider.name} has no stored API key to copy.`);
		return;
	}
	await vscode.env.clipboard.writeText(apiKey);
	void vscode.window.showInformationMessage(`API key for ${provider.name} copied to clipboard.`);
}

async function manageCopilotApiKey(
	store: ProviderStore,
	node?: ProviderNode,
): Promise<void> {
	const provider = await resolveProvider(store, node);
	if (!provider) {
		return;
	}
	await vscode.commands.executeCommand('workbench.action.chat.manage', provider.name);
}

async function refreshProvider(
	store: ProviderStore,
	config: CopilotConfigService,
	tree: ModelsTreeProvider,
	node?: ProviderNode,
): Promise<void> {
	const provider = await resolveProvider(store, node);
	if (!provider) {
		return;
	}

	const apiKey = await store.getApiKey(provider.id);
	const discovered = await withDiscovery(provider, apiKey);
	if (!discovered.length) {
		void vscode.window.showInformationMessage(`${provider.name} returned no models.`);
		return;
	}

	const selectedIds = await pickFetchedModels(provider, discovered);
	if (!selectedIds) {
		return;
	}

	const models = mergeDiscoveredModels(discovered, provider.models).map(model => ({
		...model,
		enabled: selectedIds.has(model.id),
	}));
	await store.saveProvider({ ...provider, models, updatedAt: Date.now() });
	await persistAndRefresh(store, config, tree);
}

async function refreshAll(
	store: ProviderStore,
	config: CopilotConfigService,
	tree: ModelsTreeProvider,
): Promise<void> {
	const providers = store.getProviders();
	if (!providers.length) {
		return;
	}

	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: 'Refreshing Copilot model providers',
		cancellable: false,
	}, async progress => {
		for (let index = 0; index < providers.length; index += 1) {
			const provider = providers[index];
			progress.report({ message: provider.name, increment: 100 / providers.length });
			try {
				const discovered = await discoverModels(provider, await store.getApiKey(provider.id));
				const models = mergeDiscoveredModels(discovered, provider.models);
				await store.saveProvider({ ...provider, models, updatedAt: Date.now() });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				void vscode.window.showWarningMessage(`${provider.name}: ${message}`);
			}
		}
	});

	await persistAndRefresh(store, config, tree);
}

async function deleteProvider(
	store: ProviderStore,
	config: CopilotConfigService,
	tree: ModelsTreeProvider,
	node?: ProviderNode,
): Promise<void> {
	const provider = await resolveProvider(store, node);
	if (!provider) {
		return;
	}
	const answer = await vscode.window.showWarningMessage(
		`Delete provider "${provider.name}" and remove its models from Copilot?`,
		{ modal: true },
		'Delete',
	);
	if (answer !== 'Delete') {
		return;
	}
	await store.deleteProvider(provider.id);
	await persistAndRefresh(store, config, tree);
}

async function addManualModel(
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
		maxOutputTokens: defaultMaxOutputTokens(defaultContextWindow()),
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
				draft = { ...draft, apiType: value.value };
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
			case 'thinking':
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
				const value = await vscode.window.showInputBox({
					title: 'Supported Reasoning Effort Levels',
					prompt: 'Comma-separated values. Empty removes the property.',
					value: draft.supportsReasoningEffort?.join(', ') ?? '',
					placeHolder: 'minimal, low, medium, high',
					ignoreFocusOut: true,
				});
				if (value === undefined) {
					continue;
				}
				const levels = [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
				draft = { ...draft, supportsReasoningEffort: levels.length ? levels : undefined };
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

async function editModel(
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
				next.apiType = value.value;
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
			case 'thinking':
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
				const value = await vscode.window.showInputBox({
					title: 'Supported Reasoning Effort Levels',
					prompt: 'Comma-separated values. Empty removes the property.',
					value: model.supportsReasoningEffort?.join(', ') ?? '',
					placeHolder: 'minimal, low, medium, high',
					ignoreFocusOut: true,
				});
				if (value === undefined) {
					continue;
				}
				const levels = [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
				next.supportsReasoningEffort = levels.length ? levels : undefined;
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

async function copyModelId(
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

async function setModelThinking(
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
	const next: ManagedModel = { ...model };
	if (enabled) {
		next.thinking = true;
	} else {
		delete next.thinking;
	}

	const models = provider.models.map(item => item.id === model.id ? next : item);
	await store.saveProvider({ ...provider, models, updatedAt: Date.now() });
	await persistAndRefresh(store, config, tree);
}

async function removeModel(
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

async function persistAndRefresh(
	store: ProviderStore,
	config: CopilotConfigService,
	tree: ModelsTreeProvider,
): Promise<void> {
	await config.saveProviders(store.getProviders());
	tree.refresh();
}

async function withDiscovery(provider: ManagedProvider, apiKey: string | undefined): Promise<DiscoveredModel[]> {
	return vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: `Fetching models from ${provider.name}`,
		cancellable: false,
	}, () => discoverModels(provider, apiKey));
}

interface FetchedModelQuickPickItem extends vscode.QuickPickItem {
	model: DiscoveredModel;
}

async function pickFetchedModels(
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

function mergeDiscoveredModels(discovered: DiscoveredModel[], current: ManagedModel[]): ManagedModel[] {
	if (!discovered.length) {
		return current;
	}
	const existing = new Map(current.map(model => [model.id, model]));
	const discoveredIds = new Set(discovered.map(model => model.id));
	const models = discovered.map(model => mergeDiscoveredModel(model, existing.get(model.id), false));

	for (const model of current) {
		if (model.source === 'manual' && !discoveredIds.has(model.id)) {
			models.push(model);
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

const QUICK_PICK_ACCEPT_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('check'),
	tooltip: 'Accept',
};

const QUICK_PICK_CANCEL_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('close'),
	tooltip: 'Cancel',
};

async function showManagedQuickPick<T extends vscode.QuickPickItem>(
	items: readonly T[],
	options: vscode.QuickPickOptions,
	acceptButtonResult?: () => T | undefined,
): Promise<T | undefined> {
	return new Promise(resolve => {
		const quickPick = vscode.window.createQuickPick<T>();
		quickPick.items = [...items];
		quickPick.title = options.title;
		quickPick.placeholder = options.placeHolder;
		quickPick.ignoreFocusOut = true;
		quickPick.matchOnDescription = options.matchOnDescription ?? false;
		quickPick.matchOnDetail = options.matchOnDetail ?? false;
		quickPick.buttons = [QUICK_PICK_ACCEPT_BUTTON, QUICK_PICK_CANCEL_BUTTON];

		let settled = false;
		const finish = (value: T | undefined): void => {
			if (settled) {
				return;
			}
			settled = true;
			quickPick.hide();
			resolve(value);
		};

		const disposables = [
			quickPick.onDidAccept(() => finish(quickPick.selectedItems[0] ?? quickPick.activeItems[0])),
			quickPick.onDidTriggerButton(button => {
				if (button === QUICK_PICK_ACCEPT_BUTTON) {
					finish(acceptButtonResult
						? acceptButtonResult()
						: quickPick.selectedItems[0] ?? quickPick.activeItems[0]);
				} else if (button === QUICK_PICK_CANCEL_BUTTON) {
					finish(undefined);
				}
			}),
			quickPick.onDidHide(() => {
				if (!settled) {
					settled = true;
					resolve(undefined);
				}
				for (const disposable of disposables) {
					disposable.dispose();
				}
				quickPick.dispose();
			}),
		];

		quickPick.show();
	});
}

async function showManagedMultiQuickPick<T extends vscode.QuickPickItem>(
	items: readonly T[],
	options: vscode.QuickPickOptions,
): Promise<readonly T[] | undefined> {
	return new Promise(resolve => {
		const quickPick = vscode.window.createQuickPick<T>();
		quickPick.items = [...items];
		quickPick.canSelectMany = true;
		quickPick.title = options.title;
		quickPick.placeholder = options.placeHolder;
		quickPick.ignoreFocusOut = true;
		quickPick.matchOnDescription = options.matchOnDescription ?? false;
		quickPick.matchOnDetail = options.matchOnDetail ?? false;
		quickPick.buttons = [QUICK_PICK_ACCEPT_BUTTON, QUICK_PICK_CANCEL_BUTTON];
		quickPick.selectedItems = items.filter(item => Boolean((item as T & { picked?: boolean }).picked));

		let settled = false;
		const finish = (value: readonly T[] | undefined): void => {
			if (settled) {
				return;
			}
			settled = true;
			quickPick.hide();
			resolve(value);
		};

		const disposables = [
			quickPick.onDidAccept(() => finish([...quickPick.selectedItems])),
			quickPick.onDidTriggerButton(button => {
				if (button === QUICK_PICK_ACCEPT_BUTTON) {
					finish([...quickPick.selectedItems]);
				} else if (button === QUICK_PICK_CANCEL_BUTTON) {
					finish(undefined);
				}
			}),
			quickPick.onDidHide(() => {
				if (!settled) {
					settled = true;
					resolve(undefined);
				}
				for (const disposable of disposables) {
					disposable.dispose();
				}
				quickPick.dispose();
			}),
		];

		quickPick.show();
	});
}

async function resolveProvider(store: ProviderStore, node?: ProviderNode): Promise<ManagedProvider | undefined> {
	if (node?.kind === 'provider') {
		return store.getProvider(node.provider.id);
	}
	const providers = store.getProviders();
	if (!providers.length) {
		void vscode.window.showInformationMessage('No managed model providers yet.');
		return undefined;
	}
	const picked = await showManagedQuickPick(
		providers.map(provider => ({ label: provider.name, description: provider.baseUrl, provider })),
		{ title: 'Select Provider', ignoreFocusOut: true },
	);
	return picked?.provider;
}

async function resolveModel(
	store: ProviderStore,
	node?: ModelTarget,
): Promise<{ provider: ManagedProvider; model: ManagedModel } | undefined> {
	if (node instanceof ModelNode) {
		const provider = store.getProvider(node.provider.id);
		const model = provider?.models.find(item => item.id === node.model.id);
		return provider && model ? { provider, model } : undefined;
	}
	if (node && 'providerId' in node && node.providerId && node.modelId) {
		const provider = store.getProvider(node.providerId);
		const model = provider?.models.find(item => item.id === node.modelId);
		return provider && model ? { provider, model } : undefined;
	}
	const provider = await resolveProvider(store);
	if (!provider) {
		return undefined;
	}
	const picked = await showManagedQuickPick(
		provider.models.map(model => ({ label: model.name, description: model.id, model })),
		{ title: 'Select Model', ignoreFocusOut: true },
	);
	return picked ? { provider, model: picked.model } : undefined;
}

async function pickApiType(current?: ApiType): Promise<ApiType | undefined> {
	const picked = await showManagedQuickPick(
		API_TYPES.map(item => ({ ...item, picked: item.value === current })),
		{ title: 'API Type', placeHolder: 'Choose the protocol Copilot should use', ignoreFocusOut: true },
	);
	return picked?.value;
}

function optionalBooleanLabel(value: boolean | undefined): string {
	return value === undefined ? 'Unset' : String(value);
}

function optionalNumberLabel(value: number | undefined): string {
	return value === undefined ? 'Unset' : value.toLocaleString();
}

async function pickRequiredBoolean(title: string, current: boolean): Promise<boolean | undefined> {
	const picked = await showManagedQuickPick([
		{ label: 'true', value: true, description: current === true ? 'Current' : undefined },
		{ label: 'false', value: false, description: current === false ? 'Current' : undefined },
	], {
		title,
		ignoreFocusOut: true,
	});
	return picked?.value;
}

async function pickOptionalBoolean(
	title: string,
	current: boolean | undefined,
): Promise<{ cancelled: boolean; value: boolean | undefined }> {
	const picked = await showManagedQuickPick([
		{ label: 'Unset', value: undefined, description: current === undefined ? 'Current' : 'Use VS Code default behavior' },
		{ label: 'true', value: true, description: current === true ? 'Current' : undefined },
		{ label: 'false', value: false, description: current === false ? 'Current' : undefined },
	], {
		title,
		ignoreFocusOut: true,
	});
	return picked
		? { cancelled: false, value: picked.value }
		: { cancelled: true, value: current };
}

async function pickOptionalApiType(
	title: string,
	providerType: ApiType,
	current: ApiType | undefined,
): Promise<{ cancelled: boolean; value: ApiType | undefined }> {
	const picked = await showManagedQuickPick([
		{
			label: 'Unset',
			value: undefined,
			description: current === undefined ? `Current · inherit/follow ${providerType}` : `Inherit/follow ${providerType}`,
		},
		...API_TYPES.map(item => ({
			label: item.label,
			description: current === item.value ? `Current · ${item.description}` : item.description,
			value: item.value as ApiType,
		})),
	], {
		title,
		ignoreFocusOut: true,
	});
	return picked
		? { cancelled: false, value: picked.value }
		: { cancelled: true, value: current };
}

async function pickEditTools(current?: EditToolName[]): Promise<EditToolName[] | null> {
	const options: Array<{ label: string; value: EditToolName; picked: boolean }> = [
		{ label: 'find-replace', value: 'find-replace', picked: current?.includes('find-replace') ?? false },
		{ label: 'multi-find-replace', value: 'multi-find-replace', picked: current?.includes('multi-find-replace') ?? false },
		{ label: 'apply-patch', value: 'apply-patch', picked: current?.includes('apply-patch') ?? false },
		{ label: 'code-rewrite', value: 'code-rewrite', picked: current?.includes('code-rewrite') ?? false },
	];
	const picked = await showManagedMultiQuickPick(options, {
		title: 'Edit Tools',
		placeHolder: 'Select supported edit tools. Select none to remove the property.',
		ignoreFocusOut: true,
	});
	return picked ? picked.map(item => item.value) : null;
}

const HEADER_EDIT_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('edit'),
	tooltip: 'Edit Header',
};

const HEADER_DELETE_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('trash'),
	tooltip: 'Delete Header',
};

interface HeaderQuickPickItem extends vscode.QuickPickItem {
	itemType: 'add' | 'header';
	headerKey?: string;
}

type HeaderListAction =
	| { type: 'save' }
	| { type: 'cancel' }
	| { type: 'add' }
	| { type: 'edit'; key: string }
	| { type: 'delete'; key: string };

async function editRequestHeaders(
	title: string,
	current?: Record<string, string>,
): Promise<{ cancelled: boolean; value: Record<string, string> | undefined }> {
	const headers: Record<string, string> = { ...current };

	while (true) {
		const action = await showHeadersQuickPick(title, headers);
		if (action.type === 'save') {
			return {
				cancelled: false,
				value: Object.keys(headers).length ? headers : undefined,
			};
		}
		if (action.type === 'cancel') {
			return { cancelled: true, value: current };
		}

		if (action.type === 'delete') {
			delete headers[action.key];
			continue;
		}

		if (action.type === 'add') {
			const added = await promptNewHeader(headers);
			if (added) {
				headers[added.key] = added.value;
			}
			continue;
		}

		await editSingleHeader(title, headers, action.key);
	}
}

function showHeadersQuickPick(
	title: string,
	headers: Record<string, string>,
): Promise<HeaderListAction> {
	return new Promise(resolve => {
		const quickPick = vscode.window.createQuickPick<HeaderQuickPickItem>();
		quickPick.title = title;
		quickPick.placeholder = 'Add, edit, or delete request headers';
		quickPick.ignoreFocusOut = true;
		quickPick.matchOnDescription = true;
		quickPick.buttons = [QUICK_PICK_ACCEPT_BUTTON, QUICK_PICK_CANCEL_BUTTON];
		quickPick.items = [
			{
				label: '$(add) Add Header',
				description: 'Create a new header',
				itemType: 'add',
			},
			...Object.entries(headers).map(([key, value]): HeaderQuickPickItem => ({
				label: key,
				description: value,
				itemType: 'header',
				headerKey: key,
				buttons: [HEADER_EDIT_BUTTON, HEADER_DELETE_BUTTON],
			})),
		];

		let settled = false;
		const finish = (action: HeaderListAction): void => {
			if (settled) {
				return;
			}
			settled = true;
			quickPick.hide();
			resolve(action);
		};

		const runItem = (item: HeaderQuickPickItem | undefined): void => {
			if (!item) {
				return;
			}
			if (item.itemType === 'add') {
				finish({ type: 'add' });
			} else if (item.headerKey) {
				finish({ type: 'edit', key: item.headerKey });
			}
		};

		const disposables = [
			quickPick.onDidAccept(() => runItem(quickPick.selectedItems[0] ?? quickPick.activeItems[0])),
			quickPick.onDidTriggerButton(button => {
				if (button === QUICK_PICK_ACCEPT_BUTTON) {
					finish({ type: 'save' });
				} else if (button === QUICK_PICK_CANCEL_BUTTON) {
					finish({ type: 'cancel' });
				}
			}),
			quickPick.onDidTriggerItemButton(event => {
				const key = event.item.headerKey;
				if (!key) {
					return;
				}
				if (event.button === HEADER_DELETE_BUTTON) {
					finish({ type: 'delete', key });
				} else if (event.button === HEADER_EDIT_BUTTON) {
					finish({ type: 'edit', key });
				}
			}),
			quickPick.onDidHide(() => {
				if (!settled) {
					settled = true;
					resolve({ type: 'cancel' });
				}
				for (const disposable of disposables) {
					disposable.dispose();
				}
				quickPick.dispose();
			}),
		];

		quickPick.show();
	});
}

async function promptNewHeader(
	headers: Record<string, string>,
): Promise<{ key: string; value: string } | undefined> {
	const key = await vscode.window.showInputBox({
		title: 'Add Header — Key',
		prompt: 'Enter the HTTP header name.',
		ignoreFocusOut: true,
		validateInput: value => {
			const candidate = value.trim();
			if (!candidate) {
				return 'Header key is required.';
			}
			return findHeaderKey(headers, candidate)
				? `Header "${candidate}" already exists.`
				: undefined;
		},
	});
	if (key === undefined) {
		return undefined;
	}

	const value = await vscode.window.showInputBox({
		title: 'Add Header — Value',
		prompt: 'Enter the HTTP header value. Empty is allowed.',
		value: '',
		ignoreFocusOut: true,
	});
	if (value === undefined) {
		return undefined;
	}

	return { key: key.trim(), value };
}

async function editSingleHeader(
	title: string,
	headers: Record<string, string>,
	initialKey: string,
): Promise<void> {
	let key = initialKey;

	while (Object.prototype.hasOwnProperty.call(headers, key)) {
		const action = await showManagedQuickPick([
			{ label: 'key', description: key, value: 'key' },
			{ label: 'value', description: headers[key], value: 'value' },
		], {
			title: `${title} — Edit Header`,
			placeHolder: 'Choose key or value to edit',
			ignoreFocusOut: true,
			matchOnDescription: true,
		}, () => undefined);
		if (!action) {
			return;
		}

		if (action.value === 'key') {
			const value = await vscode.window.showInputBox({
				title: 'Header Key',
				prompt: 'Leave empty to delete this header.',
				value: key,
				ignoreFocusOut: true,
				validateInput: value => {
					const candidate = value.trim();
					if (!candidate || candidate.toLocaleLowerCase() === key.toLocaleLowerCase()) {
						return undefined;
					}
					const collision = findHeaderKey(headers, candidate, key);
					return collision ? `Header "${candidate}" already exists.` : undefined;
				},
			});
			if (value === undefined) {
				continue;
			}

			const nextKey = value.trim();
			if (!nextKey) {
				delete headers[key];
				return;
			}
			if (nextKey !== key) {
				const currentValue = headers[key];
				delete headers[key];
				headers[nextKey] = currentValue;
				key = nextKey;
			}
			continue;
		}

		const value = await vscode.window.showInputBox({
			title: 'Header Value',
			prompt: 'Empty is allowed and will be sent as an empty string.',
			value: headers[key],
			ignoreFocusOut: true,
		});
		if (value === undefined) {
			continue;
		}
		headers[key] = value;
	}
}

function findHeaderKey(
	headers: Record<string, string>,
	candidate: string,
	except?: string,
): string | undefined {
	const normalized = candidate.toLocaleLowerCase();
	return Object.keys(headers).find(key =>
		key !== except && key.toLocaleLowerCase() === normalized,
	);
}

async function editJsonObject(
	title: string,
	prompt: string,
	current: Record<string, unknown> | undefined,
	validateInput: (value: string) => string | undefined,
): Promise<{ cancelled: boolean; value: Record<string, unknown> | undefined }> {
	const value = await vscode.window.showInputBox({
		title,
		prompt,
		value: current ? JSON.stringify(current) : '',
		ignoreFocusOut: true,
		validateInput,
	});
	if (value === undefined) {
		return { cancelled: true, value: current };
	}
	return {
		cancelled: false,
		value: value.trim() ? JSON.parse(value) as Record<string, unknown> : undefined,
	};
}

function validateHttpUrl(value: string): string | undefined {
	try {
		const url = new URL(value.trim());
		return ['http:', 'https:'].includes(url.protocol) ? undefined : 'Only http:// and https:// URLs are supported.';
	} catch {
		return 'Enter a valid HTTP(S) URL.';
	}
}


function validateObjectJson(value: string): string | undefined {
	if (!value.trim()) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? undefined : 'Enter a JSON object.';
	} catch {
		return 'Enter a valid JSON object.';
	}
}

async function askOptionalPositiveInteger(title: string, current?: number): Promise<number | undefined> {
	const value = await vscode.window.showInputBox({
		title,
		prompt: 'Leave empty to remove the override.',
		value: current?.toString() ?? '',
		ignoreFocusOut: true,
		validateInput: text => !text.trim() || (/^\d+$/.test(text.trim()) && Number(text) > 0)
			? undefined
			: 'Enter a positive integer or leave empty.',
	});
	if (value === undefined) {
		return current;
	}
	return value.trim() ? Number(value.trim()) : undefined;
}

async function contextSecretDelete(store: ProviderStore, providerId: string): Promise<void> {
	// ProviderStore intentionally exposes deletion through deleteProvider only; storing an
	// empty value is enough to make getApiKey() return no usable credential for discovery.
	await store.setApiKey(providerId, '');
}