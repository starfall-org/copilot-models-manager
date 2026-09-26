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
	const isCurrent = (state: ProviderSortState): boolean =>
		current.by === state.by && current.direction === state.direction;
	const options: Array<vscode.QuickPickItem & { state: ProviderSortState }> = [
		{
			label: '$(clock) Time — Descending',
			description: (isCurrent({ by: 'time', direction: 'descending' }) ? 'Current · ' : '') + 'Newest first',
			state: { by: 'time', direction: 'descending' },
		},
		{
			label: '$(clock) Time — Ascending',
			description: (isCurrent({ by: 'time', direction: 'ascending' }) ? 'Current · ' : '') + 'Oldest first',
			state: { by: 'time', direction: 'ascending' },
		},
		{
			label: '$(symbol-text) Name — Ascending',
			description: (isCurrent({ by: 'name', direction: 'ascending' }) ? 'Current · ' : '') + 'A–Z',
			state: { by: 'name', direction: 'ascending' },
		},
		{
			label: '$(symbol-text) Name — Descending',
			description: (isCurrent({ by: 'name', direction: 'descending' }) ? 'Current · ' : '') + 'Z–A',
			state: { by: 'name', direction: 'descending' },
		},
	];
	const picked = await vscode.window.showQuickPick(options, {
		title: 'Sort Model Providers',
		placeHolder: 'Choose field and direction',
		ignoreFocusOut: true,
	});
	if (picked) {
		await tree.setSortState(picked.state);
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
