// Note -> standalone printable HTML -> PDF, built the way Obsidian's own
// "Export to PDF" does it: the rendered note in a body > .print container,
// styled by the app's stylesheets and their @media print rules.
import { writeFileSync } from "fs";
import { join } from "path";
import { App, Component, MarkdownRenderer, TFile } from "obsidian";

export type PageSize = "A4" | "Letter";

export interface PrintOptions {
	pageSize: PageSize;
	includeTitle: boolean;
	includeSource: boolean;
	pageNumbers: boolean;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function stripFrontmatter(markdown: string): string {
	return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "");
}

function text(value: unknown): string {
	if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
	if (typeof value !== "string" && typeof value !== "number") return "";
	return String(value)
		.replace(/\[\[([^\]|]+)\|([^\]]*)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, "$1")
		.trim();
}

/** "Author · 16 Nov 2026 · claude.dev" under the title, from Web Clipper properties. */
function sourceLine(frontmatter: Record<string, unknown> | undefined): string {
	if (!frontmatter) return "";
	const parts: string[] = [];
	const author = text(frontmatter["author"]);
	if (author) parts.push(escapeHtml(author));
	const published = text(frontmatter["published"]) || text(frontmatter["date"]);
	const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(published);
	if (date) {
		const when = new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
		parts.push(
			when.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }),
		);
	}
	const source = text(frontmatter["source"]) || text(frontmatter["url"]);
	try {
		const url = new URL(source);
		parts.push(
			`<a href="${escapeHtml(url.href)}">${escapeHtml(url.hostname.replace(/^www\./, ""))}</a>`,
		);
	} catch {
		// no usable URL
	}
	return parts.join(" · ");
}

/** All of the app's CSS, so the print looks like Obsidian's own export (theme and snippets included). */
function collectCss(): string {
	const parts: string[] = [];
	for (const sheet of Array.from(document.styleSheets)) {
		try {
			parts.push(
				Array.from(sheet.cssRules)
					.map((rule) => rule.cssText)
					.join("\n"),
			);
		} catch {
			if (sheet.href) parts.push(`@import url("${sheet.href}");`);
		}
	}
	return parts.join("\n");
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

/** Embed images in the page, so the print window never has to fetch them. */
async function inlineImages(root: HTMLElement): Promise<number> {
	let failed = 0;
	await Promise.all(
		Array.from(root.querySelectorAll("img")).map(async (img) => {
			const src = img.getAttribute("src");
			if (!src || src.startsWith("data:")) return;
			try {
				const response = await fetch(img.src);
				if (!response.ok) throw new Error(String(response.status));
				img.setAttribute("src", await blobToDataUrl(await response.blob()));
				img.removeAttribute("srcset");
				img.removeAttribute("loading");
			} catch {
				failed++;
			}
		}),
	);
	return failed;
}

/** Let async parts of the rendering (embeds, callouts, math) settle. */
function settle(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export interface BuiltPage {
	htmlPath: string;
	/** Images that could not be embedded and will be missing from the print. */
	missingImages: number;
}

/** Render the note to a standalone HTML file next to where the PDF will go. */
export async function buildPage(
	app: App,
	file: TFile,
	options: PrintOptions,
	workDir: string,
): Promise<BuiltPage> {
	const markdown = stripFrontmatter(await app.vault.cachedRead(file));
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;

	const host = document.body.createDiv();
	host.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;visibility:hidden;";
	const view = host.createDiv({ cls: "markdown-preview-view markdown-rendered" });
	const component = new Component();
	component.load();
	try {
		if (options.includeTitle) {
			view.createEl("h1", {
				cls: "print-note-title",
				text: text(frontmatter?.["title"]) || file.basename,
			});
			const meta = options.includeSource ? sourceLine(frontmatter) : "";
			if (meta) view.createDiv({ cls: "print-note-source" }).innerHTML = meta;
		}
		const body = view.createDiv();
		await MarkdownRenderer.render(app, markdown, body, file.path, component);
		await settle(400);
		const missingImages = await inlineImages(view);

		const bodyClass = document.body.className
			.split(/\s+/)
			.filter((cls) => cls && cls !== "theme-dark" && !/^is-|^mod-/.test(cls))
			.concat("theme-light")
			.join(" ");
		const html = `<!doctype html>
<html><head><meta charset="utf-8">
<base href="${escapeHtml(document.baseURI)}">
<title>${escapeHtml(file.basename)}</title>
<style>${collectCss()}</style>
<style>
@page { size: ${options.pageSize}; margin: 16mm 15mm 18mm 15mm; }
html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
body { position: static !important; }
.print .markdown-preview-view { padding: 0 !important; overflow: visible !important; }
.print .print-note-title { margin: 0 0 0.25em; }
.print .print-note-source { color: #555; font-size: 0.9em; margin: 0 0 1.6em; }
.print .print-note-source a { color: inherit; text-decoration: none; }
.print img { max-width: 100%; height: auto; break-inside: avoid; }
.print h1, .print h2, .print h3, .print h4, .print h5, .print h6 { break-after: avoid; }
.print pre, .print blockquote, .print table, .print .callout, .print figure { break-inside: avoid; }
.print .copy-code-button, .print .collapse-indicator, .print .heading-collapse-indicator,
.print .markdown-embed-link, .print .frontmatter-container, .print .metadata-container { display: none !important; }
</style>
</head>
<body class="${escapeHtml(bodyClass)}" style="${escapeHtml(document.body.getAttribute("style") ?? "")}">
<div class="print">${view.outerHTML}</div>
</body></html>`;

		const htmlPath = join(workDir, `${file.basename}.html`);
		writeFileSync(htmlPath, html, "utf8");
		return { htmlPath, missingImages };
	} finally {
		component.unload();
		host.remove();
	}
}

const FOOTER = `<div style="width:100%;font-size:8px;color:#888;text-align:center;font-family:-apple-system,Helvetica,sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

interface RemoteWindow {
	loadURL(url: string): Promise<void>;
	webContents: {
		printToPDF(options: Record<string, unknown>): Promise<Uint8Array>;
	};
	destroy(): void;
}

/** Print the HTML file to PDF in a hidden window and write it to pdfPath. */
export async function printToPdf(
	htmlPath: string,
	pdfPath: string,
	options: PrintOptions,
): Promise<void> {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const electron = require("electron") as {
		remote?: { BrowserWindow: new (options: Record<string, unknown>) => RemoteWindow };
	};
	const BrowserWindow = electron.remote?.BrowserWindow;
	if (!BrowserWindow)
		throw new Error("This version of Obsidian doesn't allow printing from plugins.");

	const win = new BrowserWindow({
		show: false,
		width: 900,
		height: 1200,
		webPreferences: { javascript: false, sandbox: true },
	});
	try {
		await win.loadURL(`file://${htmlPath.split("/").map(encodeURIComponent).join("/")}`);
		await settle(300); // fonts
		const pdf = await win.webContents.printToPDF({
			printBackground: true,
			preferCSSPageSize: true,
			displayHeaderFooter: options.pageNumbers,
			headerTemplate: "<span></span>",
			footerTemplate: options.pageNumbers ? FOOTER : "<span></span>",
			generateDocumentOutline: true,
		});
		writeFileSync(pdfPath, pdf);
	} finally {
		win.destroy();
	}
}
