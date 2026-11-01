import { Plugin } from "@opencode/plugin"

// OpenCode V2 tool-search plugin.
//
// Tools that are not in `alwaysLoad` get a short "[d]" description in the
// model request. The model can then call `tool_search` (BM25) or
// `tool_search_regex` to fetch the full description and parameter schema of a
// tool before calling it.
//
// Configure through the plugin object form in opencode.json:
//
//   "plugins": [
//     { "package": "opencode-v2-tool-search",
//       "options": { "alwaysLoad": ["read", "edit", "write", "shell", "glob", "grep"] } }
//   ]
//
// Based on the V1 plugin opencode-tool-search by M0Rf30:
// https://github.com/M0Rf30/opencode-tool-search

type JsonSchema = Record<string, unknown>

interface ToolEntry {
  id: string
  description: string
  input: JsonSchema
}

interface SearchOptions {
  alwaysLoad?: string[]
  searchLimit?: number
  deferDescription?: string
  /** Replace deferred tools' parameter schemas with an empty object. Default: true. */
  stripParameters?: boolean
  /** Include the full JSON Schema in search results. Default: true. */
  includeSchema?: boolean
  /** Shorten always-loaded tools and strip their parameter descriptions. Default: true. */
  compact?: boolean
  /** Override the built-in compact descriptions by tool ID. */
  descriptions?: Record<string, string>
  /** Remove the built-in worktree/session_move hint from the system prompt. Default: true. */
  removeWorktreeHint?: boolean
  bm25?: { k1?: number; b?: number }
}

const SEARCH_TOOL_IDS = new Set(["tool_search", "tool_search_regex"])

const DEFAULT_OPTIONS = {
  searchLimit: 5,
  deferDescription: "[d]",
  stripParameters: true,
  includeSchema: true,
  compact: true,
  removeWorktreeHint: true,
  bm25: { k1: 0.9, b: 0.4 },
} as const

// OpenCode's built-in tools plugin adds this hint to the system prompt. It is
// only useful when worktrees are enabled, so the plugin removes it by default.
const WORKTREE_HINT_PREFIX =
  "When you create a worktree outside the current working directory"

// Short descriptions for tools that stay loaded. They keep the guidance that
// matters for correct calls while removing the long-form prose.
const COMPACT_DESCRIPTIONS: Record<string, string> = {
  read: "Read a file or list a directory. Use offset/limit to page.",
  write: "Create or overwrite a file.",
  edit: "Replace exact text. oldString must be unique unless replaceAll. Omit line-number prefixes.",
  glob: "Find files by glob pattern.",
  grep: "Search file contents with regex or literal text.",
  shell: "Run a shell command. Use workdir instead of cd; set timeout/background when needed.",
  patch: "Apply a multi-file patch.",
  webfetch: "Fetch a URL as markdown, text, or HTML.",
  websearch: "Search the web for current information.",
  question: "Ask the user a question with choices.",
  skill: "Load a skill's instructions.",
  subagent: "Start a child agent with a prompt.",
  execute: "Run JavaScript in Code Mode to call tools.",
  todowrite: "Track multi-step work with a todo list.",
}

// ---------------------------------------------------------------------------
// BM25
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 0)
}

function buildIndex(entries: ToolEntry[], k1: number, b: number) {
  const documents = entries.map((entry) => {
    const terms = tokenize(`${entry.id} ${entry.description}`)
    const termFrequency = new Map<string, number>()
    for (const term of terms) termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1)
    return { terms, termFrequency, length: terms.length }
  })

  const documentFrequency = new Map<string, number>()
  for (const document of documents) {
    for (const term of document.termFrequency.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
    }
  }

  const totalLength = documents.reduce((sum, document) => sum + document.length, 0)
  return {
    entries,
    documents,
    documentFrequency,
    documentCount: documents.length,
    averageDocumentLength: documents.length > 0 ? totalLength / documents.length : 0,
    k1,
    b,
  }
}

