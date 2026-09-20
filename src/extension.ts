import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { CopilotConfigService } from './copilotConfig';
import { discoverModels, normalizeBaseUrl } from './providerClient';
import { ProviderStore } from './providerStore';
import { ModelsTreeProvider, ProviderNode } from './modelsTree';
import { ModelsWebviewProvider } from './modelsWebview';
import { ApiType, DiscoveredModel, ManagedModel, ManagedProvider } from './types';

interface ModelReference {
	providerId: string;
	modelId: string;
}

const API_TYPES: Array<{ label: string; description: string; value: ApiType }> = [
	{ label: 'Chat Completions', description: 'OpenAI-compatible /v1/chat/completions', value: 'chat-completions' },
	{ label: 'Responses', description: 'OpenAI-compatible /v1/responses', value: 'responses' },
	{ label: 'Messages', description: 'Anthropic-compatible /v1/messages', value: 'messages' },
];

export function activate(context: vscode.ExtensionContext): void {
	const store = new ProviderStore(context);
	const config = new CopilotConfigService(context, store);
	const tree = new ModelsTreeProvider(store);
	const modelsView = new ModelsWebviewProvider(store, config);

	context.subscriptions.push(
		store,
		modelsView,
		vscode.window.registerTreeDataProvider('copilotModelsManager.providers', tree),
		store.onDidChange(() => tree.refresh()),
		vscode.window.registerWebviewViewProvider('copilotModelsManager.models', modelsView),
		register('copilotModelsManager.addProvider', () => addProvider(store, config, tree)),
		register('copilotModelsManager.editProvider', (node?: ProviderNode) => editProvider(store, config, tree, node)),
		register('copilotModelsManager.refreshProvider', (node?: ProviderNode) => refreshProvider(store, config, tree, node)),
		register('copilotModelsManager.refreshAll', () => refreshAll(store, config, tree)),
		register('copilotModelsManager.deleteProvider', (node?: ProviderNode) => deleteProvider(store, config, tree, node)),
		register('copilotModelsManager.addManualModel', (node?: ProviderNode) => addManualModel(store, config, tree, node)),
		register('copilotModelsManager.editModel', (node?: ModelReference) => editModel(store, config, tree, node)),
		register('copilotModelsManager.removeModel', (node?: ModelReference) => removeModel(store, config, tree, node)),
		register('copilotModelsManager.sync', () => syncToCopilot(store, config)),
		register('copilotModelsManager.openConfig', () => config.openConfig()),
	);
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
	const name = await vscode.window.showInputBox({
		title: 'Add Copilot Model Provider',
		prompt: 'Provider name shown in the Copilot model picker',
		placeHolder: 'My Gateway',
		validateInput: value => value.trim() ? undefined : 'Provider name is required.',
	});
	if (!name) {
		return;
	}

	if (store.getProviders().some(provider => provider.name.toLowerCase() === name.trim().toLowerCase()) ||
		await config.hasProviderGroupName(name.trim())) {
		throw new Error(`A language-model provider named "${name.trim()}" already exists.`);
	}

	const apiType = await pickApiType();
	if (!apiType) {
		return;
	}

	const baseUrl = await vscode.window.showInputBox({
		title: 'Provider Base URL',
		prompt: 'Enter this once. Model request URLs are generated automatically.',
		placeHolder: 'https://api.example.com/v1',
		validateInput: validateHttpUrl,
	});
	if (!baseUrl) {
		return;
	}

	const apiKey = await vscode.window.showInputBox({
		title: 'Provider API Key',
		prompt: 'Leave empty for endpoints that do not require authentication.',
		password: true,
		ignoreFocusOut: true,
	});
	if (apiKey === undefined) {
		return;
	}

	const now = Date.now();
	let provider: ManagedProvider = {
		id: randomUUID(),
		name: name.trim(),
		apiType,
		baseUrl: normalizeBaseUrl(baseUrl),
		models: [],
		createdAt: now,
		updatedAt: now,
	};

	if (apiKey) {
		await store.setApiKey(provider.id, apiKey);
	}

	try {
		const discovered = await withDiscovery(provider, apiKey || undefined);
		provider = {
			...provider,
			models: discovered.map(model => mergeDiscoveredModel(model, undefined, false)),
			updatedAt: Date.now(),
		};
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		const action = await vscode.window.showWarningMessage(
			`Could not fetch the provider model list. ${detail}`,
			'Save Provider Anyway',
			'Cancel',
		);
		if (action !== 'Save Provider Anyway') {
			if (apiKey) {
				await store.deleteProvider(provider.id);
			}
			return;
		}
	}

	await store.saveProvider(provider);
	await syncAndRefresh(store, config, tree);
}

