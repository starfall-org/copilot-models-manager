import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parse, ParseError, printParseErrorCode } from 'jsonc-parser';
import { buildModelRequestUrl } from './providerClient';
import { ProviderStore } from './providerStore';
import { CopilotProviderGroup, ManagedProvider } from './types';

const LAST_SYNCED_GROUPS_KEY = 'copilotModelsManager.lastSyncedGroups.v1';

export class CopilotConfigService {
	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly store: ProviderStore,
	) {}

	getConfigPath(): string {
		const configured = vscode.workspace
			.getConfiguration('copilotModelsManager')
			.get<string>('chatLanguageModelsPath', '')
			.trim();

		if (configured) {
			return this.expandHome(configured);
		}

		if (vscode.env.appHost !== 'desktop') {
			throw new Error('Copilot Models Manager currently requires desktop VS Code to update chatLanguageModels.json.');
		}

		const portableRoot = process.env.VSCODE_PORTABLE;
		if (vscode.env.isAppPortable && portableRoot) {
			return path.join(portableRoot, 'user-data', 'User', 'chatLanguageModels.json');
		}

		const productFolder = this.productDataFolder();
		let userRoot: string;
		if (process.platform === 'win32') {
			const appData = process.env.APPDATA;
			if (!appData) {
				throw new Error('APPDATA is unavailable, so the VS Code user-data directory cannot be resolved.');
			}
			userRoot = path.join(appData, productFolder, 'User');
		} else if (process.platform === 'darwin') {
			userRoot = path.join(os.homedir(), 'Library', 'Application Support', productFolder, 'User');
		} else {
			const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
			userRoot = path.join(configHome, productFolder, 'User');
		}

		return path.join(userRoot, 'chatLanguageModels.json');
	}

	async readGroups(): Promise<CopilotProviderGroup[]> {
		const configPath = this.getConfigPath();
		try {
			const text = await fs.readFile(configPath, 'utf8');
			const errors: ParseError[] = [];
			const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false }) as unknown;
			if (errors.length) {
				const error = errors[0];
				throw new Error(`Cannot parse ${configPath}: ${printParseErrorCode(error.error)} at offset ${error.offset}.`);
			}
			if (value === undefined || value === null) {
				return [];
			}
			if (!Array.isArray(value)) {
				throw new Error(`${configPath} must contain a JSON array.`);
			}
			return value as CopilotProviderGroup[];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return [];
			}
			throw error;
		}
	}

	async sync(providers: ManagedProvider[]): Promise<string> {
		const configPath = this.getConfigPath();
		const existing = await this.readGroups();
		const previous = this.context.globalState.get<CopilotProviderGroup[]>(LAST_SYNCED_GROUPS_KEY, []);
		const managedNames = new Set([
			...previous.map(group => group.name).filter((name): name is string => Boolean(name)),
			...providers.map(provider => provider.name),
		]);

		const retained = existing.filter(group => {
			if (group.vendor !== 'customendpoint' || !group.name || !managedNames.has(group.name)) {
				return true;
			}
			const wasPreviouslyManaged = previous.some(oldGroup => oldGroup.name === group.name);
			const isCurrentlyManaged = providers.some(provider => provider.name === group.name);
			return !(wasPreviouslyManaged || isCurrentlyManaged);
		});

		const generated: CopilotProviderGroup[] = [];
		for (const provider of providers) {
			const group = await this.toCopilotGroup(provider);
			if (group.models?.length) {
				generated.push(group);
			}
		}

		const next = [...retained, ...generated];
		await fs.mkdir(path.dirname(configPath), { recursive: true });
		const temporary = `${configPath}.copilot-models-manager.tmp`;
		await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
		await fs.rename(temporary, configPath);
		await this.context.globalState.update(LAST_SYNCED_GROUPS_KEY, generated);
		return configPath;
	}

	async hasProviderGroupName(name: string): Promise<boolean> {
		const groups = await this.readGroups();
		return groups.some(group => group.name?.toLocaleLowerCase() === name.toLocaleLowerCase());
	}

	async openConfig(): Promise<void> {
		const configPath = this.getConfigPath();
		await fs.mkdir(path.dirname(configPath), { recursive: true });
		try {
			await fs.access(configPath);
		} catch {
			await fs.writeFile(configPath, '[]\n', 'utf8');
		}
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
		await vscode.window.showTextDocument(document);
	}

	private async toCopilotGroup(provider: ManagedProvider): Promise<CopilotProviderGroup> {
		const apiKey = await this.store.getApiKey(provider.id);
		const exposeApiKey = vscode.workspace
			.getConfiguration('copilotModelsManager')
			.get<boolean>('writeApiKeyToCopilotConfig', true);

		return {
			name: provider.name,
			vendor: 'customendpoint',
			...(apiKey
				? { apiKey: exposeApiKey ? apiKey : '${input:copilotModelsManager.' + provider.id + '}' }
				: {}),
			apiType: provider.apiType,
			models: provider.models.filter(model => model.enabled !== false).map(model => ({
				id: model.id,
				name: model.name,
				url: buildModelRequestUrl(provider.baseUrl, provider.apiType),
				toolCalling: model.toolCalling,
				vision: model.vision,
				...(model.thinking !== undefined ? { thinking: model.thinking } : {}),
				...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
				...(model.maxInputTokens ? { maxInputTokens: model.maxInputTokens } : {}),
				...(model.maxOutputTokens ? { maxOutputTokens: model.maxOutputTokens } : {}),
				...(model.supportsReasoningEffort?.length ? { supportsReasoningEffort: model.supportsReasoningEffort } : {}),
				...(model.reasoningEffortFormat ? { reasoningEffortFormat: model.reasoningEffortFormat } : {}),
				...(model.modelOptions ? { modelOptions: model.modelOptions } : {}),
				...((provider.requestHeaders || model.requestHeaders)
					? { requestHeaders: { ...provider.requestHeaders, ...model.requestHeaders } }
					: {}),
			})),
		};
	}

	private productDataFolder(): string {
		const appName = vscode.env.appName.toLowerCase();
		const scheme = vscode.env.uriScheme.toLowerCase();
		if (scheme.includes('insiders') || appName.includes('insiders')) {
			return 'Code - Insiders';
		}
		if (scheme.includes('vscodium') || appName.includes('vscodium')) {
			return 'VSCodium';
		}
		if (scheme.includes('code-oss') || appName.includes('code - oss')) {
			return 'Code - OSS';
		}
		return 'Code';
	}

	private expandHome(value: string): string {
		if (value === '~') {
			return os.homedir();
		}
		if (value.startsWith('~/') || value.startsWith('~\\')) {
			return path.join(os.homedir(), value.slice(2));
		}
		return path.resolve(value);
	}
}