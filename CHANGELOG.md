# Change Log

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