async function editProvider(
	store: ProviderStore,
	config: CopilotConfigService,
	tree: ModelsTreeProvider,
	node?: ProviderNode,
): Promise<void> {
	const provider = await resolveProvider(store, node);
	if (!provider) {
		return;
	}

	const action = await vscode.window.showQuickPick([
		{ label: '$(edit) Rename Provider', value: 'rename' },
		{ label: '$(link) Change Base URL', value: 'url' },
		{ label: '$(symbol-enum) Change API Type', value: 'type' },
		{ label: '$(key) Update API Key', value: 'key' },
		{ label: '$(list-unordered) Set Model List Endpoint', value: 'modelsPath' },
		{ label: '$(json) Set Shared Request Headers', value: 'headers' },
	], { title: `Edit ${provider.name}` });
	if (!action) {
		return;
	}

	let next = { ...provider };
	switch (action.value) {
		case 'rename': {
			const value = await vscode.window.showInputBox({ title: 'Provider Name', value: provider.name });
			if (!value?.trim()) {
				return;
			}
			const collision = store.getProviders().some(item =>
				item.id !== provider.id && item.name.toLowerCase() === value.trim().toLowerCase(),
			);
			if (collision) {
				throw new Error(`Another managed provider is already named "${value.trim()}".`);
			}
			next.name = value.trim();
			break;
		}
		case 'url': {
			const value = await vscode.window.showInputBox({
				title: 'Provider Base URL',
				value: provider.baseUrl,
				validateInput: validateHttpUrl,
			});
			if (!value) {
				return;
			}
			next.baseUrl = normalizeBaseUrl(value);
			break;
		}
		case 'type': {
			const value = await pickApiType(provider.apiType);
			if (!value) {
				return;
			}
			next.apiType = value;
			break;
		}
		case 'key': {
			const value = await vscode.window.showInputBox({
				title: 'Provider API Key',
				prompt: 'Leave empty to remove authentication.',
				password: true,
				ignoreFocusOut: true,
			});
			if (value === undefined) {
				return;
			}
			if (value) {
				await store.setApiKey(provider.id, value);
			} else {
				await store.deleteApiKey(provider.id);
			}
			break;
		}
		case 'modelsPath': {
			const value = await vscode.window.showInputBox({
				title: 'Model List Endpoint',
				prompt: 'Optional. Absolute URL or a path relative to the base URL. Empty uses automatic /v1/models resolution.',
				value: provider.modelsPath ?? '',
				placeHolder: '/v1/models',
			});
			if (value === undefined) {
				return;
			}
			next.modelsPath = value.trim() || undefined;
			break;
		}
		case 'headers': {
			const value = await vscode.window.showInputBox({
				title: 'Shared Request Headers',
				prompt: 'JSON object. Use ${apiKey} where the stored provider key should be inserted.',
				value: provider.requestHeaders ? JSON.stringify(provider.requestHeaders) : '',
				placeHolder: '{"Authorization":"Bearer ${apiKey}"}',
				validateInput: validateHeadersJson,
			});
			if (value === undefined) {
				return;
			}
			next.requestHeaders = value.trim() ? JSON.parse(value) as Record<string, string> : undefined;
			break;
		}
	}

	next.updatedAt = Date.now();
	await store.saveProvider(next);
	await syncAndRefresh(store, config, tree);
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
	const models = mergeDiscoveredModels(discovered, provider.models);
	await store.saveProvider({ ...provider, models, updatedAt: Date.now() });
	await syncAndRefresh(store, config, tree);
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

	await syncAndRefresh(store, config, tree);
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
	await syncAndRefresh(store, config, tree);
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
	const id = await vscode.window.showInputBox({
		title: `Add Model to ${provider.name}`,
		prompt: 'Model ID sent to the provider API',
		validateInput: value => value.trim() ? undefined : 'Model ID is required.',
	});
	if (!id) {
		return;
	}
	if (provider.models.some(model => model.id === id.trim())) {
		throw new Error(`Model "${id.trim()}" is already configured for this provider.`);
	}
	const name = await vscode.window.showInputBox({
		title: 'Model Display Name',
		value: id.trim(),
	});
	if (!name) {
		return;
	}

	const model: ManagedModel = {
		id: id.trim(),
		name: name.trim(),
		enabled: true,
		source: 'manual',
		toolCalling: true,
		vision: false,
	};
	await store.saveProvider({ ...provider, models: [...provider.models, model], updatedAt: Date.now() });
	await syncAndRefresh(store, config, tree);
}

