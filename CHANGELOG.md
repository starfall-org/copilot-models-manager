# Change Log

## 0.1.27

- Fixed the top-corner ✓ button on editor-style Quick Picks so it no longer activates the highlighted row.
- In **Add Provider** and **Add Model**, ✓ now performs the same validation/save flow as the explicit Save action and closes on success.
- In **Edit Provider** and **Edit Model**, ✓ now closes the editor because property changes are already applied when each field is edited.
- In the request-header list, ✓ saves the edited header set and closes, while ×/Esc cancels the header changes made during that editor session.
- In the single-header editor, ✓/× return to the header list; Enter on the `key` or `value` row is what opens that field.
- Pure selection Quick Picks such as API type and boolean selectors still use ✓ to accept the currently selected item.

## 0.1.26

- Reordered the model right-click menu into three groups.
- **Set/Unset Thinking** is now the first and highest-priority group.
- **Edit Model** and **Delete Model** share the second management group.
- **Copy Model ID** is isolated in the final group.

## 0.1.25

- Moved **Set Thinking / Unset Thinking** from model inline actions to the model right-click context menu.
- Model tree rows no longer expose inline actions.

## 0.1.24

- Moved **Copy Model ID** from the model inline action to the model right-click context menu.
- Set/Unset Thinking remains available as the inline model action.

## 0.1.23

- Replaced raw JSON editing for `requestHeaders` with a dedicated nested header editor across Add/Edit Provider and Add/Edit Model.
- The header list shows **Add Header** first, then each header with the key as the title and value as the description.
- Each existing header has inline **Edit** and **Delete** buttons.
- Editing a header opens a two-row Quick Pick for **key** and **value**.
- Clearing an existing header key deletes that header.
- Clearing a header value preserves the header and writes an empty string value.
- Adding a header prompts for key first, then value; empty values are allowed.
- Provider tree descriptions now show `N models` instead of `N selected`.

## 0.1.22

- Opening VS Code's **Manage Language Models** from Edit Provider no longer closes the Edit Provider menu; returning from the management UI resumes the provider editor.
- Added **Open Copilot Manage…** to the Add Provider draft editor.
- The Add Provider action requires a provider name first, then opens `workbench.action.chat.manage` filtered to that draft name without saving or discarding the draft.

## 0.1.21

- Hardened `chatLanguageModels.json` handling so entries from vendors other than `customendpoint` are treated as opaque and preserved.
- Foreign-vendor entries are preserved even if they use the same provider name or contain a field named `copilotModelsManager`.
- Unknown, malformed, null, or non-object array entries no longer crash provider loading or saving.
- Provider-name collision checks now ignore non-`customendpoint` vendors.
- Removed the automatic JSON rewrite during extension activation; opening the extension now only reads the file.
- Added a regression test covering preservation of foreign vendors and unknown entries.

## 0.1.20

- Added an inline **Copy Model ID** action to every model tree item.
- Clicking it copies the model ID directly to the clipboard without opening a Quick Pick.

## 0.1.19

- Standardized every Quick Pick to use explicit **✓ Accept** and **× Cancel** buttons, ordered left-to-right.
- The ✓ button behaves like Enter/Accept; the × button behaves like Esc/Cancel.
- Removed the custom Fetch Models select-all/unselect-all toolbar buttons because multi-select Quick Pick already provides model checkboxes.
- All Quick Picks continue to use `ignoreFocusOut: true`.

## 0.1.18

- **Fetch Models** is now available both as the inline provider action and in the provider right-click context menu.

## 0.1.17

- Moved **Copy API Key** from the provider inline action to the provider right-click context menu.
- Removed the duplicate Copy API Key entry from Edit Provider.

## 0.1.16

- Add Provider now opens a draft edit menu instead of prompting through fields sequentially.
- Add Model now opens the same style of full draft edit menu as Edit Model, with an explicit Save Model action.
- Draft Add screens keep changes in memory until Save; Esc from the main draft menu cancels creation without writing partial data.
- Every Quick Pick in the extension now explicitly uses `ignoreFocusOut: true`, including nested property pickers and Fetch Models.

## 0.1.15

- Added an inline **Copy API Key** action on provider tree items.
- Copy API Key reads the provider's discovery key from this extension's SecretStorage and copies it directly to the clipboard without revealing it in the UI.
- Added the same action inside the Edit Provider menu.

## 0.1.14

- Added a main toolbar button that opens VS Code's built-in **Manage Language Models** UI via `workbench.action.chat.manage`.

## 0.1.13

- Fixed managed provider rewrites deleting the existing `apiKey` field.
- The extension now treats `apiKey` as opaque configuration: if it exists in `chatLanguageModels.json`, its exact string value is preserved on every Add/Edit/Fetch/model update rewrite.
- The extension does not synthesize, normalize, replace, or remove an existing `apiKey` value.

## 0.1.12

