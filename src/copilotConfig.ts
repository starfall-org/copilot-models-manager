import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildModelRequestUrl, defaultContextWindow, defaultMaxOutputTokens } from './providerClient';
import { ProviderStore } from './providerStore';
import {
	ApiType,
	CopilotModelEntry,
	CopilotModelsManagerMetadata,
	CopilotProviderGroup,
	ManagedModel,
	ManagedProvider,
} from './types';

const SUPPORTED_API_TYPES = new Set<ApiType>(['chat-completions', 'responses', 'messages']);

export class CopilotConfigError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'CopilotConfigError';
	}
}

export class CopilotConfigService {
	constructor(private readonly store: ProviderStore) {}

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

	async readGroups(): Promise<unknown[]> {
		const configPath = this.getConfigPath();
		try {
			const text = await fs.readFile(configPath, 'utf8');
			let value: unknown;
			try {
				value = JSON.parse(normalizeJsonc(text)) as unknown;
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				throw new CopilotConfigError(`Cannot parse ${configPath}: ${detail}`, { cause: error });
			}
			if (value === undefined || value === null) {
				return [];
			}
			if (!Array.isArray(value)) {
				throw new CopilotConfigError(`${configPath} must contain a JSON array.`);
			}
			return value;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return [];
			}
			if (error instanceof CopilotConfigError) {
				throw error;
			}
			const detail = error instanceof Error ? error.message : String(error);
			throw new CopilotConfigError(`Cannot read ${configPath}: ${detail}`, { cause: error });
		}
	}

	async loadProviders(): Promise<ManagedProvider[]> {
		const groups = await this.readGroups();
		const providers: ManagedProvider[] = [];

		for (const entry of groups) {
			const group = asCustomEndpointGroup(entry);
			if (!group) {
				continue;
			}

			const apiType = resolveApiType(group);
			if (!apiType) {
				continue;
			}

			const metadata = asManagerMetadata(group.copilotModelsManager);
			const modelsFromFile = Array.isArray(group.models)
				? group.models.filter(isCopilotModelEntry)
				: [];
			const firstModel = modelsFromFile[0];
			const baseUrl = metadata?.baseUrl || (firstModel?.url ? inferBaseUrl(firstModel.url) : '');
			if (!baseUrl) {
				continue;
			}

			const id = metadata?.id || randomUUID();
			const copilotApiKey = group.apiKey;
			if (typeof group.apiKey === 'string' && group.apiKey && !isInputReference(group.apiKey)) {
				// A pre-existing literal value is preserved exactly in the JSON.
				// Keep a discovery copy as well without mutating the original field.
				await this.store.setApiKey(id, group.apiKey);
			}

			const providerHeaders = metadata?.requestHeaders;
			const models = modelsFromFile.map(entry =>
				this.fromCopilotModel(entry, apiType, baseUrl, providerHeaders),
			);

			providers.push({
				id,
				name: typeof group.name === 'string' && group.name.trim() ? group.name.trim() : 'Custom Endpoint',
				apiType,
				baseUrl,
				modelsPath: metadata?.modelsPath,
				requestHeaders: providerHeaders,
				copilotApiKey,
				models,
				createdAt: metadata?.createdAt ?? Date.now(),
				updatedAt: metadata?.updatedAt ?? Date.now(),
			});
		}

		return providers;
	}

	async saveProviders(providers: ManagedProvider[]): Promise<string> {
		const configPath = this.getConfigPath();
		const existing = await this.readGroups();
		const generated = await Promise.all(providers.map(provider => this.toCopilotGroup(provider)));
		await this.writeGroups(mergeManagedProviderGroups(existing, generated));
		return configPath;
	}

	async hasProviderGroupName(name: string, excludeProviderId?: string): Promise<boolean> {
		return hasConflictingProviderGroupName(await this.readGroups(), name, excludeProviderId);
	}

	private async writeGroups(groups: unknown[]): Promise<void> {
		const configPath = this.getConfigPath();
		await fs.mkdir(path.dirname(configPath), { recursive: true });
		const temporary = `${configPath}.copilot-models-manager.tmp`;
		await fs.writeFile(temporary, `${JSON.stringify(groups, null, 2)}\n`, 'utf8');
		await fs.rename(temporary, configPath);
	}

	private fromCopilotModel(
		entry: CopilotModelEntry,
		providerApiType: ApiType,
		baseUrl: string,
		providerHeaders?: Record<string, string>,
	): ManagedModel {
		const apiType = entry.apiType ?? providerApiType;
		const generatedUrl = buildModelRequestUrl(baseUrl, apiType);
		return {
			id: entry.id,
			name: entry.name || entry.id,
			enabled: true,
			source: 'manual',
			url: entry.url === generatedUrl ? undefined : entry.url,
			apiType: entry.apiType,
			toolCalling: entry.toolCalling ?? true,
			vision: entry.vision ?? false,
			thinking: entry.thinking,
			adaptiveThinking: entry.adaptiveThinking,
			minThinkingBudget: entry.minThinkingBudget,
			maxThinkingBudget: entry.maxThinkingBudget,
			streaming: entry.streaming,
			editTools: entry.editTools,
			contextWindow: entry.contextWindow ?? defaultContextWindow(),
			maxInputTokens: entry.maxInputTokens,
			maxOutputTokens: entry.maxOutputTokens ?? defaultMaxOutputTokens(entry.contextWindow ?? defaultContextWindow()),
			zeroDataRetentionEnabled: entry.zeroDataRetentionEnabled,
			supportsReasoningEffort: entry.supportsReasoningEffort,
			reasoningEffortFormat: entry.reasoningEffortFormat,
			modelOptions: entry.modelOptions,
			requestHeaders: subtractSharedHeaders(entry.requestHeaders, providerHeaders),
		};
	}

	private async toCopilotGroup(provider: ManagedProvider): Promise<CopilotProviderGroup> {
		const metadata: CopilotModelsManagerMetadata = {
			id: provider.id,
			baseUrl: provider.baseUrl,
			modelsPath: provider.modelsPath,
			requestHeaders: provider.requestHeaders,
			createdAt: provider.createdAt,
			updatedAt: provider.updatedAt,
		};

		return {
			name: provider.name,
			vendor: 'customendpoint',
			...(provider.copilotApiKey !== undefined ? { apiKey: provider.copilotApiKey } : {}),
			apiType: provider.apiType,
			copilotModelsManager: metadata,
			models: provider.models.filter(model => model.enabled !== false).map(model => {
				const apiType = model.apiType ?? provider.apiType;
				return {
					id: model.id,
					name: model.name,
					url: buildModelRequestUrl(model.url ?? provider.baseUrl, apiType),
					...(model.apiType ? { apiType: model.apiType } : {}),
					toolCalling: model.toolCalling,
					vision: model.vision,
					...(model.thinking !== undefined ? { thinking: model.thinking } : {}),
					...(model.adaptiveThinking !== undefined ? { adaptiveThinking: model.adaptiveThinking } : {}),
					...(model.minThinkingBudget ? { minThinkingBudget: model.minThinkingBudget } : {}),
					...(model.maxThinkingBudget ? { maxThinkingBudget: model.maxThinkingBudget } : {}),
					...(model.streaming !== undefined ? { streaming: model.streaming } : {}),
					...(model.editTools?.length ? { editTools: model.editTools } : {}),
					contextWindow: model.contextWindow ?? defaultContextWindow(),
					...(model.maxInputTokens ? { maxInputTokens: model.maxInputTokens } : {}),
					maxOutputTokens: model.maxOutputTokens ?? defaultMaxOutputTokens(model.contextWindow ?? defaultContextWindow()),
					...(model.zeroDataRetentionEnabled !== undefined ? { zeroDataRetentionEnabled: model.zeroDataRetentionEnabled } : {}),
					...(model.supportsReasoningEffort?.length ? { supportsReasoningEffort: model.supportsReasoningEffort } : {}),
					...(model.reasoningEffortFormat ? { reasoningEffortFormat: model.reasoningEffortFormat } : {}),
					...(model.modelOptions ? { modelOptions: model.modelOptions } : {}),
					...((provider.requestHeaders || model.requestHeaders)
						? { requestHeaders: { ...provider.requestHeaders, ...model.requestHeaders } }
						: {}),
				};
			}),
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

export function hasConflictingProviderGroupName(
	groups: unknown[], name: string, excludeProviderId?: string,
): boolean {
	return groups.some(entry => {
		const group = asCustomEndpointGroup(entry);
		return typeof group?.name === 'string'
			&& group.name.toLocaleLowerCase() === name.toLocaleLowerCase()
			&& asManagerMetadata(group.copilotModelsManager)?.id !== excludeProviderId;
	});
}

export function mergeManagedProviderGroups(
	existing: unknown[],
	generated: CopilotProviderGroup[],
): unknown[] {
	const managedNames = new Set(
		generated
			.map(group => group.name?.toLocaleLowerCase())
			.filter((name): name is string => Boolean(name)),
	);

	const retained = existing.filter(entry => {
		const group = asCustomEndpointGroup(entry);
		if (!group) {
			// Foreign vendors and unknown/malformed entries are opaque to this extension.
			return true;
		}
		if (asManagerMetadata(group.copilotModelsManager)) {
			return false;
		}
		const apiType = resolveApiType(group);
		if (!apiType) {
			return true;
		}
		return typeof group.name !== 'string' || !managedNames.has(group.name.toLocaleLowerCase());
	});

	return [...retained, ...generated];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asManagerMetadata(value: unknown): CopilotModelsManagerMetadata | undefined {
	if (!isRecord(value) ||
		typeof value.id !== 'string' ||
		typeof value.baseUrl !== 'string'
	) {
		return undefined;
	}

	const requestHeaders = isStringRecord(value.requestHeaders) ? value.requestHeaders : undefined;
	return {
		id: value.id,
		baseUrl: value.baseUrl,
		modelsPath: typeof value.modelsPath === 'string' ? value.modelsPath : undefined,
		requestHeaders,
		createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
		updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
	};
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every(item => typeof item === 'string');
}

function asCustomEndpointGroup(value: unknown): CopilotProviderGroup | undefined {
	if (!isRecord(value) || value.vendor !== 'customendpoint') {
		return undefined;
	}
	return value as CopilotProviderGroup;
}

function isCopilotModelEntry(value: unknown): value is CopilotModelEntry {
	return isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.name === 'string' &&
		typeof value.url === 'string';
}

function isInputReference(value: unknown): value is string {
	return typeof value === 'string' && /^\$\{input:[^}]+\}$/.test(value.trim());
}

function resolveApiType(group: CopilotProviderGroup): ApiType | undefined {
	if (isApiType(group.apiType)) {
		return group.apiType;
	}

	const models = Array.isArray(group.models)
		? group.models.filter(isCopilotModelEntry)
		: [];
	const modelType = models.find(model => isApiType(model.apiType))?.apiType;
	if (isApiType(modelType)) {
		return modelType;
	}

	const url = models.find(model => model.url)?.url;
	if (!url) {
		return undefined;
	}
	if (/\/responses\/?(?:\?|$)/i.test(url)) {
		return 'responses';
	}
	if (/\/messages\/?(?:\?|$)/i.test(url)) {
		return 'messages';
	}
	if (/\/chat\/completions\/?(?:\?|$)/i.test(url)) {
		return 'chat-completions';
	}
	return undefined;
}

function isApiType(value: unknown): value is ApiType {
	return typeof value === 'string' && SUPPORTED_API_TYPES.has(value as ApiType);
}

function inferBaseUrl(modelUrl: string): string {
	try {
		const url = new URL(modelUrl);
		url.pathname = url.pathname
			.replace(/\/(?:chat\/completions|responses|messages)\/?$/i, '')
			.replace(/\/$/, '');
		url.search = '';
		url.hash = '';
		return url.toString().replace(/\/$/, '');
	} catch {
		return modelUrl
			.replace(/\/(?:chat\/completions|responses|messages)\/?$/i, '')
			.replace(/\/$/, '');
	}
}

function subtractSharedHeaders(
	headers?: Record<string, string>,
	shared?: Record<string, string>,
): Record<string, string> | undefined {
	if (!headers) {
		return undefined;
	}
	if (!shared) {
		return { ...headers };
	}

	const result = { ...headers };
	for (const [key, value] of Object.entries(shared)) {
		if (result[key] === value) {
			delete result[key];
		}
	}
	return Object.keys(result).length ? result : undefined;
}

function normalizeJsonc(input: string): string {
	let output = '';
	let inString = false;
	let escaped = false;
	let lineComment = false;
	let blockComment = false;

	for (let index = 0; index < input.length; index += 1) {
		const current = input[index];
		const next = input[index + 1];

		if (lineComment) {
			if (current === '\n' || current === '\r') {
				lineComment = false;
				output += current;
			} else {
				output += ' ';
			}
			continue;
		}

		if (blockComment) {
			if (current === '*' && next === '/') {
				blockComment = false;
				output += '  ';
				index += 1;
			} else {
				output += current === '\n' || current === '\r' ? current : ' ';
			}
			continue;
		}

		if (inString) {
			output += current;
			if (escaped) {
				escaped = false;
			} else if (current === '\\') {
				escaped = true;
			} else if (current === '"') {
				inString = false;
			}
			continue;
		}

		if (current === '"') {
			inString = true;
			output += current;
			continue;
		}

		if (current === '/' && next === '/') {
			lineComment = true;
			output += '  ';
			index += 1;
			continue;
		}

		if (current === '/' && next === '*') {
			blockComment = true;
			output += '  ';
			index += 1;
			continue;
		}

		output += current;
	}

	return stripTrailingCommas(output);
}

function stripTrailingCommas(input: string): string {
	let output = '';
	let inString = false;
	let escaped = false;

	for (let index = 0; index < input.length; index += 1) {
		const current = input[index];

		if (inString) {
			output += current;
			if (escaped) {
				escaped = false;
			} else if (current === '\\') {
				escaped = true;
			} else if (current === '"') {
				inString = false;
			}
			continue;
		}

		if (current === '"') {
			inString = true;
			output += current;
			continue;
		}

		if (current === ',') {
			let lookahead = index + 1;
			while (lookahead < input.length && /\s/.test(input[lookahead])) {
				lookahead += 1;
			}
			if (input[lookahead] === '}' || input[lookahead] === ']') {
				output += ' ';
				continue;
			}
		}

		output += current;
	}

	return output;
}