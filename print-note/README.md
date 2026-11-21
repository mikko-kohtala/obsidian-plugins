# Print Note

Local Obsidian plugin that prints the current note in one click. It replaces
"⌘P → Export to PDF… → save to Desktop → open in Preview → print".

## Where the button is

- **Note header**: a printer icon at the top right of every note.
- **Left ribbon**: the same icon.
- **Right-click a note** (file explorer or tab menu) → *Print note*.
- **Command palette**: *Print current note*, *Open current note as PDF in
  Preview*, *Save current note as PDF to the Desktop*.

## What a click does

1. Saves unsaved edits in the note.
2. Renders the note the way Obsidian's own *Export to PDF* does: the note in a
   `.print` container with the app's stylesheets (your theme and snippets)
   and their print rules, light theme, properties hidden.
3. Adds the title, and an "author · date · site" line from the Web Clipper
   properties.
4. Makes an A4 PDF with page numbers in a hidden window (about a second),
   in a temporary folder.
5. Opens it in Preview with the print dialog already up.

*When the button is pressed* in settings can instead just open the PDF in
Preview, or save it to the Desktop. Page size (A4/Letter), the title, the
source line, page numbers and the buttons can be switched in settings too.

The first print makes macOS ask whether Obsidian may control Preview.

## Install

```bash
bun install
bun run build
ln -sfn /Users/mikko/code/mikko/obsidian-plugins/print-note \
  /Users/mikko/obsidian/.obsidian/plugins/mikko-print-note
```

Then enable `Print Note` in Obsidian → Settings → Community plugins.

## Layout

```
src/main.ts      plugin: buttons, commands, the print flow
src/render.ts    note -> standalone HTML -> PDF
src/settings.ts  settings tab
```
