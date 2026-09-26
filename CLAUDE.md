# Obsidian plugins

Each top-level directory is an independent Obsidian plugin and its own bun project; the plugin id is the `id` in its `manifest.json` (`html-viewer`'s is `mikko-html-viewer`).

## Validation

Validate all work with `bun check` (lint, format, typecheck), run inside each plugin you changed, before calling it done. `bun run fix` applies lint/format fixes.

## Testing in Obsidian

The vault at `/Users/mikko/obsidian` loads each plugin through a symlink to its directory in the main checkout (`/Users/mikko/code/mikko/obsidian-plugins/<plugin>`), so it runs that checkout's built `main.js` (gitignored), not a worktree's. After `bun run build` there:

```bash
obsidian plugin:reload id=<plugin id>
obsidian dev:console level=error    # check for errors
```
