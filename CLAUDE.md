# Obsidian plugins

Three independent Obsidian plugins, each its own bun project: `html-viewer` (plugin id `mikko-html-viewer`), `markdown-format-checker` and `web-clipper-verifier`.

## Validation

Validate all work with `bun check` (lint, format, typecheck), run inside each plugin you changed, before calling it done. `bun run fix` applies lint/format fixes.

## Testing in Obsidian

The vault at `/Users/mikko/obsidian` loads each plugin through a symlink to its directory in this main checkout (`/Users/mikko/code/mikko/obsidian-plugins/<plugin>`), so it runs that checkout's built `main.js` (gitignored), not a worktree's. After `bun run build`:

```bash
obsidian plugin:reload id=<plugin id>
obsidian dev:console level=error    # check for errors
```
