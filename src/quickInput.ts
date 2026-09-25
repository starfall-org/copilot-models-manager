import * as vscode from 'vscode';
import { ApiType, EditToolName } from './types';

const API_TYPES: Array<{ label: string; description: string; value: ApiType }> = [
	{ label: 'Chat Completions', description: 'OpenAI-compatible /v1/chat/completions', value: 'chat-completions' },
	{ label: 'Responses', description: 'OpenAI-compatible /v1/responses', value: 'responses' },
	{ label: 'Messages', description: 'Anthropic-compatible /v1/messages', value: 'messages' },
];

export const QUICK_PICK_ACCEPT_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('check'),
	tooltip: 'Accept',
};

export const QUICK_PICK_CANCEL_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('close'),
	tooltip: 'Cancel',
};

export async function showManagedQuickPick<T extends vscode.QuickPickItem>(
	items: readonly T[],
	options: vscode.QuickPickOptions,
	acceptButtonResult?: () => T | undefined,
): Promise<T | undefined> {
	return new Promise(resolve => {
		const quickPick = vscode.window.createQuickPick<T>();
		quickPick.items = [...items];
		quickPick.title = options.title;
		quickPick.placeholder = options.placeHolder;
		quickPick.ignoreFocusOut = true;
		quickPick.matchOnDescription = options.matchOnDescription ?? false;
		quickPick.matchOnDetail = options.matchOnDetail ?? false;
		quickPick.buttons = [QUICK_PICK_ACCEPT_BUTTON, QUICK_PICK_CANCEL_BUTTON];

		let settled = false;
		const finish = (value: T | undefined): void => {
			if (settled) {
				return;
			}
			settled = true;
			quickPick.hide();
			resolve(value);
		};

		const disposables = [
			quickPick.onDidAccept(() => finish(quickPick.selectedItems[0] ?? quickPick.activeItems[0])),
			quickPick.onDidTriggerButton(button => {
				if (button === QUICK_PICK_ACCEPT_BUTTON) {
					finish(acceptButtonResult
						? acceptButtonResult()
						: quickPick.selectedItems[0] ?? quickPick.activeItems[0]);
				} else if (button === QUICK_PICK_CANCEL_BUTTON) {
					finish(undefined);
				}
			}),
			quickPick.onDidHide(() => {
				if (!settled) {
					settled = true;
					resolve(undefined);
				}
				for (const disposable of disposables) {
					disposable.dispose();
				}
				quickPick.dispose();
			}),
		];

		quickPick.show();
	});
}

export async function showManagedMultiQuickPick<T extends vscode.QuickPickItem>(
	items: readonly T[],
	options: vscode.QuickPickOptions,
): Promise<readonly T[] | undefined> {
	return new Promise(resolve => {
		const quickPick = vscode.window.createQuickPick<T>();
		quickPick.items = [...items];
		quickPick.canSelectMany = true;
		quickPick.title = options.title;
		quickPick.placeholder = options.placeHolder;
		quickPick.ignoreFocusOut = true;
		quickPick.matchOnDescription = options.matchOnDescription ?? false;
		quickPick.matchOnDetail = options.matchOnDetail ?? false;
		quickPick.buttons = [QUICK_PICK_ACCEPT_BUTTON, QUICK_PICK_CANCEL_BUTTON];
		quickPick.selectedItems = items.filter(item => Boolean((item as T & { picked?: boolean }).picked));

		let settled = false;
		const finish = (value: readonly T[] | undefined): void => {
			if (settled) {
				return;
			}
			settled = true;
			quickPick.hide();
			resolve(value);
		};

		const disposables = [
			quickPick.onDidAccept(() => finish([...quickPick.selectedItems])),
			quickPick.onDidTriggerButton(button => {
				if (button === QUICK_PICK_ACCEPT_BUTTON) {
					finish([...quickPick.selectedItems]);
				} else if (button === QUICK_PICK_CANCEL_BUTTON) {
					finish(undefined);
				}
			}),
			quickPick.onDidHide(() => {
				if (!settled) {
					settled = true;
					resolve(undefined);
				}
				for (const disposable of disposables) {
					disposable.dispose();
				}
				quickPick.dispose();
			}),
		];

		quickPick.show();
	});
}

