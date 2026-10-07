import { ApiType, ManagedModel } from './types';

const OPENAI_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const MESSAGES_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export function availableReasoningEfforts(apiType: ApiType): readonly string[] {
	return apiType === 'messages' ? MESSAGES_REASONING_EFFORTS : OPENAI_REASONING_EFFORTS;
}

export function defaultReasoningEfforts(_apiType: ApiType): string[] {
	return ['low', 'medium', 'high'];
}

export function setThinkingState(
	model: ManagedModel,
	providerApiType: ApiType,
	thinking: boolean | undefined,
): ManagedModel {
	const next: ManagedModel = { ...model, thinking };
	if (thinking === true) {
		const apiType = model.apiType ?? providerApiType;
		if (!next.supportsReasoningEffort?.length) {
			next.supportsReasoningEffort = defaultReasoningEfforts(apiType);
		}
		next.reasoningEffortFormat ??= apiType;
	} else {
		delete next.supportsReasoningEffort;
		delete next.reasoningEffortFormat;
	}
	return next;
}

export function syncThinkingForApiTypeChange(
	model: ManagedModel,
	previousApiType: ApiType,
	nextApiType: ApiType,
): ManagedModel {
	const next: ManagedModel = { ...model };
	if (next.thinking !== true || previousApiType === nextApiType) {
		return next;
	}

	const allowed = availableReasoningEfforts(nextApiType);
	const previousDefaults = defaultReasoningEfforts(previousApiType);
	const current = next.supportsReasoningEffort ?? [];
	const wasDefault = current.length === previousDefaults.length
		&& current.every((value, index) => value === previousDefaults[index]);
	const compatible = current.filter(value => allowed.includes(value));

	next.supportsReasoningEffort = !current.length || wasDefault
		? defaultReasoningEfforts(nextApiType)
		: compatible.length ? compatible : defaultReasoningEfforts(nextApiType);

	if (!next.reasoningEffortFormat || next.reasoningEffortFormat === previousApiType) {
		next.reasoningEffortFormat = nextApiType;
	}

	return next;
}

export function setModelApiType(
	model: ManagedModel,
	providerApiType: ApiType,
	apiType: ApiType | undefined,
): ManagedModel {
	const previousApiType = model.apiType ?? providerApiType;
	const nextApiType = apiType ?? providerApiType;
	return {
		...syncThinkingForApiTypeChange(model, previousApiType, nextApiType),
		apiType,
	};
}
