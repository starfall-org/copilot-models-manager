import * as assert from 'assert';
import * as vscode from 'vscode';
import { hasConflictingProviderGroupName, mergeManagedProviderGroups } from '../copilotConfig';
import { CopilotProviderGroup } from '../types';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

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