async function editModel(
	store: ProviderStore,
	config: CopilotConfigService,
	tree: ModelsTreeProvider,
	node?: ModelReference,
): Promise<void> {
	const resolved = await resolveModel(store, node);
	if (!resolved) {
		return;
	}
	const { provider, model } = resolved;
	const action = await vscode.window.showQuickPick([
		{ label: '$(edit) Rename Display Name', value: 'name' },
		{ label: model.toolCalling ? '$(check) Disable Tool Calling' : '$(tools) Enable Tool Calling', value: 'tools' },
		{ label: model.vision ? '$(check) Disable Vision' : '$(eye) Enable Vision', value: 'vision' },
		{ label: model.thinking ? '$(check) Disable Thinking' : '$(lightbulb) Enable Thinking', value: 'thinking' },
		{ label: '$(symbol-number) Set Context Window', value: 'context' },
		{ label: '$(symbol-number) Set Max Input Tokens', value: 'input' },
		{ label: '$(symbol-number) Set Max Output Tokens', value: 'output' },
		{ label: '$(settings-gear) Set Model Options', value: 'options' },
	], { title: `Edit ${model.name}` });
	if (!action) {
		return;
	}

	let next = { ...model };
	switch (action.value) {
		case 'name': {
			const value = await vscode.window.showInputBox({ title: 'Model Display Name', value: model.name });
			if (!value?.trim()) {
				return;
			}
			next.name = value.trim();
			break;
		}
		case 'tools':
			next.toolCalling = !model.toolCalling;
			break;
		case 'vision':
			next.vision = !model.vision;
			break;
		case 'thinking':
			next.thinking = !model.thinking;
			break;
		case 'context':
			next.contextWindow = await askOptionalPositiveInteger('Context Window', model.contextWindow);
			break;
		case 'input':
			next.maxInputTokens = await askOptionalPositiveInteger('Max Input Tokens', model.maxInputTokens);
			break;
		case 'output':
			next.maxOutputTokens = await askOptionalPositiveInteger('Max Output Tokens', model.maxOutputTokens);
			break;
		case 'options': {
			const value = await vscode.window.showInputBox({
				title: 'Model Options',
				prompt: 'JSON object sent with each model request. Empty removes overrides.',
				value: model.modelOptions ? JSON.stringify(model.modelOptions) : '',
				validateInput: validateObjectJson,
			});
			if (value === undefined) {
				return;
			}
			next.modelOptions = value.trim() ? JSON.parse(value) as Record<string, unknown> : undefined;
			break;
		}
	}

	const models = provider.models.map(item => item.id === model.id ? next : item);
	await store.saveProvider({ ...provider, models, updatedAt: Date.now() });
	await syncAndRefresh(store, config, tree);
}

