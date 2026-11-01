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

```jsonc title="opencode.jsonc"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "<path-to-plugin>/opencode-v2-tool-search",
      "options": {
        "searchLimit": 5,
        "stripParameters": true,
        "includeSchema": true,
      },
    },
  ],
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
  "plugins": ["../opencode-v2-tool-search"],
}
```

The package is not published to npm yet. Once it is, add
`"opencode-v2-tool-search"` to `plugins` and let OpenCode install it.

## Options

| Option             | Type       | Default | Description                                                              |
| ------------------ | ---------- | ------- | ------------------------------------------------------------------------ |
| `alwaysLoad`       | `string[]` | `[]`    | Tool IDs that keep their full description and schema.                    |
| `searchLimit`      | `number`   | `5`     | Maximum number of results returned by a search.                          |
| `deferDescription` | `string`   | `"[d]"` | Stub description used for deferred tools.                                |
| `stripParameters`  | `boolean`  | `true`  | Replace deferred tools' parameter schema with an empty object.           |
| `includeSchema`    | `boolean`  | `true`  | Include the full JSON Schema in search results.                          |
| `bm25.k1`          | `number`   | `0.9`   | BM25 term-frequency saturation.                                          |
| `bm25.b`           | `number`   | `0.4`   | BM25 document-length normalization.                                      |

If a model tends to call deferred tools without searching first, add the tools
it uses most to `alwaysLoad`:

```jsonc
{
  "options": {
    "alwaysLoad": ["read", "edit", "write", "shell", "glob", "grep"],
  },
}
```

## Token savings

Measured on OpenCode 2.2.3 with a local `llama.cpp` model and 11 built-in tools:

| Setup                            | Input tokens |
| -------------------------------- | ------------ |
| Without the plugin               | ~2,509       |
| With `stripParameters: true`     | ~957         |

That is roughly a 62% reduction for that setup. Savings grow as more tools are
available, especially MCP tools.

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
