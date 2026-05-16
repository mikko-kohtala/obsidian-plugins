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

1. Enable the plugin in Obsidian Community Plugins.
2. Open an `.html` or `.htm` file.

For the course concept pack, open:

```text
mikko/personal/money-with-side-projects-html/index.html
```
