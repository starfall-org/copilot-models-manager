import * as vscode from 'vscode';
import { CopilotConfigService } from './copilotConfig';
import { ModelNode, ModelsTreeProvider, ProviderNode } from './modelsTree';
import { ProviderStore } from './providerStore';
import { ManagedModel, ManagedProvider } from './types';
import { showManagedQuickPick } from './quickInput';

export interface ModelReference {
	providerId: string;
	modelId: string;
}
export type ModelTarget = ModelReference | ModelNode;

export async function persistAndRefresh(
	store: ProviderStore,
	config: CopilotConfigService,
	tree: ModelsTreeProvider,
): Promise<void> {
	await config.saveProviders(store.getProviders());
	tree.refresh();
}

export async function resolveProvider(store: ProviderStore, node?: ProviderNode): Promise<ManagedProvider | undefined> {
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

export async function resolveModel(
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

