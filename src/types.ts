export type ApiType = 'chat-completions' | 'responses' | 'messages';
export type EditToolName = 'find-replace' | 'multi-find-replace' | 'apply-patch' | 'code-rewrite';

export interface ManagedModel {
	id: string;
	name: string;
	enabled?: boolean;
	source?: 'discovered' | 'manual';
	url?: string;
	apiType?: ApiType;
	toolCalling: boolean;
	vision: boolean;
	thinking?: boolean;
	adaptiveThinking?: boolean;
	minThinkingBudget?: number;
	maxThinkingBudget?: number;
	streaming?: boolean;
	editTools?: EditToolName[];
	contextWindow?: number;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	zeroDataRetentionEnabled?: boolean;
	supportsReasoningEffort?: string[];
	reasoningEffortFormat?: ApiType;
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
	copilotApiKey?: unknown;
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
	apiType?: ApiType;
	toolCalling?: boolean;
	vision?: boolean;
	thinking?: boolean;
	adaptiveThinking?: boolean;
	minThinkingBudget?: number;
	maxThinkingBudget?: number;
	streaming?: boolean;
	editTools?: EditToolName[];
	contextWindow?: number;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	zeroDataRetentionEnabled?: boolean;
	supportsReasoningEffort?: string[];
	reasoningEffortFormat?: ApiType;
	modelOptions?: Record<string, unknown>;
	requestHeaders?: Record<string, string>;
}

export interface CopilotModelsManagerMetadata {
	id: string;
	baseUrl: string;
	modelsPath?: string;
	requestHeaders?: Record<string, string>;
	createdAt: number;
	updatedAt: number;
}

export interface CopilotProviderGroup {
	name?: string;
	vendor: string;
	apiKey?: unknown;
	apiType?: ApiType | string;
	models?: CopilotModelEntry[];
	copilotModelsManager?: CopilotModelsManagerMetadata;
	[key: string]: unknown;
}