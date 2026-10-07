import * as assert from 'assert';
import * as vscode from 'vscode';
import { hasConflictingProviderGroupName, mergeManagedProviderGroups } from '../copilotConfig';
import { ProviderSortBy, ProviderSortDirection, ProviderSortState, sortManagedProviders } from '../modelsTree';
import { defaultMaxInputTokens, defaultMaxOutputTokens, isModelDiscoveryAuthError, ModelDiscoveryHttpError } from '../providerClient';
import { availableReasoningEfforts, setModelApiType, setThinkingState } from '../reasoningEffort';
import { CopilotProviderGroup, ManagedProvider } from '../types';
const testModel = (id: string, enabled = true) => ({
	id, name: id, enabled, toolCalling: true, vision: false,
});
const providers: ManagedProvider[] = [
	{ id: 'b', name: 'Beta', apiType: 'responses', baseUrl: 'https://b.example.com', models: [testModel('b1'), testModel('b2')], createdAt: 200, updatedAt: 200 },
	{ id: 'a', name: 'Alpha', apiType: 'responses', baseUrl: 'https://a.example.com', models: [testModel('a1')], createdAt: 300, updatedAt: 300 },
	{ id: 'g', name: 'Gamma', apiType: 'responses', baseUrl: 'https://g.example.com', models: [testModel('g1'), testModel('g2'), testModel('g3'), testModel('hidden', false)], createdAt: 100, updatedAt: 100 },
];

