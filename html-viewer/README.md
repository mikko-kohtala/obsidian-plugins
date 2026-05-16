# HTML Viewer

Local Obsidian plugin for viewing `.html` and `.htm` files inside the vault.

## What it does

- Opens HTML files in a native Obsidian file view.
- Loads files through Obsidian resource URLs so adjacent CSS, JavaScript, images, and relative links work.
- Provides a source/render toggle, refresh button, and script/trusted-app controls.
- Provides per-tab zoom controls for the rendered web page.
- Supports `![[file.html]]` embeds when Obsidian's embed registry is available.
- Refreshes open views when the HTML file or sibling assets change.

## Security model

Scripts are disabled by default. Turning scripts on still keeps the iframe sandboxed without same-origin access, which means the page cannot read Obsidian or vault internals.

Trusted app mode is intentionally separate. Use it only for HTML you control. It adds same-origin compatibility so local app features such as `localStorage` and some relative fetches can work.

## Usage

1. Build the plugin:

```bash
pnpm install
pnpm run build
```

2. Install it into the vault using the local plugin ID:

```bash
mkdir -p /Users/mikko/obsidian/.obsidian/plugins
ln -sfn /Users/mikko/code/obsidian-plugins/html-viewer /Users/mikko/obsidian/.obsidian/plugins/mikko-html-viewer
```

3. Enable `HTML Viewer` in Obsidian Community Plugins.
4. Open an `.html` or `.htm` file.

The manifest ID is `mikko-html-viewer` so it does not collide with community plugins that use the public `html-viewer` ID. Keep the public `html-viewer` plugin disabled in this vault so `.html` files consistently open with this local plugin.

For the course concept pack, open:

```text
mikko/personal/money-with-side-projects-html/index.html
```
