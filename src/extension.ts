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
	const initialSortState = tree.getSortState();
	await vscode.commands.executeCommand(
		'setContext',
		'copilotModelsManager.sortDirection',
		initialSortState.directions[initialSortState.by],
	);

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
		register('copilotModelsManager.sortProvidersAscending', () => chooseProviderSort(tree)),
		register('copilotModelsManager.sortProvidersDescending', () => chooseProviderSort(tree)),
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
	type SortItem = vscode.QuickPickItem & { by: ProviderSortState['by'] };

	let current = tree.getSortState();
	const quickPick = vscode.window.createQuickPick<SortItem>();
	const closeButton: vscode.QuickInputButton = {
		iconPath: new vscode.ThemeIcon('close'),
		tooltip: 'Close',
	};

	const directionButtonFor = (by: ProviderSortState['by']): vscode.QuickInputButton => {
		const direction = current.directions[by];
		return {
			iconPath: new vscode.ThemeIcon(direction === 'ascending' ? 'arrow-up' : 'arrow-down'),
			tooltip: direction === 'ascending'
				? 'Ascending — click to switch to descending'
				: 'Descending — click to switch to ascending',
		};
	};

	const render = (): void => {
		const timeDirection = current.directions.time;
		const nameDirection = current.directions.name;
		const quantityDirection = current.directions.quantity;
		quickPick.items = [
			{
				label: '$(clock) Time',
				description: `${current.by === 'time' ? 'Current · ' : ''}${timeDirection === 'ascending' ? 'Oldest first' : 'Newest first'}`,
				buttons: [directionButtonFor('time')],
				by: 'time',
			},
			{
				label: '$(symbol-text) Name',
				description: `${current.by === 'name' ? 'Current · ' : ''}${nameDirection === 'ascending' ? 'A–Z' : 'Z–A'}`,
				buttons: [directionButtonFor('name')],
				by: 'name',
			},
			{
				label: '$(symbol-numeric) Quantity',
				description: `${current.by === 'quantity' ? 'Current · ' : ''}${quantityDirection === 'ascending' ? 'Fewest first' : 'Most first'}`,
				buttons: [directionButtonFor('quantity')],
				by: 'quantity',
			},
		];
		const activeItem = quickPick.items.find(item => item.by === current.by);
		quickPick.activeItems = activeItem ? [activeItem] : [];
	};

	const applySort = async (
		by: ProviderSortState['by'],
		direction: ProviderSortState['directions'][ProviderSortState['by']],
	): Promise<void> => {
		const nextState: ProviderSortState = {
			by,
			directions: {
				...current.directions,
				[by]: direction,
			},
		};
		await tree.setSortState(nextState);
		current = tree.getSortState();
		await vscode.commands.executeCommand('setContext', 'copilotModelsManager.sortDirection', current.directions[current.by]);
		render();
	};

	quickPick.title = 'Sort Model Providers';
	quickPick.placeholder = 'Select a sort type or click its arrow to reverse its direction';
	quickPick.ignoreFocusOut = true;
	quickPick.buttons = [closeButton];
	render();

	const disposables = [
		quickPick.onDidTriggerButton(button => {
			if (button === closeButton) {
				quickPick.hide();
			}
		}),
		quickPick.onDidTriggerItemButton(event => {
			const currentDirection = current.directions[event.item.by];
			const nextDirection = currentDirection === 'ascending' ? 'descending' : 'ascending';
			void applySort(event.item.by, nextDirection);
		}),
		quickPick.onDidAccept(() => {
			const item = quickPick.selectedItems[0] ?? quickPick.activeItems[0];
			if (item) {
				void applySort(item.by, current.directions[item.by]);
			}
		}),
		quickPick.onDidHide(() => {
			for (const disposable of disposables) {
				disposable.dispose();
			}
			quickPick.dispose();
		}),
	];

	quickPick.show();
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
