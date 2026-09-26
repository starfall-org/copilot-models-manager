import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { CopilotConfigService } from './copilotConfig';
import { discoverModels, normalizeBaseUrl } from './providerClient';
import { ProviderStore } from './providerStore';
import { ModelsTreeProvider, ProviderNode } from './modelsTree';
import { ManagedProvider } from './types';
import { persistAndRefresh, resolveProvider } from './commandShared';
import { withDiscovery, pickFetchedModels, mergeDiscoveredModels } from './modelDiscovery';
import { showManagedQuickPick, pickApiType, editRequestHeaders, validateHttpUrl } from './quickInput';

export async function addProvider(
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
	let discoveryApiKeyChanged = false;

	// Persists the current draft as soon as it is valid. Called after every field
	// is entered so no manual Save action is needed.
	const autoSave = async (): Promise<void> => {
		const name = draft.name.trim();
		const baseUrl = draft.baseUrl.trim();
		if (!name || !baseUrl || validateHttpUrl(baseUrl)) {
			return;
		}
		if (
			store.getProviders().some(provider => provider.id !== draft.id && provider.name.toLowerCase() === name.toLowerCase()) ||
			await config.hasProviderGroupName(name, draft.id)
		) {
			return;
		}
		draft = { ...draft, updatedAt: Date.now() };
		if (discoveryApiKeyChanged) {
			if (discoveryApiKey) {
				await store.setApiKey(draft.id, discoveryApiKey);
			} else {
				await store.deleteApiKey(draft.id);
			}
			discoveryApiKeyChanged = false;
		}
		await store.saveProvider(draft);
		await persistAndRefresh(store, config, tree);
	};

	while (true) {
		const action = await showManagedQuickPick([
			{ label: '$(edit) name', description: draft.name || 'Required', value: 'name' },
			{ label: '$(link) baseUrl', description: draft.baseUrl || 'Required', value: 'url' },
			{ label: '$(symbol-enum) apiType', description: draft.apiType, value: 'type' },
			{ label: '$(key) discoveryApiKey', description: discoveryApiKey ? 'Set' : 'Unset', value: 'key' },
			{ label: '$(list-selection) Models', description: `${draft.models.filter(model => model.enabled !== false).length} selected`, value: 'models' },
			...(draft.models.some(model => model.enabled !== false)
				? [{ label: '$(settings-gear) Open Copilot Manage…', description: `Filter: ${draft.name}`, value: 'copilotManage' }]
				: []),
			{ label: '$(list-unordered) modelsPath', description: draft.modelsPath || 'Automatic /v1/models', value: 'modelsPath' },
			{ label: '$(json) requestHeaders', description: draft.requestHeaders ? JSON.stringify(draft.requestHeaders) : 'Unset', value: 'headers' },
		], {
			title: 'Add Provider',
			placeHolder: 'Edit provider fields — each field is saved automatically as you enter it',
			ignoreFocusOut: true,
			matchOnDescription: true,
		}, () => undefined);

		if (!action) {
			// Persist any last edit before closing so the final state is saved.
			await autoSave();
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
				const name = value.trim();
				if (
					store.getProviders().some(provider => provider.id !== draft.id && provider.name.toLowerCase() === name.toLowerCase()) ||
					await config.hasProviderGroupName(name, draft.id)
				) {
					void vscode.window.showWarningMessage(`A language-model provider named "${name}" already exists.`);
					continue;
				}
				draft = { ...draft, name };
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
				discoveryApiKeyChanged = true;
				break;
			}
			case 'models': {
				if (!draft.name.trim() || !draft.baseUrl.trim() || validateHttpUrl(draft.baseUrl)) {
					void vscode.window.showWarningMessage('Set the provider name and a valid base URL before fetching models.');
					continue;
				}
				const models = await fetchProviderModels(draft, discoveryApiKey);
				if (!models) {
					continue;
				}
				draft = { ...draft, models };
				break;
			}
			case 'copilotManage': {
				if (!draft.models.some(model => model.enabled !== false)) {
					void vscode.window.showWarningMessage('Add or select at least one model before opening Copilot Manage Language Models.');
					continue;
				}
				await autoSave();
				await vscode.commands.executeCommand('workbench.action.chat.manage', draft.name);
				return;
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
		}

		// Every completed field edit is saved automatically.
		await autoSave();
	}
}

export async function editProvider(
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
			{ label: '$(list-selection) Models', description: `${provider.models.filter(model => model.enabled !== false).length} selected`, value: 'models' },
			...(provider.models.some(model => model.enabled !== false)
				? [{ label: '$(settings-gear) Manage Language Models', value: 'copilotKey' }]
				: []),
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
			case 'models': {
				const models = await fetchProviderModels(provider, await store.getApiKey(provider.id));
				if (!models) {
					continue;
				}
				next.models = models;
				break;
			}
			case 'copilotKey': {
				if (!provider.models.some(model => model.enabled !== false)) {
					void vscode.window.showWarningMessage('Add or select at least one model before opening Manage Language Models.');
					continue;
				}
				await vscode.commands.executeCommand('workbench.action.chat.manage', provider.name);
				return;
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

export async function copyProviderApiKey(
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

export async function manageCopilotApiKey(
	store: ProviderStore,
	node?: ProviderNode,
): Promise<void> {
	const provider = await resolveProvider(store, node);
	if (!provider) {
		return;
	}
	if (!provider.models.some(model => model.enabled !== false)) {
		void vscode.window.showWarningMessage('Add or select at least one model before opening Manage Language Models.');
		return;
	}
	await vscode.commands.executeCommand('workbench.action.chat.manage', provider.name);
}

export async function refreshProvider(
	store: ProviderStore,
	config: CopilotConfigService,
	tree: ModelsTreeProvider,
	node?: ProviderNode,
): Promise<void> {
	const provider = await resolveProvider(store, node);
	if (!provider) {
		return;
	}

	const models = await fetchProviderModels(provider, await store.getApiKey(provider.id));
	if (!models) {
		return;
	}

	await store.saveProvider({ ...provider, models, updatedAt: Date.now() });
	await persistAndRefresh(store, config, tree);
}

async function fetchProviderModels(
	provider: ManagedProvider,
	apiKey: string | undefined,
): Promise<ManagedProvider['models'] | undefined> {
	const discovered = await withDiscovery(provider, apiKey);
	if (!discovered.length) {
		void vscode.window.showInformationMessage(`${provider.name} returned no models.`);
		return;
	}

	const selectedIds = await pickFetchedModels(provider, discovered);
	if (!selectedIds) {
		return;
	}

	return mergeDiscoveredModels(discovered, provider.models).map(model => ({
		...model,
		enabled: selectedIds.has(model.id),
	}));
}

export async function refreshAll(
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

export async function deleteProvider(
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