export async function pickApiType(current?: ApiType): Promise<ApiType | undefined> {
	const picked = await showManagedQuickPick(
		API_TYPES.map(item => ({ ...item, picked: item.value === current })),
		{ title: 'API Type', placeHolder: 'Choose the protocol Copilot should use', ignoreFocusOut: true },
	);
	return picked?.value;
}

export function optionalBooleanLabel(value: boolean | undefined): string {
	return value === undefined ? 'Unset' : String(value);
}

export function optionalNumberLabel(value: number | undefined): string {
	return value === undefined ? 'Unset' : value.toLocaleString();
}

export async function pickRequiredBoolean(title: string, current: boolean): Promise<boolean | undefined> {
	const picked = await showManagedQuickPick([
		{ label: 'true', value: true, description: current === true ? 'Current' : undefined },
		{ label: 'false', value: false, description: current === false ? 'Current' : undefined },
	], {
		title,
		ignoreFocusOut: true,
	});
	return picked?.value;
}

export async function pickOptionalBoolean(
	title: string,
	current: boolean | undefined,
): Promise<{ cancelled: boolean; value: boolean | undefined }> {
	const picked = await showManagedQuickPick([
		{ label: 'Unset', value: undefined, description: current === undefined ? 'Current' : 'Use VS Code default behavior' },
		{ label: 'true', value: true, description: current === true ? 'Current' : undefined },
		{ label: 'false', value: false, description: current === false ? 'Current' : undefined },
	], {
		title,
		ignoreFocusOut: true,
	});
	return picked
		? { cancelled: false, value: picked.value }
		: { cancelled: true, value: current };
}

export async function pickOptionalApiType(
	title: string,
	providerType: ApiType,
	current: ApiType | undefined,
): Promise<{ cancelled: boolean; value: ApiType | undefined }> {
	const picked = await showManagedQuickPick([
		{
			label: 'Unset',
			value: undefined,
			description: current === undefined ? `Current · inherit/follow ${providerType}` : `Inherit/follow ${providerType}`,
		},
		...API_TYPES.map(item => ({
			label: item.label,
			description: current === item.value ? `Current · ${item.description}` : item.description,
			value: item.value as ApiType,
		})),
	], {
		title,
		ignoreFocusOut: true,
	});
	return picked
		? { cancelled: false, value: picked.value }
		: { cancelled: true, value: current };
}

export async function pickEditTools(current?: EditToolName[]): Promise<EditToolName[] | null> {
	const options: Array<{ label: string; value: EditToolName; picked: boolean }> = [
		{ label: 'find-replace', value: 'find-replace', picked: current?.includes('find-replace') ?? false },
		{ label: 'multi-find-replace', value: 'multi-find-replace', picked: current?.includes('multi-find-replace') ?? false },
		{ label: 'apply-patch', value: 'apply-patch', picked: current?.includes('apply-patch') ?? false },
		{ label: 'code-rewrite', value: 'code-rewrite', picked: current?.includes('code-rewrite') ?? false },
	];
	const picked = await showManagedMultiQuickPick(options, {
		title: 'Edit Tools',
		placeHolder: 'Select supported edit tools. Select none to remove the property.',
		ignoreFocusOut: true,
	});
	return picked ? picked.map(item => item.value) : null;
}

const HEADER_EDIT_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('edit'),
	tooltip: 'Edit Header',
};

const HEADER_DELETE_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('trash'),
	tooltip: 'Delete Header',
};

interface HeaderQuickPickItem extends vscode.QuickPickItem {
	itemType: 'add' | 'header';
	headerKey?: string;
}

type HeaderListAction =
	| { type: 'save' }
	| { type: 'cancel' }
	| { type: 'add' }
	| { type: 'edit'; key: string }
	| { type: 'delete'; key: string };

