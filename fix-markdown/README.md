# Fix Markdown

Local Obsidian plugin that repairs a clipped note with one click. It runs the
vault's [`fix-markdown-file`](../../../obsidian/.claude/skills/fix-markdown-file/SKILL.md)
skill through the **local Claude Code CLI**, on the note you have open, with the
URL it was clipped from.

## Where the button is

- **Note header** — a wand icon at the top right of every note.
- **Left ribbon** — the same icon.
- **Right-click a note** (file explorer or tab menu) → *Fix Markdown with Claude*.
- **Command palette** — *Fix current note with Claude*, *Cancel the running fix*, *Show the fix report*.

## What a click does

1. Saves unsaved edits in the note.
2. Reads the source URL from the note's `source:` (or `url:`) property.
3. Runs, from the vault folder:

   ```
   claude -p '/fix-markdown-file "<note path>" <source url>' \
     --output-format stream-json --verbose --permission-mode auto
   ```

4. Opens the **Fix report** panel in the right sidebar and follows the run
   live: what Claude says it found, and each action it takes (reading, running
   checks, editing), with timestamps.
5. When it finishes, the same panel shows:
   - **Claude's report** — what was wrong, what it changed, new files, what it
     left as is and why;
   - **Changes to the note** — every changed line, with the changed words
     highlighted (red = removed, green = added);
   - **Other files** — attachments it created, changed or deleted;
   - **Not allowed** — actions the permission setting refused;
   - buttons to **Undo** (puts the note back as it was before the fix; new
     attachments are kept), **Copy resume command** (`claude --resume <id>`, to
     carry on in a terminal from the vault) and **Fix again**.

*Open the report panel* in settings picks when the panel appears: right away
(default), when the fix is done, or only when you click the notice. The command
*Show the fix report* opens it any time; a picker at the top switches between
this session's runs.

Several notes can be fixed at the same time; one note can't be fixed twice at
once.

## Always the local Claude

The plugin starts the `claude` binary itself (default `~/.local/bin/claude`) and
removes `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` from its environment, so a
run always uses the CLI's own login and can never fall back to API billing.

## Nobody is there to approve

A run is unattended, so *What Claude may do* in settings decides what happens
without a prompt:

| Setting | Effect |
|---------|--------|
| Auto (default) | Claude Code's safety classifier approves each action |
| Edits only | file edits go through; commands and downloads are refused |
| Dry run | nothing changes; the report says what it would fix |

Claude is also told that nobody can answer: where the skill says "ask first" it
takes the safe option and says so in the report.

Notes under *Ask before fixing notes in* (default `wiki/sources/`, except
`wiki/sources/_unsorted/`) ask in Obsidian before the run starts — the skill
treats ingested sources as immutable.

## Install

```bash
bun install
bun run build
ln -sfn /Users/mikko/code/mikko/obsidian-plugins/fix-markdown \
  /Users/mikko/obsidian/.obsidian/plugins/mikko-fix-markdown
```

Then enable `Fix Markdown` in Obsidian → Settings → Community plugins.

## Layout

```
src/main.ts      plugin: buttons, commands, the fix flow, prompt
src/claude.ts    starts claude -p and follows its stream (no Obsidian imports)
src/settings.ts  settings tab
src/view.ts      the Fix report side panel
src/diff.ts      line + word diff of the note (no Obsidian imports)
src/runs.ts      what is kept about each run
src/modals.ts    the confirmation dialog
```
