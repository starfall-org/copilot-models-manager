# Copilot Models Manager

Copilot Models Manager is a VS Code UI layer for managing GitHub Copilot **Custom Endpoint** models.

The extension does **not** implement its own language-model runtime. It discovers provider models, lets you choose and configure them, and writes the resulting entries to VS Code's `chatLanguageModels.json`. GitHub Copilot / VS Code then handles requests, streaming, tools, agent integration, and model execution through the built-in `customendpoint` provider.

## Features

- Dedicated **Copilot Models** view container in the **Secondary Side Bar**, beside Chat/Copilot.
- Add a provider once with:
  - display name
  - API type
  - base URL
  - API key
- Supported Custom Endpoint API types:
  - Chat Completions
  - Responses
  - Messages
- Automatically discovers models from the provider model-list endpoint.
- Dedicated **Models** view with persistent checkboxes for deciding which models are exposed to Copilot.
- Live model search by display name or model ID.
- **Select all visible** and **Unselect visible** only affect models matching the current search.
- Refresh a provider later to pick up newly available models. Newly discovered models start unchecked, while existing selections are preserved.
- Add model IDs manually when a provider does not expose a compatible model-list endpoint.
- Edit per-model capabilities:
  - tool calling
  - vision
  - thinking
  - context window
  - max input/output tokens
  - model options
- Configure a model-list endpoint override and shared request headers per provider.
- Stores the provider base URL only once in this extension. During sync, the extension generates the URL that Copilot requires on each model entry.
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

The extension keeps its own provider definitions and writes managed groups as:

```json
{
  "name": "My Gateway",
  "vendor": "customendpoint",
  "apiType": "responses",
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

Existing groups that are not managed by this extension are preserved. Unchecked models are omitted from the managed Copilot group but stay in the provider catalog so they can be checked again later. If a provider has no selected models, its managed group is removed from `chatLanguageModels.json`.

## API keys

The extension keeps its model-discovery copy of each key in VS Code `SecretStorage`.

By default it also writes the key into `chatLanguageModels.json` so that the user enters the key only once and Copilot can use the model immediately.

If you do not want the key written to the JSON file, disable:

```text
Copilot Models Manager: Write Api Key To Copilot Config
```

In that mode the generated Copilot configuration uses an `${input:...}` secret placeholder and VS Code may ask for the key again when Copilot first uses that provider.

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
- Copilot Models: Sync with GitHub Copilot
- Copilot Models: Open chatLanguageModels.json

Provider and model-specific actions are available from each tree item's context menu.

## Runtime ownership

Copilot Models Manager intentionally stops at configuration management. After sync, inference is performed by VS Code/GitHub Copilot's built-in Custom Endpoint provider rather than by this extension.