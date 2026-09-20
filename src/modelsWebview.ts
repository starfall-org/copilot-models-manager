import * as vscode from 'vscode';
import { CopilotConfigService } from './copilotConfig';
import { ProviderStore } from './providerStore';

interface WebviewMessage {
	type: string;
	providerId?: string;
	modelId?: string;
	modelIds?: string[];
	enabled?: boolean;
}

export class ModelsWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	private view: vscode.WebviewView | undefined;
	private selectedProviderId: string | undefined;
	private readonly subscriptions: vscode.Disposable[] = [];

	constructor(
		private readonly store: ProviderStore,
		private readonly config: CopilotConfigService,
	) {
		this.subscriptions.push(this.store.onDidChange(() => void this.postState()));
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = { enableScripts: true };
		view.webview.html = this.html(view.webview);

		this.subscriptions.push(
			view.webview.onDidReceiveMessage(message => void this.handleMessage(message as WebviewMessage)),
		);

		void this.postState();
	}

	dispose(): void {
		for (const disposable of this.subscriptions) {
			disposable.dispose();
		}
		this.subscriptions.length = 0;
	}

	private async handleMessage(message: WebviewMessage): Promise<void> {
		try {
			switch (message.type) {
				case 'ready':
					await this.postState();
					return;
				case 'selectProvider':
					this.selectedProviderId = message.providerId;
					await this.postState();
					return;
				case 'toggleModel':
					if (message.providerId && message.modelId && typeof message.enabled === 'boolean') {
						await this.setEnabled(message.providerId, [message.modelId], message.enabled);
					}
					return;
				case 'setVisible':
					if (message.providerId && Array.isArray(message.modelIds) && typeof message.enabled === 'boolean') {
						await this.setEnabled(message.providerId, message.modelIds, message.enabled);
					}
					return;
				case 'editModel':
					if (message.providerId && message.modelId) {
						await vscode.commands.executeCommand('copilotModelsManager.editModel', {
							providerId: message.providerId,
							modelId: message.modelId,
						});
					}
					return;
			}
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Copilot Models Manager: ${text}`);
		}
	}

	private async setEnabled(providerId: string, modelIds: string[], enabled: boolean): Promise<void> {
		const provider = this.store.getProvider(providerId);
		if (!provider || modelIds.length === 0) {
			return;
		}

		const target = new Set(modelIds);
		let changed = false;
		const models = provider.models.map(model => {
			if (!target.has(model.id) || (model.enabled !== false) === enabled) {
				return model;
			}
			changed = true;
			return { ...model, enabled };
		});
		if (!changed) {
			return;
		}

		await this.store.saveProvider({ ...provider, models, updatedAt: Date.now() });
		await this.config.sync(this.store.getProviders());
	}

	private async postState(): Promise<void> {
		if (!this.view) {
			return;
		}

		const providers = this.store.getProviders();
		if (!this.selectedProviderId || !providers.some(provider => provider.id === this.selectedProviderId)) {
			this.selectedProviderId = providers[0]?.id;
		}
		const provider = providers.find(item => item.id === this.selectedProviderId);

		await this.view.webview.postMessage({
			type: 'state',
			selectedProviderId: this.selectedProviderId,
			providers: providers.map(item => ({
				id: item.id,
				name: item.name,
				selected: item.models.filter(model => model.enabled !== false).length,
				total: item.models.length,
			})),
			models: provider?.models.map(model => ({
				id: model.id,
				name: model.name,
				enabled: model.enabled !== false,
				toolCalling: model.toolCalling,
				vision: model.vision,
				thinking: model.thinking === true,
				contextWindow: model.contextWindow,
				maxOutputTokens: model.maxOutputTokens,
			})) ?? [],
		});
	}

	private html(webview: vscode.Webview): string {
		const nonce = getNonce();
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<style>
		:root { color-scheme: light dark; }
		body {
			padding: 10px;
			color: var(--vscode-foreground);
			background: var(--vscode-sideBar-background);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
		}
		.toolbar, .actions {
			display: flex;
			gap: 6px;
			align-items: center;
		}
		.toolbar { margin-bottom: 8px; }
		select, input[type="search"] {
			width: 100%;
			box-sizing: border-box;
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border, transparent);
			padding: 5px 7px;
			outline: none;
		}
		select:focus, input[type="search"]:focus {
			border-color: var(--vscode-focusBorder);
		}
		.search { margin-bottom: 8px; }
		button {
			border: 1px solid var(--vscode-button-border, transparent);
			color: var(--vscode-button-foreground);
			background: var(--vscode-button-background);
			padding: 4px 8px;
			cursor: pointer;
			white-space: nowrap;
		}
		button:hover { background: var(--vscode-button-hoverBackground); }
		button.secondary {
			color: var(--vscode-button-secondaryForeground);
			background: var(--vscode-button-secondaryBackground);
		}
		button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
		.summary {
			margin: 7px 0;
			color: var(--vscode-descriptionForeground);
			font-size: 0.92em;
		}
		.model {
			display: grid;
			grid-template-columns: min-content minmax(0, 1fr) min-content;
			gap: 7px;
			align-items: start;
			padding: 7px 2px;
			border-bottom: 1px solid var(--vscode-tree-tableColumnsBorder, rgba(128,128,128,.2));
		}
		.model.hidden { display: none; }
		.model input { margin-top: 3px; }
		.model-main { min-width: 0; }
		.model-name {
			overflow-wrap: anywhere;
			font-weight: 500;
		}
		.model-id, .model-meta {
			color: var(--vscode-descriptionForeground);
			font-size: 0.88em;
			overflow-wrap: anywhere;
		}
		.model-id { margin-top: 2px; }
		.edit {
			background: transparent;
			color: var(--vscode-foreground);
			padding: 2px 5px;
			border: none;
		}
		.edit:hover { background: var(--vscode-toolbar-hoverBackground); }
		.empty {
			padding: 16px 4px;
			color: var(--vscode-descriptionForeground);
			text-align: center;
		}
	</style>
</head>
<body>
	<div class="toolbar">
		<select id="provider" aria-label="Provider"></select>
	</div>
	<div class="search">
		<input id="search" type="search" placeholder="Search models..." aria-label="Search models">
	</div>
	<div class="actions">
		<button id="selectVisible">Select all visible</button>
		<button id="clearVisible" class="secondary">Unselect visible</button>
	</div>
	<div id="summary" class="summary"></div>
	<div id="models"></div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const providerSelect = document.getElementById('provider');
		const searchInput = document.getElementById('search');
		const modelsElement = document.getElementById('models');
		const summaryElement = document.getElementById('summary');
		const selectVisible = document.getElementById('selectVisible');
		const clearVisible = document.getElementById('clearVisible');
		let state = { providers: [], models: [], selectedProviderId: undefined };

		window.addEventListener('message', event => {
			if (event.data?.type !== 'state') return;
			state = event.data;
			render();
		});

		providerSelect.addEventListener('change', () => {
			vscode.postMessage({ type: 'selectProvider', providerId: providerSelect.value });
		});

		searchInput.addEventListener('input', applyFilter);

		selectVisible.addEventListener('click', () => setVisible(true));
		clearVisible.addEventListener('click', () => setVisible(false));

		function render() {
			const previous = providerSelect.value;
			providerSelect.replaceChildren();
			for (const provider of state.providers) {
				const option = document.createElement('option');
				option.value = provider.id;
				option.textContent = provider.name + ' (' + provider.selected + '/' + provider.total + ')';
				option.selected = provider.id === state.selectedProviderId;
				providerSelect.appendChild(option);
			}

			providerSelect.disabled = state.providers.length === 0;
			searchInput.disabled = state.providers.length === 0;
			selectVisible.disabled = state.providers.length === 0;
			clearVisible.disabled = state.providers.length === 0;

			modelsElement.replaceChildren();
			if (state.providers.length === 0) {
				summaryElement.textContent = '';
				const empty = document.createElement('div');
				empty.className = 'empty';
				empty.textContent = 'Add a provider first.';
				modelsElement.appendChild(empty);
				return;
			}

			if (state.models.length === 0) {
				summaryElement.textContent = '0 models';
				const empty = document.createElement('div');
				empty.className = 'empty';
				empty.textContent = 'No models found. Refresh the provider or add a model manually.';
				modelsElement.appendChild(empty);
				return;
			}

			for (const model of state.models) {
				const row = document.createElement('div');
				row.className = 'model';
				row.dataset.search = (model.name + '\n' + model.id).toLocaleLowerCase();
				row.dataset.modelId = model.id;

				const checkbox = document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.checked = model.enabled;
				checkbox.setAttribute('aria-label', 'Expose ' + model.name + ' in Copilot');
				checkbox.addEventListener('change', () => {
					vscode.postMessage({
						type: 'toggleModel',
						providerId: state.selectedProviderId,
						modelId: model.id,
						enabled: checkbox.checked,
					});
				});

				const main = document.createElement('div');
				main.className = 'model-main';

				const name = document.createElement('div');
				name.className = 'model-name';
				name.textContent = model.name;
				main.appendChild(name);

				if (model.id !== model.name) {
					const id = document.createElement('div');
					id.className = 'model-id';
					id.textContent = model.id;
					main.appendChild(id);
				}

				const metaValues = [];
				if (model.toolCalling) metaValues.push('tools');
				if (model.vision) metaValues.push('vision');
				if (model.thinking) metaValues.push('thinking');
				if (model.contextWindow) metaValues.push(model.contextWindow.toLocaleString() + ' context');
				if (model.maxOutputTokens) metaValues.push(model.maxOutputTokens.toLocaleString() + ' output');
				if (metaValues.length) {
					const meta = document.createElement('div');
					meta.className = 'model-meta';
					meta.textContent = metaValues.join(' · ');
					main.appendChild(meta);
				}

				const edit = document.createElement('button');
				edit.className = 'edit';
				edit.type = 'button';
				edit.title = 'Edit model';
				edit.textContent = '⋯';
				edit.addEventListener('click', () => {
					vscode.postMessage({
						type: 'editModel',
						providerId: state.selectedProviderId,
						modelId: model.id,
					});
				});

				row.append(checkbox, main, edit);
				modelsElement.appendChild(row);
			}
			applyFilter();
		}

		function visibleRows() {
			return [...modelsElement.querySelectorAll('.model:not(.hidden)')];
		}

		function applyFilter() {
			const query = searchInput.value.trim().toLocaleLowerCase();
			for (const row of modelsElement.querySelectorAll('.model')) {
				row.classList.toggle('hidden', Boolean(query) && !row.dataset.search.includes(query));
			}
			updateSummary();
		}

		function updateSummary() {
			const visible = visibleRows();
			const checkedVisible = visible.filter(row => row.querySelector('input[type="checkbox"]').checked).length;
			const selected = state.models.filter(model => model.enabled).length;
			summaryElement.textContent =
				visible.length + ' visible · ' + checkedVisible + ' visible selected · ' +
				selected + '/' + state.models.length + ' selected';
		}

		function setVisible(enabled) {
			const rows = visibleRows();
			const ids = rows.map(row => row.dataset.modelId);
			for (const row of rows) {
				row.querySelector('input[type="checkbox"]').checked = enabled;
			}
			updateSummary();
			vscode.postMessage({
				type: 'setVisible',
				providerId: state.selectedProviderId,
				modelIds: ids,
				enabled,
			});
		}

		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
	}
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let value = '';
	for (let index = 0; index < 32; index += 1) {
		value += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return value;
}