export async function editRequestHeaders(
	title: string,
	current?: Record<string, string>,
): Promise<{ cancelled: boolean; value: Record<string, string> | undefined }> {
	const headers: Record<string, string> = { ...current };

	while (true) {
		const action = await showHeadersQuickPick(title, headers);
		if (action.type === 'save') {
			return {
				cancelled: false,
				value: Object.keys(headers).length ? headers : undefined,
			};
		}
		if (action.type === 'cancel') {
			return { cancelled: true, value: current };
		}

		if (action.type === 'delete') {
			delete headers[action.key];
			continue;
		}

		if (action.type === 'add') {
			const added = await promptNewHeader(headers);
			if (added) {
				headers[added.key] = added.value;
			}
			continue;
		}

		await editSingleHeader(title, headers, action.key);
	}
}

function showHeadersQuickPick(
	title: string,
	headers: Record<string, string>,
): Promise<HeaderListAction> {
	return new Promise(resolve => {
		const quickPick = vscode.window.createQuickPick<HeaderQuickPickItem>();
		quickPick.title = title;
		quickPick.placeholder = 'Add, edit, or delete request headers';
		quickPick.ignoreFocusOut = true;
		quickPick.matchOnDescription = true;
		quickPick.buttons = [QUICK_PICK_ACCEPT_BUTTON, QUICK_PICK_CANCEL_BUTTON];
		quickPick.items = [
			{
				label: '$(add) Add Header',
				description: 'Create a new header',
				itemType: 'add',
			},
			...Object.entries(headers).map(([key, value]): HeaderQuickPickItem => ({
				label: key,
				description: value,
				itemType: 'header',
				headerKey: key,
				buttons: [HEADER_EDIT_BUTTON, HEADER_DELETE_BUTTON],
			})),
		];

		let settled = false;
		const finish = (action: HeaderListAction): void => {
			if (settled) {
				return;
			}
			settled = true;
			quickPick.hide();
			resolve(action);
		};

		const runItem = (item: HeaderQuickPickItem | undefined): void => {
			if (!item) {
				return;
			}
			if (item.itemType === 'add') {
				finish({ type: 'add' });
			} else if (item.headerKey) {
				finish({ type: 'edit', key: item.headerKey });
			}
		};

		const disposables = [
			quickPick.onDidAccept(() => runItem(quickPick.selectedItems[0] ?? quickPick.activeItems[0])),
			quickPick.onDidTriggerButton(button => {
				if (button === QUICK_PICK_ACCEPT_BUTTON) {
					finish({ type: 'save' });
				} else if (button === QUICK_PICK_CANCEL_BUTTON) {
					finish({ type: 'cancel' });
				}
			}),
			quickPick.onDidTriggerItemButton(event => {
				const key = event.item.headerKey;
				if (!key) {
					return;
				}
				if (event.button === HEADER_DELETE_BUTTON) {
					finish({ type: 'delete', key });
				} else if (event.button === HEADER_EDIT_BUTTON) {
					finish({ type: 'edit', key });
				}
			}),
			quickPick.onDidHide(() => {
				if (!settled) {
					settled = true;
					resolve({ type: 'cancel' });
				}
				for (const disposable of disposables) {
					disposable.dispose();
				}
				quickPick.dispose();
			}),
		];

		quickPick.show();
	});
}

async function promptNewHeader(
	headers: Record<string, string>,
): Promise<{ key: string; value: string } | undefined> {
	const key = await vscode.window.showInputBox({
		title: 'Add Header — Key',
		prompt: 'Enter the HTTP header name.',
		ignoreFocusOut: true,
		validateInput: value => {
			const candidate = value.trim();
			if (!candidate) {
				return 'Header key is required.';
			}
			return findHeaderKey(headers, candidate)
				? `Header "${candidate}" already exists.`
				: undefined;
		},
	});
	if (key === undefined) {
		return undefined;
	}

	const value = await vscode.window.showInputBox({
		title: 'Add Header — Value',
		prompt: 'Enter the HTTP header value. Empty is allowed.',
		value: '',
		ignoreFocusOut: true,
	});
	if (value === undefined) {
		return undefined;
	}

	return { key: key.trim(), value };
}

