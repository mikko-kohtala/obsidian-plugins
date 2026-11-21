# Send to Kindle

Local Obsidian plugin that sends the current note to a Kindle as a properly
typeset article. It is a thin front end for the
[`kindle-epub`](../../kindle-epub) tools, which do the real work: Obsidian
Markdown → EPUB (article header, figures, cover) → Kindle.

macOS only (email goes through Mail.app).

## Where the button is

- **Note header** — a paper-plane icon at the top right of every note.
- **Left ribbon** — the same icon.
- **Right-click a note** (file explorer or tab menu) → *Send to Kindle*.
- **Command palette**:
  - *Send current note to Kindle* (uses the default delivery)
  - *Send current note to Kindle by email*
  - *Copy current note to Kindle over USB*
  - *Build EPUB of current note and show it in Finder*

## Delivery

| Mode | What happens |
|------|--------------|
| Auto (default) | USB when a Kindle is mounted at `/Volumes/Kindle`, otherwise email |
| Email | `bin/send-to-kindle`: Mail.app → Amazon Send to Kindle → Wi-Fi |
| USB | `bin/usb-to-kindle`: Calibre converts to AZW3, copies it, ejects the Kindle |
| EPUB only | builds the file and reveals it in Finder |

Emailing a note that was already emailed asks first: Amazon never replaces a
document, so a second send is a second copy in the library. A USB copy replaces
the file on the device.

## Requirements

- The `kindle-epub` checkout (default `~/code/mikko/kindle-epub`, changeable in
  settings) and its requirements: `pandoc`, and Calibre for USB.
- Obsidian started from the Dock doesn't inherit the shell's `PATH`, so the
  plugin prepends *Extra PATH* (default `/opt/homebrew/bin:/usr/local/bin`).
- The first email send makes macOS ask whether Obsidian may control Mail.

## Install

```bash
bun install
bun run build
ln -sfn /Users/mikko/code/mikko/obsidian-plugins/send-to-kindle \
  /Users/mikko/obsidian/.obsidian/plugins/mikko-send-to-kindle
```

Then enable `Send to Kindle` in Obsidian → Settings → Community plugins.

## Layout

```
src/main.ts          plugin: buttons, commands, the send flow
src/kindle.ts        runs the kindle-epub tools (no Obsidian imports)
src/settings.ts      settings tab
src/confirmModal.ts  the "send again?" question
```