async function removeModel(
	store: ProviderStore,
	config: CopilotConfigService,
	tree: ModelsTreeProvider,
	node?: ModelReference,
): Promise<void> {
	const resolved = await resolveModel(store, node);
	if (!resolved) {
		return;
	}
	const { provider, model } = resolved;
	const answer = await vscode.window.showWarningMessage(
		`Remove "${model.name}" from ${provider.name}?`,
		{ modal: true },
		'Remove',
	);
	if (answer !== 'Remove') {
		return;
	}
	await store.saveProvider({
		...provider,
		models: provider.models.filter(item => item.id !== model.id),
		updatedAt: Date.now(),
	});
	await syncAndRefresh(store, config, tree);
}

async function syncToCopilot(store: ProviderStore, config: CopilotConfigService): Promise<void> {
	const configPath = await config.sync(store.getProviders());
	void vscode.window.showInformationMessage(`Copilot models synced to ${configPath}`);
}

async function syncAndRefresh(
	store: ProviderStore,
	config: CopilotConfigService,
	tree: ModelsTreeProvider,
): Promise<void> {
	await config.sync(store.getProviders());
	tree.refresh();
}

async function withDiscovery(provider: ManagedProvider, apiKey: string | undefined): Promise<DiscoveredModel[]> {
	return vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: `Fetching models from ${provider.name}`,
		cancellable: false,
	}, () => discoverModels(provider, apiKey));
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
		toolCalling: existing?.toolCalling ?? discovered.toolCalling ?? true,
		vision: existing?.vision ?? discovered.vision ?? false,
		thinking: existing?.thinking ?? discovered.thinking,
		contextWindow: existing?.contextWindow ?? discovered.contextWindow,
		maxInputTokens: existing?.maxInputTokens ?? discovered.maxInputTokens,
		maxOutputTokens: existing?.maxOutputTokens ?? discovered.maxOutputTokens,
		supportsReasoningEffort: existing?.supportsReasoningEffort ?? discovered.supportsReasoningEffort,
		reasoningEffortFormat: existing?.reasoningEffortFormat,
		modelOptions: existing?.modelOptions,
		requestHeaders: existing?.requestHeaders,
	};
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
	const picked = await vscode.window.showQuickPick(
		providers.map(provider => ({ label: provider.name, description: provider.baseUrl, provider })),
		{ title: 'Select Provider' },
	);
	return picked?.provider;
}

async function resolveModel(
	store: ProviderStore,
	node?: ModelReference,
): Promise<{ provider: ManagedProvider; model: ManagedModel } | undefined> {
	if (node?.providerId && node.modelId) {
		const provider = store.getProvider(node.providerId);
		const model = provider?.models.find(item => item.id === node.modelId);
		return provider && model ? { provider, model } : undefined;
	}
	const provider = await resolveProvider(store);
	if (!provider) {
		return undefined;
	}
	const picked = await vscode.window.showQuickPick(
		provider.models.map(model => ({ label: model.name, description: model.id, model })),
		{ title: 'Select Model' },
	);
	return picked ? { provider, model: picked.model } : undefined;
}

async function pickApiType(current?: ApiType): Promise<ApiType | undefined> {
	const picked = await vscode.window.showQuickPick(
		API_TYPES.map(item => ({ ...item, picked: item.value === current })),
		{ title: 'API Type', placeHolder: 'Choose the protocol Copilot should use' },
	);
	return picked?.value;
}

function validateHttpUrl(value: string): string | undefined {
	try {
		const url = new URL(value.trim());
		return ['http:', 'https:'].includes(url.protocol) ? undefined : 'Only http:// and https:// URLs are supported.';
	} catch {
		return 'Enter a valid HTTP(S) URL.';
	}
}

function validateHeadersJson(value: string): string | undefined {
	if (!value.trim()) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
			return 'Headers must be a JSON object.';
		}
		if (Object.values(parsed as Record<string, unknown>).some(item => typeof item !== 'string')) {
			return 'Every header value must be a string.';
		}
		return undefined;
	} catch {
		return 'Enter a valid JSON object.';
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