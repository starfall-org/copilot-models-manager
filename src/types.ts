export type ApiType = 'chat-completions' | 'responses' | 'messages';

export interface ManagedModel {
	id: string;
	name: string;
	enabled?: boolean;
	source?: 'discovered' | 'manual';
	toolCalling: boolean;
	vision: boolean;
	thinking?: boolean;
	contextWindow?: number;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	supportsReasoningEffort?: string[];
	reasoningEffortFormat?: string;
	modelOptions?: Record<string, unknown>;
	requestHeaders?: Record<string, string>;
}

export interface ManagedProvider {
	id: string;
	name: string;
	apiType: ApiType;
	baseUrl: string;
	modelsPath?: string;
	requestHeaders?: Record<string, string>;
	models: ManagedModel[];
	createdAt: number;
	updatedAt: number;
}

export interface DiscoveredModel {
	id: string;
	name: string;
	toolCalling?: boolean;
	vision?: boolean;
	thinking?: boolean;
	contextWindow?: number;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	supportsReasoningEffort?: string[];
}

export interface CopilotModelEntry {
	id: string;
	name: string;
	url: string;
	toolCalling?: boolean;
	vision?: boolean;
	thinking?: boolean;
	contextWindow?: number;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	supportsReasoningEffort?: string[];
	reasoningEffortFormat?: string;
	modelOptions?: Record<string, unknown>;
	requestHeaders?: Record<string, string>;
}

export interface CopilotProviderGroup {
	name?: string;
	vendor: string;
	apiKey?: string;
	apiType?: ApiType | string;
	models?: CopilotModelEntry[];
	[key: string]: unknown;
}
