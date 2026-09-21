import * as vscode from 'vscode';
import { ManagedProvider } from './types';

const SECRET_PREFIX = 'copilotModelsManager.providerApiKey.';

export class ProviderStore implements vscode.Disposable {
	private providers: ManagedProvider[] = [];
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changeEmitter.event;

	constructor(private readonly context: vscode.ExtensionContext) {}

	getProviders(): ManagedProvider[] {
		return this.providers.map(provider => ({
			...provider,
			models: provider.models.map(model => ({ ...model })),
		}));
	}

	getProvider(id: string): ManagedProvider | undefined {
		const provider = this.providers.find(item => item.id === id);
		return provider
			? { ...provider, models: provider.models.map(model => ({ ...model })) }
			: undefined;
	}

	replaceAll(providers: ManagedProvider[]): void {
		this.providers = providers.map(provider => ({
			...provider,
			models: provider.models.map(model => ({ ...model })),
		}));
		this.changeEmitter.fire();
	}

	async saveProvider(provider: ManagedProvider): Promise<void> {
		const index = this.providers.findIndex(item => item.id === provider.id);
		const copy = { ...provider, models: provider.models.map(model => ({ ...model })) };
		if (index >= 0) {
			this.providers[index] = copy;
		} else {
			this.providers.push(copy);
		}
		this.changeEmitter.fire();
	}

	async deleteProvider(id: string): Promise<void> {
		this.providers = this.providers.filter(provider => provider.id !== id);
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
