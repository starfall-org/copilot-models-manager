# Copilot Models Manager

Copilot Models Manager is a VS Code UI layer for managing GitHub Copilot **Custom Endpoint** models.

The extension does **not** implement its own language-model runtime. It discovers provider models, lets you choose and configure them, and writes the resulting entries to VS Code's `chatLanguageModels.json`. GitHub Copilot / VS Code then handles requests, streaming, tools, agent integration, and model execution through the built-in `customendpoint` provider.

## Features

- Dedicated **Copilot Models** view container in the **Secondary Side Bar**, beside Chat/Copilot.
- Add Provider opens a draft editor where fields can be changed in any order and saved explicitly.
- Add a provider with:
  - display name
  - API type
  - base URL
  - API key
- Supported Custom Endpoint API types:
  - Chat Completions
  - Responses
  - Messages
- Each provider is a native expandable VS Code tree node; only selected models are shown beneath that provider.
- Use **Fetch Models** on a provider to query its model-list endpoint and open a persistent native multi-select Quick Pick.
- The Fetch Models popup has native search, model checkboxes, and **Select all visible / Unselect visible** toolbar actions.
- All Quick Picks use `ignoreFocusOut`, so clicking elsewhere does not dismiss them.
- Newly discovered models start unchecked, while existing selections are preserved.
- Add model IDs manually when a provider does not expose a compatible model-list endpoint. Add Model opens the full model draft editor and writes nothing until **Save Model** is chosen.
- Edit Provider and Edit Model use nested native pickers: Esc in a child editor returns to the parent edit menu; Esc in the parent menu closes it.
- Models expose an inline one-click **Set Thinking / Unset Thinking** action. It writes `thinking: true` or removes the `thinking` property immediately without confirmation.
- Edit per-model capabilities:
  - tool calling
  - vision
  - thinking
  - context window
  - max input/output tokens
  - model options
- Configure a model-list endpoint override and shared request headers per provider.
- When context size is unknown, the extension defaults `contextWindow` to 128K. When `maxOutputTokens` is missing, it supplies 16K, 32K, 64K, or 128K based on context size (a 128K context defaults to 32K output).
- Stores the provider base URL once in the provider metadata inside `chatLanguageModels.json`; model request URLs are generated automatically whenever the file is updated.
- Runs as a UI extension so Remote SSH/workspace placement does not move provider management onto the remote host.

## How model URLs are generated

A provider base URL such as:

```text
https://gateway.example.com
```

is expanded according to the selected API type:

```text
Chat Completions -> https://gateway.example.com/v1/chat/completions
Responses        -> https://gateway.example.com/v1/responses
Messages         -> https://gateway.example.com/v1/messages
```

If the base URL already ends in a version segment such as `/v1`, the API path is appended directly.

If the URL already contains one of the supported request paths, the path is switched to the selected API type instead of being duplicated.

## Model discovery

By default the extension derives the model-list URL from the provider base URL:

```text
https://gateway.example.com      -> https://gateway.example.com/v1/models
https://gateway.example.com/v1   -> https://gateway.example.com/v1/models
```

You can override this per provider with **Edit Provider → Set Model List Endpoint**.

The discovery parser supports common response shapes including:

```json
{ "data": [ ... ] }
```

```json
{ "models": [ ... ] }
```

and a top-level array.

When providers return capability metadata, the extension imports common context-window, tool, vision, output-token, and reasoning hints. Unknown capabilities remain editable in the tree.

## Copilot configuration

`chatLanguageModels.json` is the source of truth. The extension does not persist a second provider/model database. On activation it loads supported `customendpoint` providers from that file, and every Add/Edit/Delete/Fetch Models action writes the updated configuration immediately.

Provider-level manager metadata is stored inside the same group so a provider can keep one base URL and can exist even with zero selected models. A managed group looks like:

```json
{
  "name": "My Gateway",
  "vendor": "customendpoint",
  "apiType": "responses",
  "copilotModelsManager": {
    "id": "provider-id",
    "baseUrl": "https://gateway.example.com/v1",
    "createdAt": 0,
    "updatedAt": 0
  },
  "models": [
    {
      "id": "example-model",
      "name": "example-model",
      "url": "https://gateway.example.com/v1/responses",
      "toolCalling": true,
      "vision": false
    }
  ]
}
```

Existing non-managed groups are preserved. Other vendors are treated as opaque configuration: the extension does not load, edit, remove, rename, or use them for provider-name collision checks. The JSON stores only the selected models; **Fetch Models** queries the provider again whenever you want to change the selection. A provider with zero selected models remains in the file with `models: []`, so its base URL and discovery settings are not lost.

## API keys

There are two separate secret stores involved:

- **Discovery API Key**: stored in this extension's VS Code `SecretStorage` and used only when **Fetch Models** calls the provider's model-list endpoint.
- **Copilot API Key**: owned by VS Code's Language Models subsystem. `chatLanguageModels.json` stores only an input reference such as `${input:chat.lm.secret.cef88b1}`.

The extension treats the existing `apiKey` field in `chatLanguageModels.json` as opaque configuration. If the field already exists, its exact value is preserved on every rewrite; the extension does not normalize, replace, or delete it.

For a newly added provider, use **Update Copilot API Key…** from the provider context menu. The extension opens VS Code's **Manage Language Models** page filtered to that provider; choose **Update API Key** there. VS Code stores that key in its own secure storage and updates `chatLanguageModels.json` with the secret reference. The extension's file watcher then reloads and preserves that reference on every later edit.

VS Code's public extension API does not expose a supported way for one extension to seed the built-in Language Models secret store directly, so this one-time binding cannot safely be replaced with this extension's own `SecretStorage`.

## VS Code profiles and custom user-data directories

The public VS Code extension API does not expose the active profile's configuration directory.

The extension automatically resolves the standard desktop locations for:

- VS Code
- VS Code Insiders
- VSCodium
- Code - OSS
- VS Code Portable Mode

For a custom Profile or `--user-data-dir`, set:

```text
Copilot Models Manager: Chat Language Models Path
```

to the exact `chatLanguageModels.json` path for that profile.

## Commands

Use the **Copilot Models** view toolbar or Command Palette:

- Copilot Models: Add Provider
- Copilot Models: Refresh All Providers
- Copilot Models: Open chatLanguageModels.json

Provider and model-specific actions are available from each tree item's context menu.

## Runtime ownership

Copilot Models Manager intentionally stops at configuration management. Once an edit is written to `chatLanguageModels.json`, inference is performed by VS Code/GitHub Copilot's built-in Custom Endpoint provider rather than by this extension.

### Header editor

Provider and model `requestHeaders` are edited through a dedicated Quick Pick UI instead of raw JSON. The list shows **Add Header** first, followed by each header key and value with inline Edit/Delete actions. Editing exposes separate `key` and `value` rows. Clearing a key deletes the header; clearing only the value keeps the header with an empty-string value.
