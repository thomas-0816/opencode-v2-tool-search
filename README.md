# opencode-v2-tool-search

An OpenCode V2 plugin that defers tool descriptions and exposes them on demand
through BM25 or regex search.

This is a V2 port of the V1 plugin
[`opencode-tool-search`](https://github.com/M0Rf30/opencode-tool-search). It uses
the V2 plugin API, so no core changes are needed.

## Why

OpenCode sends every tool description and parameter schema with every model
request. With many built-in or MCP tools, those descriptions can consume
thousands of tokens per turn.

This plugin keeps only two small search tools fully described. Every other tool
is marked `[d]` in the request. When the model needs one, it calls `tool_search`
or `tool_search_regex` and gets the full description and JSON Schema back.

## How it works

- The `context` hook captures the exact tool list for the request.
- Tools not in `alwaysLoad` get the description `[d]`.
- With `stripParameters` enabled (the default), deferred tools also get an empty
  parameter schema.
- With `compact` enabled (the default), always-loaded tools use short
  descriptions and lose parameter descriptions while keeping names, types, and
  required fields.
- The built-in worktree/`session_move` hint is removed from the system prompt by
  default.
- `tool_search` ranks tools with BM25 over names and descriptions.
- `tool_search_regex` matches tool names and descriptions with a case-insensitive
  regex.
- Search results include the full description, a parameter summary, and the full
  JSON Schema.
- The same transformation runs for `context`, `compaction`, and `generate`
  requests.

The actual tool definitions are unchanged. Only the copy sent to the model is
reduced, so tool execution and validation still use the real schemas.

## Install

### Local directory

Clone this repository and point `plugins` at it:

opencode.json:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["<path-to-plugin>/opencode-v2-tool-search"],
}
```

Local plugin paths must name a directory. A path relative to the config file or
an absolute path both work.

You can also copy the plugin into `.opencode/plugins/tool-search/` and let
OpenCode discover it automatically. In that case it uses the default options
below.

### From GitHub

Clone the repository and point `plugins` at the clone:

```sh
git clone git@github.com:thomas-0816/opencode-v2-tool-search.git
```

```jsonc
{
  "plugins": ["<path-to-plugin>/opencode-v2-tool-search"],
}
```

The package is not published to npm yet. Once it is, add
`"opencode-v2-tool-search"` to `plugins` and let OpenCode install it.

## Example: llama.cpp

This configuration was used to test the plugin with a local `llama.cpp` server.
It restricts provider use to `llama.cpp`, asks before shell/edit/web actions and
before reading outside the project, disables Code Mode and several built-in
tools, and loads the plugin from `../opencode-v2-tool-search`. Adjust the
`baseURL`, model limits, and plugin path for your setup.

opencode.json:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "lsp": false,
  "snapshots": false,
  "share": "disabled",
  "policies": [
    { "action": "provider.use", "resource": "*", "effect": "deny" },
    { "action": "provider.use", "resource": "llama.cpp", "effect": "allow" }
  ],
  "permissions": [
    { "action": "external_directory", "resource": "*", "effect": "ask" },
    { "action": "shell", "resource": "*", "effect": "ask" },
    { "action": "edit", "resource": "*", "effect": "ask" },
    { "action": "web*", "resource": "*", "effect": "ask" },
    { "action": "todowrite", "resource": "*", "effect": "deny" },
    { "action": "skill", "resource": "*", "effect": "deny" },
    { "action": "subagent", "resource": "*", "effect": "deny" },
    { "action": "read", "resource": "*.env*", "effect": "deny" },
    { "action": "execute", "resource": "*", "effect": "deny" },
    { "action": "opencode_*", "resource": "*", "effect": "deny" }
  ],
  "plugins": ["../opencode-v2-tool-search"],
  "agents": {
    "build": { "system": "A helpful software assistant." },
    "plan": { "system": "A helpful software assistant." },
    "title": { "disabled": true },
    "summary": { "disabled": true }
  },
  "providers": {
    "llama.cpp": {
      "package": "aisdk:@ai-sdk/openai-compatible",
      "name": "Llama.cpp",
      "settings": { "baseURL": "http://127.0.0.1:9931/v1" },
      "models": {
        "default": {
          "name": "Default",
          "limit": { "context": 131072, "output": 131072 },
          "body": { "chat_template_kwargs": { "enable_thinking": false } },
          "variants": [
            {
              "id": "thinking",
              "body": {
                "chat_template_kwargs": {
                  "enable_thinking": true,
                  "preserve_thinking": true
}}}]}}}}}
```

### Example server commands

The plugin was tested with these local `llama.cpp` servers. Adjust the model
files and paths for your setup.

**Qwen3.6 35B A3B**

```sh
./llama-server -hf unsloth/Qwen3.6-35B-A3B-MTP-GGUF:UD-Q4_K_XL \
  --parallel 1 --ctx-size 131072 --predict 131072 --ubatch-size 1024 \
  --temp 0.6 --min-p 0.0 --top-p 0.95 --top-k 20 --no-mmproj \
  --cache-type-k q8_0 --cache-type-v q8_0 --load-mode dio --spec-type draft-mtp
```

**Qwen3.8 27B**

```sh
./llama-server -hf unsloth/Qwen3.8-27B-GGUF:Q4_K_XL \
  --parallel 1 --ctx-size 131072 --predict 131072 --ubatch-size 1024 \
  --temp 0.7 --min-p 0.0 --top-p 0.8 --top-k 20 --presence-penalty 1.5 --no-mmproj \
  --cache-type-k q8_0 --cache-type-v q8_0 --load-mode dio --spec-type draft-mtp
```

**Gemma4 26B A4B**