- Added one-click inline **Set Thinking / Unset Thinking** actions on model tree items.
- Set Thinking writes `thinking: true` immediately; Unset Thinking removes the property immediately, with no confirmation or Quick Pick.
- Model tree context values now distinguish thinking-enabled models while preserving Edit/Delete context-menu actions.
- Unknown model context windows default to 128K; missing max-output metadata continues to use context-based fallbacks.

## 0.1.11

- Edit Provider and Edit Model now behave as nested menus: Esc in a child editor returns to the parent edit menu, while Esc in the parent menu closes it.
- Added **Update Copilot API Key…** on providers, opening VS Code's Manage Language Models page filtered to the selected provider.
- Added automatic `maxOutputTokens` fallbacks when provider metadata does not report one: 16K, 32K, 64K, or 128K depending on context size, with 16K used when context size is unknown.
- Existing managed models that lack `maxOutputTokens` are normalized on extension activation so the fallback is written to `chatLanguageModels.json` immediately.

## 0.1.10

- Never write plaintext provider API keys to `chatLanguageModels.json`.
- Preserve existing VS Code `${input:...}` API-key references exactly.
- Split credentials into a discovery key owned by this extension and a Copilot key owned by VS Code's Language Models secret store.
- Renamed provider credential actions to **Discovery API Key** to make that distinction explicit.
- Removed the obsolete setting that allowed writing raw API keys into the Copilot configuration.
- Provider tooltips now show whether a Copilot API-key reference is bound.

## 0.1.9

- Fixed model context-menu actions so **Edit Model** and **Delete Model** receive the clicked tree model directly.
- Context-menu model actions no longer fall back to provider/model selection Quick Picks.
- The resolver now refreshes the clicked model from the current JSON-backed store before editing or deleting it.

## 0.1.8

- Removed the manual **Sync with GitHub Copilot** command and toolbar action.
- Made `chatLanguageModels.json` the single source of truth for provider/model configuration.
- Removed provider/model persistence from VS Code `globalState`; the extension now keeps only an in-memory cache plus SecretStorage for credentials.
- Managed provider metadata such as base URL and model-list endpoint is stored inside the same `customendpoint` JSON group.
- Providers are loaded directly from `chatLanguageModels.json` on extension activation.
- External changes to `chatLanguageModels.json` are watched and reloaded into the tree automatically.
- Every provider/model Add, Edit, Delete, and Fetch Models operation writes the JSON file immediately.
- Providers with zero selected models remain in the JSON with an empty `models` array.

## 0.1.7

- Added explicit **Edit Model** and **Delete Model** entries to the model context menu.
- Expanded per-model editing to cover the current Custom Endpoint model configuration fields supported by VS Code.
- Edit Model now opens a property picker first, then edits only the selected key.
- Added per-model overrides for URL and API type while retaining provider-level defaults.
- Added editing for thinking budgets, adaptive thinking, streaming, edit tools, ZDR, reasoning effort, model options, and request headers.

## 0.1.6

- Removed the Models webview entirely.
- Providers are now native expandable tree nodes, with only selected models shown as children.
- Added a provider-level **Fetch Models** action that opens a persistent native multi-select Quick Pick.
- Fetch Models includes native search plus **Select all visible** and **Unselect visible** actions.
- Model selection in the popup controls which models appear under the provider and which models are synced to Copilot.
- Adding a provider no longer fetches models automatically.

## 0.1.5

- Made all input boxes and quick-pick dialogs persistent when focus moves elsewhere by enabling `ignoreFocusOut` consistently.

## 0.1.4

- Fixed extension activation failure caused by an incomplete bundled `jsonc-parser` dependency (`Cannot find module './impl/format'`).
- Replaced the runtime dependency with an internal JSONC normalizer, keeping the VSIX self-contained.
- `Add Provider` now registers normally as soon as the extension activates.

## 0.1.3

- Hide the Models view when no providers exist, avoiding an empty webview loading state.
- Models remain scoped to the currently selected provider rather than combining all providers.

## 0.1.2

- Added an original SVG icon using a Copilot-adjacent cyan, blue, violet, and magenta palette.
- Uses the SVG directly for the Secondary Side Bar container.
- Includes a PNG rasterized from the SVG for the VS Code Marketplace extension icon.

## 0.1.1

- Reworked model selection around persistent checkboxes in the sidebar.
- Added a dedicated Models view with provider selector and live model search.
- Added Select all visible and Unselect visible actions that only affect the current search result.
- Unchecked models are removed from Copilot configuration while remaining in the provider catalog for quick re-selection.
- Newly discovered models are added unchecked; refresh preserves existing selections.
- Providers with no selected models are omitted from `chatLanguageModels.json`.

## 0.1.0

- Added a Secondary Side Bar provider/model manager.
- Added Custom Endpoint support for Chat Completions, Responses, and Messages APIs.
- Added provider-level base URL management with automatic per-model endpoint generation.
- Added authenticated model discovery and model selection.
- Added provider and model editing, refresh, manual model entry, and removal flows.
- Added synchronization to VS Code's `chatLanguageModels.json` while preserving unmanaged provider groups.
- Added SecretStorage for provider discovery credentials.
- Added local UI extension placement for Remote SSH compatibility.