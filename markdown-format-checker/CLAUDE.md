# CLAUDE.md

## Overview

Obsidian plugin that checks markdown formatting by calling the Claude Code CLI (`claude -p`) as a subprocess. Streams the response in real-time via a floating panel, then renders the final output as formatted markdown.

Desktop-only — requires Node.js `child_process`.

## Architecture

```
src/
  main.ts                  # Plugin lifecycle: ribbon icon, command, settings tab
  settings.ts              # Settings interface, defaults, model migration
  types.ts                 # FormatCheckResult interface
  commands/
    checkFormatting.ts     # Command registration, orchestrates check flow
  ui/
    resultsModal.ts        # Floating panel (not a Modal) — streaming + rendered output
  utils/
    claudeRunner.ts        # Spawns claude CLI, parses stream-json events
    promptBuilder.ts       # Builds the formatting check prompt
```

## How it works

1. User triggers command (Cmd+P or ribbon icon)
2. `checkFormatting.ts` reads the active editor content
3. `promptBuilder.ts` constructs a prompt with formatting rules and skill references (`/obsidian-markdown`, `/obsidian-cli`)
4. `claudeRunner.ts` spawns `claude -p --model <model> --output-format stream-json --verbose --include-partial-messages`, pipes prompt via stdin
5. Streaming JSON events are parsed: `thinking_delta` shown in muted section, `text_delta` shown as plain text
6. On completion, plain text swaps to `MarkdownRenderer.render()` output

## Key technical details

- **Model names must be full IDs** (e.g., `claude-haiku-4-5`, not `haiku`). Short aliases are silently ignored by the CLI. Settings migration handles old aliases.
- **`CLAUDECODE` env var is stripped** from the subprocess to avoid "nested session" errors when Obsidian inherits it from a running Claude Code session.
- **`~` path expansion** is done manually via `os.homedir()` since Node's `spawn` doesn't expand tilde.
- **`--include-partial-messages`** is required for `stream-json` to emit `content_block_delta` events. Without it, only complete messages are emitted.
- **Stream events are wrapped** as `{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}}`.
- **Thinking deltas** use `delta.type === "thinking_delta"` with `delta.thinking` field (not `delta.text`).

## Build & dev

```bash
pnpm install
pnpm run dev      # watch mode
pnpm run build    # production build
```

Output: `main.js` (gitignored). Symlinked from the Obsidian vault at:
```
/Users/mikko/notes/.obsidian/plugins/markdown-format-checker -> /Users/mikko/code/obsidian-plugins/markdown-format-checker
```

## Testing

After code changes:
```bash
pnpm run build
obsidian plugin:reload id=markdown-format-checker
obsidian dev:console level=error    # check for errors
```

Console logs are prefixed with `[format-checker]` and include: command spawned, model confirmed, output size, cost, and duration.

## Settings

| Setting | Default | Notes |
|---------|---------|-------|
| Claude binary path | `~/.local/bin/claude` | Tilde expanded at runtime |
| Model | `claude-haiku-4-5` | Dropdown: Haiku, Sonnet, Opus |
| Timeout | 60s | Sends SIGTERM on timeout |
| Custom prompt | (empty) | Appended to the formatting rules |
