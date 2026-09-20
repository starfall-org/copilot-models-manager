import * as vscode from 'vscode';
import { ManagedProvider } from './types';

const PROVIDERS_KEY = 'copilotModelsManager.providers.v1';
const SECRET_PREFIX = 'copilotModelsManager.providerApiKey.';

export class ProviderStore {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changeEmitter.event;

	constructor(private readonly context: vscode.ExtensionContext) {}

	getProviders(): ManagedProvider[] {
		return this.context.globalState.get<ManagedProvider[]>(PROVIDERS_KEY, []);
	}

	getProvider(id: string): ManagedProvider | undefined {
		return this.getProviders().find(provider => provider.id === id);
	}

	async saveProvider(provider: ManagedProvider): Promise<void> {
		const providers = this.getProviders();
		const index = providers.findIndex(item => item.id === provider.id);
		if (index >= 0) {
			providers[index] = provider;
		} else {
			providers.push(provider);
		}
		await this.context.globalState.update(PROVIDERS_KEY, providers);
		this.changeEmitter.fire();
	}

	async deleteProvider(id: string): Promise<void> {
		await this.context.globalState.update(
			PROVIDERS_KEY,
			this.getProviders().filter(provider => provider.id !== id),
		);
		await this.deleteApiKey(id);
		this.changeEmitter.fire();
	}

	async setApiKey(providerId: string, apiKey: string): Promise<void> {
		await this.context.secrets.store(this.secretKey(providerId), apiKey);
	}

	getApiKey(providerId: string): Thenable<string | undefined> {
		return this.context.secrets.get(this.secretKey(providerId));
	}

	async deleteApiKey(providerId: string): Promise<void> {
		await this.context.secrets.delete(this.secretKey(providerId));
	}

	dispose(): void {
		this.changeEmitter.dispose();
	}

	private secretKey(providerId: string): string {
		return `${SECRET_PREFIX}${providerId}`;
	}
}
