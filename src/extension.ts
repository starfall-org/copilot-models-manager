import * as path from 'node:path';
import * as vscode from 'vscode';
import { CopilotConfigError, CopilotConfigService } from './copilotConfig';
import { ProviderStore } from './providerStore';
import { ModelsTreeProvider, ProviderNode, ProviderSortState } from './modelsTree';
import { ModelTarget } from './commandShared';
import { addProvider, editProvider, copyProviderApiKey, manageCopilotApiKey, refreshProvider, refreshAll, deleteProvider } from './providerCommands';
import { addModel, editModel, copyModelId, setModelThinking, removeModel } from './modelCommands';

let outputChannel: vscode.OutputChannel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	outputChannel = vscode.window.createOutputChannel('Copilot Models Manager');
	const store = new ProviderStore(context);
	const config = new CopilotConfigService(store);
	const tree = new ModelsTreeProvider(store, context.globalState);

	const configPath = config.getConfigPath();
	const configWatcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(vscode.Uri.file(path.dirname(configPath)), path.basename(configPath)),
	);
	let reloadTimer: NodeJS.Timeout | undefined;
	const scheduleReload = (): void => {
		if (reloadTimer) {
			clearTimeout(reloadTimer);
		}
		reloadTimer = setTimeout(() => {
			void config.loadProviders()
				.then(providers => store.replaceAll(providers))
				.catch(error => logExtensionError('Reload chatLanguageModels.json', error));
		}, 100);
	};

	context.subscriptions.push(
		outputChannel,
		store,
		configWatcher,
		{ dispose: () => reloadTimer && clearTimeout(reloadTimer) },
		configWatcher.onDidCreate(scheduleReload),
		configWatcher.onDidChange(scheduleReload),
		configWatcher.onDidDelete(scheduleReload),
		vscode.window.registerTreeDataProvider('copilotModelsManager.providers', tree),
		store.onDidChange(() => tree.refresh()),
		register('copilotModelsManager.sortProviders', () => chooseProviderSort(tree)),
		register('copilotModelsManager.addProvider', () => addProvider(store, config, tree)),
		register('copilotModelsManager.openManageLanguageModels', () => vscode.commands.executeCommand('workbench.action.chat.manage')),
		register('copilotModelsManager.openConfig', () => vscode.commands.executeCommand('workbench.action.openLanguageModelsJson')),
		register('copilotModelsManager.editProvider', (node?: ProviderNode) => editProvider(store, config, tree, node)),
		register('copilotModelsManager.manageCopilotApiKey', (node?: ProviderNode) => manageCopilotApiKey(store, node)),
		register('copilotModelsManager.copyApiKey', (node?: ProviderNode) => copyProviderApiKey(store, node)),
		register('copilotModelsManager.refreshProvider', (node?: ProviderNode) => refreshProvider(store, config, tree, node)),
		register('copilotModelsManager.refreshAll', () => refreshAll(store, config, tree)),
		register('copilotModelsManager.deleteProvider', (node?: ProviderNode) => deleteProvider(store, config, tree, node)),
		register('copilotModelsManager.addModel', (node?: ProviderNode) => addModel(store, config, tree, node)),
		register('copilotModelsManager.editModel', (node?: ModelTarget) => editModel(store, config, tree, node)),
		register('copilotModelsManager.copyModelId', (node?: ModelTarget) => copyModelId(store, node)),
		register('copilotModelsManager.setThinking', (node?: ModelTarget) => setModelThinking(store, config, tree, node, true)),
		register('copilotModelsManager.unsetThinking', (node?: ModelTarget) => setModelThinking(store, config, tree, node, false)),
		register('copilotModelsManager.removeModel', (node?: ModelTarget) => removeModel(store, config, tree, node)),
	);

	try {
		store.replaceAll(await config.loadProviders());
	} catch (error) {
		logExtensionError('Initial chatLanguageModels.json load', error);
	}
}

async function chooseProviderSort(tree: ModelsTreeProvider): Promise<void> {
	const current = tree.getSortState();
	const picked = await new Promise<ProviderSortState | undefined>(resolve => {
		const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { by: ProviderSortState['by'] }>();
		let direction = current.direction;
		let directionButton: vscode.QuickInputButton;
		const closeButton: vscode.QuickInputButton = {
			iconPath: new vscode.ThemeIcon('close'),
			tooltip: 'Close',
		};
		let settled = false;

		const render = (): void => {
			const ascending = direction === 'ascending';
			directionButton = {
				iconPath: new vscode.ThemeIcon(ascending ? 'arrow-up' : 'arrow-down'),
				tooltip: ascending ? 'Ascending — click for descending' : 'Descending — click for ascending',
			};
			quickPick.buttons = [directionButton, closeButton];
			quickPick.items = [
				{
					label: '$(clock) Time',
					description: [
						current.by === 'time' && current.direction === direction ? 'Current' : undefined,
						ascending ? 'Oldest first' : 'Newest first',
					].filter(Boolean).join(' · '),
					by: 'time',
				},
				{
					label: '$(symbol-text) Name',
					description: [
						current.by === 'name' && current.direction === direction ? 'Current' : undefined,
						ascending ? 'A–Z' : 'Z–A',
					].filter(Boolean).join(' · '),
					by: 'name',
				},
			];
		};

		const finish = (value: ProviderSortState | undefined): void => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(value);
			quickPick.hide();
		};

		quickPick.title = 'Sort Model Providers';
		quickPick.placeholder = 'Choose Time or Name; use the arrow button to change direction';
		quickPick.ignoreFocusOut = true;
		render();

		const disposables = [
			quickPick.onDidTriggerButton(button => {
				if (button === directionButton) {
					direction = direction === 'ascending' ? 'descending' : 'ascending';
					render();
				} else if (button === closeButton) {
					finish(undefined);
				}
			}),
			quickPick.onDidAccept(() => {
				const item = quickPick.selectedItems[0] ?? quickPick.activeItems[0];
				finish(item ? { by: item.by, direction } : undefined);
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

	if (picked) {
		await tree.setSortState(picked);
	}
}

function register(command: string, callback: (...args: any[]) => unknown): vscode.Disposable {
	return vscode.commands.registerCommand(command, async (...args: any[]) => {
		try {
			await callback(...args);
		} catch (error) {
			logExtensionError(command, error);
			if (!(error instanceof CopilotConfigError)) {
				const message = error instanceof Error ? error.message : String(error);
				void vscode.window.showErrorMessage(`Copilot Models Manager: ${message}`);
			}
		}
	});
}

function logExtensionError(scope: string, error: unknown): void {
	const message = error instanceof Error
		? `${error.name}: ${error.message}`
		: String(error);
	outputChannel?.appendLine(`[${new Date().toISOString()}] [${scope}] ${message}`);
	if (error instanceof Error && error.stack) {
		outputChannel?.appendLine(error.stack);
	}
}