```sh
./llama-server -hf unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL \
  --parallel 1 --ctx-size 131072 --predict 131072 --ubatch-size 1024 \
  --temp 1.0 --top-p 0.95 --top-k 64 --no-mmproj \
  --cache-type-k q8_0 --cache-type-v q8_0 --load-mode dio --spec-type draft-mtp
```

**Mellum2 12B A2.5B**

```sh
./llama-server -hf JetBrains/Mellum2-12B-A2.5B-Thinking-GGUF-Q4_K_M \
  --parallel 1 --ctx-size 131072 --predict 131072 --ubatch-size 1024 \
  --temp 0.6 --top-p 0.95 --top-k 20 --cache-type-k q8_0 \
  --cache-type-v q8_0 --load-mode dio
```

## Options

| Option               | Type       | Default | Description                                                              |
| -------------------- | ---------- | ------- | ------------------------------------------------------------------------ |
| `alwaysLoad`         | `string[]` | `[]`    | Tool IDs that keep their full description and schema.                    |
| `searchLimit`        | `number`   | `5`     | Maximum number of results returned by a search.                          |
| `deferDescription`   | `string`   | `"[d]"` | Stub description used for deferred tools.                                |
| `stripParameters`    | `boolean`  | `true`  | Replace deferred tools' parameter schema with an empty object.           |
| `includeSchema`      | `boolean`  | `true`  | Include the full JSON Schema in search results.                          |
| `compact`            | `boolean`  | `true`  | Shorten always-loaded tools and strip their parameter descriptions.      |
| `descriptions`       | `object`   | `{}`    | Override compact descriptions by tool ID.                                |
| `removeWorktreeHint` | `boolean`  | `true`  | Remove the built-in worktree/`session_move` hint from the system prompt. |
| `bm25.k1`            | `number`   | `0.9`   | BM25 term-frequency saturation.                                          |
| `bm25.b`             | `number`   | `0.4`   | BM25 document-length normalization.                                      |

If a model tends to call deferred tools without searching first, add the tools
it uses most to `alwaysLoad`:

```jsonc
{
  "options": {
    "alwaysLoad": ["read", "edit", "write", "shell", "glob", "grep"],
  },
}
```

`removeWorktreeHint` only affects the system prompt. Set it to `false` if you
use the built-in worktree tools and want the guidance kept.

## Token savings

Measured on OpenCode 2.2.3 with a local `llama.cpp` server running Mellum2 12B
A2.5B and the same prompt. The rows below refer to the
[optimized opencode.json](#example-llamacpp).

| Setup                                                           |  Bytes | Input tokens |
| --------------------------------------------------------------- | -----: | -----------: |
| Default OpenCode V2 config, `providers` only                    | 24,294 |        5,714 |
| [optimized opencode.json](#example-llamacpp) without the plugin | 10,636 |        2,513 |
| [optimized opencode.json](#example-llamacpp) with the plugin    |  4,324 |        1,150 |

The plugin alone reduces the example config from 2,513 to 1,150 input tokens
(about 54%). The full example config reduces the default prompt from 5,714 to
1,150 tokens (about 80%, roughly 5x smaller). The difference between the default
config and the example config without the plugin comes from the short agent
system prompt and the denied tools, not from this plugin.

Prompt details:

- Default config: full standard system prompt, 12 tools with full descriptions,
  worktree hint present.
- Example config: short system prompt, 11 tools with compact or deferred
  descriptions, worktree hint removed.

Prompt dumps were tokenized with the llama.cpp `/tokenize` endpoint:
5,750 / 2,513 / 1,150 tokens. OpenCode reports 5,714 / 2,513 / 1,150; the
default-prompt difference is chat-template overhead.

The example-config measurement also used a small project plugin that removes the
remaining `skill` and `opencode_*` tools; with only the permission rules above,
those tools may still appear and add a small number of tokens. Numbers are
approximate and vary by model and tool set.

## Further token reduction with RTK

This plugin reduces the tokens spent on tool descriptions. [RTK](https://github.com/rtk-ai/rtk)
reduces the tokens spent on shell command output by compressing it before the
model reads it. The two work together.

Install RTK:

```sh
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
```

Then install the OpenCode integration:

```sh
rtk init -g --opencode
```

RTK rewrites shell commands to their `rtk` equivalents, so commands such as
`git status`, `grep`, and test runs return compact output. Verify the install
with:

```sh
rtk --version
rtk gain
```

`rtk gain` shows the measured savings. The OpenCode integration requires
OpenCode 1.18.29 or newer.

## Optional OpenCode V2 settings

### Disable the background service

Edit `~/.config/opencode/service.json` and add:

```json
{
  "disabled": true
}
```

### Disable tabs

Edit `~/.config/opencode/cli.json` and add:

```json
{
  "tabs": { "mode": "off" }
}
```

If either file already exists, merge the key into its existing JSON object.

## Caveats

- The model must search before calling a deferred tool. The plugin adds a short
  system instruction explaining this.
- With `stripParameters: true`, keep `includeSchema: true` so the model can
  recover the full schema from the search result.
- If Code Mode is enabled, the `execute` tool is deferred like any other tool.
  Searching for it returns its full description and catalog.
- Denying `execute` still removes Code Mode and every tool reachable only
  through it, as documented by OpenCode.

## Development

```sh
npm install
npm run typecheck
```

To test locally, point the `plugins` entry at this directory and start OpenCode.

## Attribution

Based on [M0Rf30/opencode-tool-search](https://github.com/M0Rf30/opencode-tool-search)
(MIT), which was inspired by
[famitzsy8/opencode-tool-search-tool](https://github.com/famitzsy8/opencode-tool-search-tool).

## License

MIT. See [LICENSE](LICENSE).