async function editSingleHeader(
	title: string,
	headers: Record<string, string>,
	initialKey: string,
): Promise<void> {
	let key = initialKey;

	while (Object.prototype.hasOwnProperty.call(headers, key)) {
		const action = await showManagedQuickPick([
			{ label: 'key', description: key, value: 'key' },
			{ label: 'value', description: headers[key], value: 'value' },
		], {
			title: `${title} — Edit Header`,
			placeHolder: 'Choose key or value to edit',
			ignoreFocusOut: true,
			matchOnDescription: true,
		}, () => undefined);
		if (!action) {
			return;
		}

		if (action.value === 'key') {
			const value = await vscode.window.showInputBox({
				title: 'Header Key',
				prompt: 'Leave empty to delete this header.',
				value: key,
				ignoreFocusOut: true,
				validateInput: value => {
					const candidate = value.trim();
					if (!candidate || candidate.toLocaleLowerCase() === key.toLocaleLowerCase()) {
						return undefined;
					}
					const collision = findHeaderKey(headers, candidate, key);
					return collision ? `Header "${candidate}" already exists.` : undefined;
				},
			});
			if (value === undefined) {
				continue;
			}

			const nextKey = value.trim();
			if (!nextKey) {
				delete headers[key];
				return;
			}
			if (nextKey !== key) {
				const currentValue = headers[key];
				delete headers[key];
				headers[nextKey] = currentValue;
				key = nextKey;
			}
			continue;
		}

		const value = await vscode.window.showInputBox({
			title: 'Header Value',
			prompt: 'Empty is allowed and will be sent as an empty string.',
			value: headers[key],
			ignoreFocusOut: true,
		});
		if (value === undefined) {
			continue;
		}
		headers[key] = value;
	}
}

function findHeaderKey(
	headers: Record<string, string>,
	candidate: string,
	except?: string,
): string | undefined {
	const normalized = candidate.toLocaleLowerCase();
	return Object.keys(headers).find(key =>
		key !== except && key.toLocaleLowerCase() === normalized,
	);
}

export async function editJsonObject(
	title: string,
	prompt: string,
	current: Record<string, unknown> | undefined,
	validateInput: (value: string) => string | undefined,
): Promise<{ cancelled: boolean; value: Record<string, unknown> | undefined }> {
	const value = await vscode.window.showInputBox({
		title,
		prompt,
		value: current ? JSON.stringify(current) : '',
		ignoreFocusOut: true,
		validateInput,
	});
	if (value === undefined) {
		return { cancelled: true, value: current };
	}
	return {
		cancelled: false,
		value: value.trim() ? JSON.parse(value) as Record<string, unknown> : undefined,
	};
}

export function validateHttpUrl(value: string): string | undefined {
	try {
		const url = new URL(value.trim());
		return ['http:', 'https:'].includes(url.protocol) ? undefined : 'Only http:// and https:// URLs are supported.';
	} catch {
		return 'Enter a valid HTTP(S) URL.';
	}
}


export function validateObjectJson(value: string): string | undefined {
	if (!value.trim()) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? undefined : 'Enter a JSON object.';
	} catch {
		return 'Enter a valid JSON object.';
	}
}

export async function askOptionalPositiveInteger(title: string, current?: number): Promise<number | undefined> {
	const value = await vscode.window.showInputBox({
		title,
		prompt: 'Leave empty to remove the override.',
		value: current?.toString() ?? '',
		ignoreFocusOut: true,
		validateInput: text => !text.trim() || (/^\d+$/.test(text.trim()) && Number(text) > 0)
			? undefined
			: 'Enter a positive integer or leave empty.',
	});
	if (value === undefined) {
		return current;
	}
	return value.trim() ? Number(value.trim()) : undefined;
}