function searchBm25(index: ReturnType<typeof buildIndex>, query: string, limit: number): ToolEntry[] {
  if (index.documentCount === 0) return []
  const queryTerms = tokenize(query)
  if (queryTerms.length === 0) return []

  const scored: Array<{ entry: ToolEntry; score: number }> = []
  for (let i = 0; i < index.documents.length; i++) {
    const document = index.documents[i]
    let score = 0
    for (const term of queryTerms) {
      const df = index.documentFrequency.get(term) ?? 0
      if (df === 0) continue
      const tf = document.termFrequency.get(term) ?? 0
      if (tf === 0) continue
      const idf = Math.log((index.documentCount - df + 0.5) / (df + 0.5) + 1)
      const numerator = tf * (index.k1 + 1)
      const denominator =
        tf + index.k1 * (1 - index.b + index.b * (document.length / index.averageDocumentLength))
      score += idf * (numerator / denominator)
    }
    if (score > 0) scored.push({ entry: index.entries[i], score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((result) => result.entry)
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function summarizeParameters(schema: JsonSchema | undefined): string {
  if (!schema || typeof schema !== "object") return "(none)"
  const properties = schema.properties
  if (!properties || typeof properties !== "object") return "(none)"

  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  const lines: string[] = []
  for (const [name, definition] of Object.entries(properties as Record<string, unknown>)) {
    if (!definition || typeof definition !== "object") continue
    const property = definition as Record<string, unknown>
    const type =
      typeof property.type === "string"
        ? property.type
        : Array.isArray(property.type)
          ? property.type.join("|")
          : "unknown"
    const description = typeof property.description === "string" ? property.description : ""
    lines.push(
      `  - ${name}: ${type}${required.has(name) ? " (required)" : ""}${
        description ? ` — ${description}` : ""
      }`,
    )
  }
  return lines.length > 0 ? lines.join("\n") : "(none)"
}

function formatResults(entries: ToolEntry[], includeSchema: boolean): string {
  return entries
    .map((entry) => {
      const schema = includeSchema ? `\n\nJSON Schema:\n${JSON.stringify(entry.input)}` : ""
      return `### ${entry.id}\n${entry.description}\n\nParameters:\n${summarizeParameters(entry.input)}${schema}`
    })
    .join("\n\n---\n\n")
}

function normalizeSchema(input: unknown): JsonSchema {
  if (!input || typeof input !== "object") return { type: "object", properties: {} }
  const schema = input as JsonSchema
  // SessionContext already carries plain JSON Schema. A Tool.Info input can be
  // an Effect/Standard schema instead; only expose its plain-JSON shape.
  if (typeof schema.type === "string" || schema.properties || schema.anyOf || schema.oneOf) {
    return schema
  }
  return { type: "object", properties: {} }
}

// Remove "description" annotations from a JSON Schema while keeping property
// names, types, required fields, defaults, and other constraints.
function stripSchemaDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSchemaDescriptions)
  if (!value || typeof value !== "object") return value

  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}

  for (const [key, child] of Object.entries(input)) {
    if (key === "description") continue

    if (key === "properties" && child && typeof child === "object") {
      const properties: Record<string, unknown> = {}
      for (const [name, schema] of Object.entries(child as Record<string, unknown>)) {
        properties[name] = stripSchemaDescriptions(schema)
      }
      output[key] = properties
      continue
    }

    if (key === "items" || key === "additionalProperties" || key === "not") {
      output[key] = stripSchemaDescriptions(child)
      continue
    }

    if (key === "anyOf" || key === "oneOf" || key === "allOf") {
      output[key] = Array.isArray(child) ? child.map(stripSchemaDescriptions) : child
      continue
    }

    if (key === "$defs" || key === "definitions") {
      const definitions: Record<string, unknown> = {}
      if (child && typeof child === "object") {
        for (const [name, schema] of Object.entries(child as Record<string, unknown>)) {
          definitions[name] = stripSchemaDescriptions(schema)
        }
      }
      output[key] = definitions
      continue
    }

    output[key] = child
  }

  return output
}

function stripWorktreeHint(system: Array<{ type: "text"; text: string }>): void {
  for (let i = system.length - 1; i >= 0; i--) {
    if (system[i].text.startsWith(WORKTREE_HINT_PREFIX)) system.splice(i, 1)
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default Plugin.define({
  id: "tool-search",
  async setup(ctx) {
    const options = (ctx.options ?? {}) as SearchOptions
    const alwaysLoad = new Set([...SEARCH_TOOL_IDS, ...(options.alwaysLoad ?? [])])
    const searchLimit = options.searchLimit ?? DEFAULT_OPTIONS.searchLimit
    const deferDescription = options.deferDescription ?? DEFAULT_OPTIONS.deferDescription
    const stripParameters = options.stripParameters ?? DEFAULT_OPTIONS.stripParameters
    const includeSchema = options.includeSchema ?? DEFAULT_OPTIONS.includeSchema
    const compact = options.compact ?? DEFAULT_OPTIONS.compact
    const descriptions = { ...COMPACT_DESCRIPTIONS, ...(options.descriptions ?? {}) }
    const removeWorktreeHint = options.removeWorktreeHint ?? DEFAULT_OPTIONS.removeWorktreeHint
    const k1 = options.bm25?.k1 ?? DEFAULT_OPTIONS.bm25.k1
    const b = options.bm25?.b ?? DEFAULT_OPTIONS.bm25.b

    // The context hook sees the exact tools that will be sent to the model.
    // Keep the unmodified snapshot so search results include full schemas.
    const snapshots = new Map<string, ToolEntry[]>()

    function capture(sessionID: string, tools: Record<string, { description: string; input: JsonSchema }>) {
      const entries: ToolEntry[] = []
      for (const [id, tool] of Object.entries(tools)) {
        if (SEARCH_TOOL_IDS.has(id)) continue
        entries.push({ id, description: tool.description, input: tool.input })
      }
      snapshots.set(sessionID, entries)
    }

    async function catalog(sessionID: string): Promise<ToolEntry[]> {
      const snapshot = snapshots.get(sessionID)
      if (snapshot && snapshot.length > 0) return snapshot

      const tools = await ctx.tool.list()
      return tools
        .filter((tool) => !SEARCH_TOOL_IDS.has(tool.id))
        .map((tool) => ({
          id: tool.id,
          description: tool.description,
          input: normalizeSchema(tool.input),
        }))
    }

    function defer(event: {
      sessionID: string
      system: Array<{ type: "text"; text: string }>
      tools: Record<string, { description: string; input: JsonSchema }>
    }) {
      if (removeWorktreeHint) stripWorktreeHint(event.system)
      capture(event.sessionID, event.tools)

      let total = 0
      let deferred = 0
      for (const [id, tool] of Object.entries(event.tools)) {
        total++
        if (SEARCH_TOOL_IDS.has(id)) continue

        if (alwaysLoad.has(id)) {
          if (compact) {
            const description = descriptions[id]
            if (description) tool.description = description
            tool.input = stripSchemaDescriptions(tool.input) as JsonSchema
          }
          continue
        }

        tool.description = deferDescription
        if (stripParameters) tool.input = { type: "object", properties: {} }
        deferred++
      }

      if (deferred > 0) {
        event.system.push({
          type: "text",
          text: `[Tool Search] ${deferred}/${total} tools are deferred ("${deferDescription}"). Call tool_search("<keywords>") before using one; search if unsure.`,
        })
      }
    }

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "tool_search",
        description: "Search tools by keyword. Call before using a [d] tool.",
        input: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          const query = typeof (input as { query?: unknown })?.query === "string" ? (input as { query: string }).query : ""
          const entries = await catalog(context.sessionID)
          const results = searchBm25(buildIndex(entries, k1, b), query, searchLimit)
          if (results.length === 0) {
            return { content: `No tools found matching "${query}". Try broader keywords.` }
          }
          return {
            content: `Found ${results.length} tool(s):\n\n${formatResults(results, includeSchema)}`,
          }
        },
      })

      editor.add({
        name: "tool_search_regex",
        description: "Search tools by regex. Call before using a [d] tool.",
        input: {
          type: "object",
          properties: {
            pattern: { type: "string" },
          },
          required: ["pattern"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          const pattern =
            typeof (input as { pattern?: unknown })?.pattern === "string"
              ? (input as { pattern: string }).pattern
              : ""
          let regex: RegExp
          try {
            regex = new RegExp(pattern, "i")
          } catch {
            return { content: `Invalid regex: "${pattern}". Provide a valid regex pattern.` }
          }

          const entries = await catalog(context.sessionID)
          const results = entries
            .filter((entry) => regex.test(entry.id) || regex.test(entry.description))
            .slice(0, searchLimit)
          if (results.length === 0) {
            return { content: `No tools matched pattern "${pattern}". Try a different regex.` }
          }
          return {
            content: `Found ${results.length} tool(s):\n\n${formatResults(results, includeSchema)}`,
          }
        },
      })
    })

    for (const kind of ["context", "compaction", "generate"] as const) {
      await ctx.session.hook(kind, (event) => {
        defer(event)
      })
    }
  },
})