const providerSortState = (
	by: ProviderSortBy,
	direction: ProviderSortDirection,
): ProviderSortState => ({
	by,
	directions: {
		time: 'descending',
		name: 'ascending',
		quantity: 'descending',
		[by]: direction,
	},
});
suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('provider sorting supports time, name, and quantity in both directions', () => {
		assert.deepStrictEqual(sortManagedProviders(providers, providerSortState('time', 'ascending')).map(item => item.id), ['g', 'b', 'a']);
		assert.deepStrictEqual(sortManagedProviders(providers, providerSortState('time', 'descending')).map(item => item.id), ['a', 'b', 'g']);
		assert.deepStrictEqual(sortManagedProviders(providers, providerSortState('name', 'ascending')).map(item => item.id), ['a', 'b', 'g']);
		assert.deepStrictEqual(sortManagedProviders(providers, providerSortState('name', 'descending')).map(item => item.id), ['g', 'b', 'a']);
		assert.deepStrictEqual(sortManagedProviders(providers, providerSortState('quantity', 'ascending')).map(item => item.id), ['a', 'b', 'g']);
		assert.deepStrictEqual(sortManagedProviders(providers, providerSortState('quantity', 'descending')).map(item => item.id), ['g', 'b', 'a']);
	});


	test('model token defaults are stable when provider metadata is missing', () => {
		assert.strictEqual(defaultMaxInputTokens(), 128000);
		assert.strictEqual(defaultMaxOutputTokens(), 16000);
	});
	test('enabling thinking adds safe effort defaults and the effective API format', () => {
		const base = testModel('reasoning');
		const chat = setThinkingState(base, 'chat-completions', true);
		assert.deepStrictEqual(chat.supportsReasoningEffort, ['low', 'medium', 'high']);
		assert.strictEqual(chat.reasoningEffortFormat, 'chat-completions');

		const messages = setThinkingState(base, 'messages', true);
		assert.deepStrictEqual(messages.supportsReasoningEffort, ['low', 'medium', 'high']);
		assert.strictEqual(messages.reasoningEffortFormat, 'messages');
	});

	test('reasoning effort choices follow the API type and API changes keep thinking compatible', () => {
		assert.deepStrictEqual(
			availableReasoningEfforts('responses'),
			['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
		);
		assert.deepStrictEqual(
			availableReasoningEfforts('messages'),
			['low', 'medium', 'high', 'xhigh', 'max'],
		);

		const changed = setModelApiType({
			...testModel('reasoning'),
			thinking: true,
			supportsReasoningEffort: ['none', 'low', 'xhigh'],
			reasoningEffortFormat: 'responses',
			apiType: 'responses',
		}, 'chat-completions', 'messages');
		assert.deepStrictEqual(changed.supportsReasoningEffort, ['low', 'xhigh']);
		assert.strictEqual(changed.reasoningEffortFormat, 'messages');
	});

	test('disabling thinking removes effort picker configuration', () => {
		const disabled = setThinkingState({
			...testModel('reasoning'),
			thinking: true,
			supportsReasoningEffort: ['low', 'medium', 'high'],
			reasoningEffortFormat: 'responses',
		}, 'responses', undefined);
		assert.strictEqual(disabled.supportsReasoningEffort, undefined);
		assert.strictEqual(disabled.reasoningEffortFormat, undefined);
	});

	test('model discovery only treats authentication HTTP failures as missing-key candidates', () => {
		assert.strictEqual(isModelDiscoveryAuthError(new ModelDiscoveryHttpError(401, 'Unauthorized', '')), true);
		assert.strictEqual(isModelDiscoveryAuthError(new ModelDiscoveryHttpError(403, 'Forbidden', '')), true);
		assert.strictEqual(isModelDiscoveryAuthError(new ModelDiscoveryHttpError(404, 'Not Found', '')), false);
		assert.strictEqual(isModelDiscoveryAuthError(new ModelDiscoveryHttpError(500, 'Server Error', '')), false);
	});

	test('provider name check excludes its own saved group but still rejects other groups', () => {
		const groups = [
			{ name: 'Mine', vendor: 'customendpoint', copilotModelsManager: {
				id: 'my-id', baseUrl: 'https://mine.example.com',
			} },
			{ name: 'Other', vendor: 'customendpoint', copilotModelsManager: {
				id: 'other-id', baseUrl: 'https://other.example.com',
			} },
			{ name: 'External', vendor: 'customendpoint' },
		];
		assert.strictEqual(hasConflictingProviderGroupName(groups, 'mine', 'my-id'), false);
		assert.strictEqual(hasConflictingProviderGroupName(groups, 'other', 'my-id'), true);
		assert.strictEqual(hasConflictingProviderGroupName(groups, 'external', 'my-id'), true);
		assert.strictEqual(hasConflictingProviderGroupName(groups, 'mine'), true);
	});

	test('foreign vendors and unknown entries remain opaque', () => {
		const foreignVendor = {
			name: 'Managed',
			vendor: 'some-other-vendor',
			apiKey: '${input:foreign.secret}',
			copilotModelsManager: { shouldNotMatter: true },
			customField: { nested: ['keep', 1, true] },
		};
		const malformedObject = { hello: 'world' };
		const existingManaged = {
			name: 'Managed',
			vendor: 'customendpoint',
			apiType: 'responses',
			copilotModelsManager: {
				id: 'old-id',
				baseUrl: 'https://old.example.com',
				createdAt: 1,
				updatedAt: 1,
			},
			models: [],
		};

		const generated: CopilotProviderGroup = {
			name: 'Managed',
			vendor: 'customendpoint',
			apiType: 'responses',
			copilotModelsManager: {
				id: 'new-id',
				baseUrl: 'https://new.example.com',
				createdAt: 2,
				updatedAt: 2,
			},
			models: [],
		};

		const result = mergeManagedProviderGroups(
			[foreignVendor, null, 'opaque-entry', malformedObject, existingManaged],
			[generated],
		);

		assert.strictEqual(result[0], foreignVendor);
		assert.strictEqual(result[1], null);
		assert.strictEqual(result[2], 'opaque-entry');
		assert.strictEqual(result[3], malformedObject);
		assert.strictEqual(result[4], generated);
		assert.deepStrictEqual(result[0], foreignVendor);
		assert.strictEqual(result.includes(existingManaged), false);
	});
});