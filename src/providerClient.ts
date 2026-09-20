import { ApiType, DiscoveredModel, ManagedProvider } from './types';

const API_PATHS: Record<ApiType, string> = {
	'chat-completions': 'chat/completions',
	responses: 'responses',
	messages: 'messages',
};

export function normalizeBaseUrl(value: string): string {
	return value.trim().replace(/\/+$/, '');
}

export function buildModelRequestUrl(baseUrl: string, apiType: ApiType): string {
	const normalized = normalizeBaseUrl(baseUrl);
	const url = new URL(normalized);
	const path = url.pathname.replace(/\/+$/, '');
	const knownSuffix = /\/(?:chat\/completions|responses|messages)$/i;

	if (knownSuffix.test(path)) {
		url.pathname = path.replace(knownSuffix, `/${API_PATHS[apiType]}`);
		return url.toString().replace(/\/$/, '');
	}

	if (/\/v\d+(?:beta\d*)?$/i.test(path) || /\/api\/v\d+$/i.test(path)) {
		url.pathname = `${path}/${API_PATHS[apiType]}`;
		return url.toString().replace(/\/$/, '');
	}

	url.pathname = `${path}/v1/${API_PATHS[apiType]}`.replace(/\/+/g, '/');
	return url.toString().replace(/\/$/, '');
}

export function buildModelsUrl(provider: Pick<ManagedProvider, 'baseUrl' | 'modelsPath'>): string {
	if (provider.modelsPath?.trim()) {
		const candidate = provider.modelsPath.trim();
		if (/^https?:\/\//i.test(candidate)) {
			return candidate;
		}
		return new URL(candidate.replace(/^\/+/, ''), `${normalizeBaseUrl(provider.baseUrl)}/`).toString();
	}

	const url = new URL(normalizeBaseUrl(provider.baseUrl));
	let path = url.pathname.replace(/\/+$/, '');
	path = path.replace(/\/(?:chat\/completions|responses|messages)$/i, '');

	if (/\/v\d+(?:beta\d*)?$/i.test(path) || /\/api\/v\d+$/i.test(path)) {
		url.pathname = `${path}/models`;
	} else {
		url.pathname = `${path}/v1/models`.replace(/\/+/g, '/');
	}
	return url.toString().replace(/\/$/, '');
}

function parseNumber(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
			return Math.floor(value);
		}
		if (typeof value === 'string' && /^\d+$/.test(value)) {
			return Number(value);
		}
	}
	return undefined;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function parseDiscoveredModel(value: unknown): DiscoveredModel | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const raw = value as Record<string, unknown>;
	const idCandidate = raw.id ?? raw.name ?? raw.model;
	if (typeof idCandidate !== 'string' || !idCandidate.trim()) {
		return undefined;
	}

	const id = idCandidate.trim();
	const architecture = raw.architecture && typeof raw.architecture === 'object'
		? raw.architecture as Record<string, unknown>
		: {};
	const topProvider = raw.top_provider && typeof raw.top_provider === 'object'
		? raw.top_provider as Record<string, unknown>
		: {};

	const supported = new Set([
		...stringArray(raw.supported_parameters),
		...stringArray(raw.capabilities),
	].map(item => item.toLowerCase()));

	const modalities = [
		...stringArray(raw.modalities),
		...stringArray(raw.input_modalities),
		...stringArray(architecture.input_modalities),
	].map(item => item.toLowerCase());

	const displayName = [raw.display_name, raw.displayName, raw.name]
		.find(item => typeof item === 'string' && item.trim()) as string | undefined;

	const toolCalling = supported.size > 0
		? ['tools', 'tool_choice', 'function_calling', 'function_call'].some(item => supported.has(item))
		: undefined;
	const vision = modalities.length > 0
		? modalities.some(item => item === 'image' || item === 'vision')
		: undefined;
	const thinking = supported.size > 0
		? ['reasoning', 'reasoning_effort', 'include_reasoning'].some(item => supported.has(item))
		: undefined;

	return {
		id,
		name: displayName?.trim() || id,
		toolCalling,
		vision,
		thinking,
		contextWindow: parseNumber(raw.context_length, raw.contextWindow, raw.max_model_len, raw.max_context_length),
		maxInputTokens: parseNumber(raw.max_input_tokens, raw.maxInputTokens),
		maxOutputTokens: parseNumber(
			raw.max_output_tokens,
			raw.maxOutputTokens,
			raw.max_completion_tokens,
			topProvider.max_completion_tokens,
		),
		supportsReasoningEffort: supported.has('reasoning_effort') ? ['low', 'medium', 'high'] : undefined,
	};
}

export async function discoverModels(provider: ManagedProvider, apiKey: string | undefined): Promise<DiscoveredModel[]> {
	const url = buildModelsUrl(provider);
	const headers: Record<string, string> = {
		Accept: 'application/json',
		...provider.requestHeaders,
	};

	for (const [key, value] of Object.entries(headers)) {
		headers[key] = value.replaceAll('${apiKey}', apiKey ?? '');
	}

	if (apiKey) {
		const hasAuth = Object.keys(headers).some(key =>
			['authorization', 'api-key', 'x-api-key', 'x-goog-api-key', 'apikey'].includes(key.toLowerCase()),
		);
		if (!hasAuth) {
			if (provider.apiType === 'messages') {
				headers['x-api-key'] = apiKey;
				headers['anthropic-version'] ??= '2023-06-01';
			} else {
				headers.Authorization = `Bearer ${apiKey}`;
			}
		}
	}

	const response = await fetch(url, { headers });
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Model discovery failed: HTTP ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 300)}` : ''}`);
	}

	const payload = await response.json() as unknown;
	let values: unknown[] = [];
	if (Array.isArray(payload)) {
		values = payload;
	} else if (payload && typeof payload === 'object') {
		const record = payload as Record<string, unknown>;
		if (Array.isArray(record.data)) {
			values = record.data;
		} else if (Array.isArray(record.models)) {
			values = record.models;
		}
	}

	const byId = new Map<string, DiscoveredModel>();
	for (const value of values) {
		const parsed = parseDiscoveredModel(value);
		if (parsed) {
			byId.set(parsed.id, parsed);
		}
	}

	return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
