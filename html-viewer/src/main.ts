import {
	Component,
	FileView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
	setIcon,
	type ViewStateResult,
} from "obsidian";

const VIEW_TYPE_HTML_VIEWER = "html-viewer";
const HTML_EXTENSIONS = ["html", "htm"];
const DEFAULT_ZOOM_LEVEL = 1;
const MIN_ZOOM_LEVEL = 0.5;
const MAX_ZOOM_LEVEL = 3;
const ZOOM_STEP = 0.1;
const ASSET_EXTENSIONS = new Set([
	"css",
	"js",
	"mjs",
	"json",
	"map",
	"svg",
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"avif",
	"ico",
	"bmp",
	"wasm",
	"woff",
	"woff2",
	"ttf",
	"otf",
	"mp3",
	"mp4",
	"ogg",
	"wav",
	"webm",
	"pdf",
	"csv",
	"txt",
]);

interface HtmlViewerSettings {
	defaultSourceMode: boolean;
	defaultScriptsEnabled: boolean;
	defaultTrustedAppMode: boolean;
	showToolbar: boolean;
	dedupeTabs: boolean;
	watchSiblingAssets: boolean;
	embedHeight: number;
}

const DEFAULT_SETTINGS: HtmlViewerSettings = {
	defaultSourceMode: false,
	defaultScriptsEnabled: false,
	defaultTrustedAppMode: false,
	showToolbar: true,
	dedupeTabs: true,
	watchSiblingAssets: true,
	embedHeight: 600,
};

interface EmbedContext {
	containerEl: HTMLElement;
}

interface EmbedRegistry {
	registerExtension(
		extension: string,
		embedCreator: (context: EmbedContext, file: TFile) => Component,
	): void;
	unregisterExtension(extension: string): void;
}

interface AppWithEmbedRegistry {
	embedRegistry?: EmbedRegistry;
}

function isHtmlFile(file: unknown): file is TFile {
	return (
		file instanceof TFile &&
		HTML_EXTENSIONS.includes(file.extension.toLowerCase())
	);
}

function getParentPath(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? "" : path.slice(0, index);
}

function parsePositiveInteger(value: unknown, fallback: number): number {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.round(value);
	}

	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed) && parsed > 0) {
			return parsed;
		}
	}

	return fallback;
}

function booleanFromState(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function zoomFromState(value: unknown, fallback = DEFAULT_ZOOM_LEVEL): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}

	return clampZoom(value);
}

function clampZoom(value: number): number {
	const clamped = Math.min(
		MAX_ZOOM_LEVEL,
		Math.max(MIN_ZOOM_LEVEL, value),
	);
	return Math.round(clamped * 100) / 100;
}

function formatZoom(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function withoutQueryAndHash(resourcePath: string): string {
	try {
		const url = new URL(resourcePath);
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return resourcePath.split(/[?#]/, 1)[0] ?? resourcePath;
	}
}

function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function getDocumentPrefix(html: string): string {
	return html.match(/^\s*<!doctype[^>]*>/i)?.[0] ?? "<!doctype html>";
}

function ensureBaseElement(doc: Document, baseHref: string): void {
	if (doc.querySelector("base[href]")) {
		return;
	}

	const base = doc.createElement("base");
	base.href = baseHref;
	doc.head.prepend(base);
}

function ensureZoomStyle(doc: Document, zoomLevel: number): void {
	const style = doc.createElement("style");
	style.setAttribute("data-html-viewer-zoom", "");
	style.textContent = `
html {
	zoom: ${zoomLevel} !important;
}
`;
	doc.head.appendChild(style);
}

function resolveVaultHref(sourcePath: string, href: string): string | null {
	const trimmed = href.trim();
	if (!trimmed || trimmed.startsWith("#")) {
		return null;
	}

	if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(trimmed)) {
		return null;
	}

	const pathWithoutHash = trimmed.split("#", 1)[0] ?? trimmed;
	const pathWithoutQuery = pathWithoutHash.split("?", 1)[0] ?? pathWithoutHash;
	if (!pathWithoutQuery) {
		return null;
	}

	const basePath = pathWithoutQuery.startsWith("/")
		? pathWithoutQuery.slice(1)
		: `${getParentPath(sourcePath)}/${pathWithoutQuery}`;
	return normalizeVaultPath(basePath);
}

function normalizeVaultPath(path: string): string {
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (!part || part === ".") {
			continue;
		}

		if (part === "..") {
			parts.pop();
			continue;
		}

		parts.push(part);
	}

	return parts.join("/");
}

function makeToolbarButton(
	container: HTMLElement,
	icon: string,
	label: string,
	onClick: () => void,
	options: { showLabel?: boolean } = {},
): HTMLButtonElement {
	const button = container.createEl("button", {
		cls: "html-viewer-toolbar-button",
		attr: {
			type: "button",
			"aria-label": label,
			title: label,
		},
	});
	setIcon(button, icon);
	if (options.showLabel !== false) {
		button.createSpan({ text: label });
	}
	button.addEventListener("click", onClick);
	return button;
}

class HtmlViewerView extends FileView {
	private readonly plugin: HtmlViewerPlugin;
	private readonly state = {
		sourceMode: false,
		scriptsEnabled: false,
		trustedAppMode: false,
		zoomLevel: DEFAULT_ZOOM_LEVEL,
	};
	private toolbarEl: HTMLElement | null = null;
	private renderEl: HTMLElement | null = null;
	private pathEl: HTMLElement | null = null;
	private sourceButton: HTMLButtonElement | null = null;
	private zoomOutButton: HTMLButtonElement | null = null;
	private zoomResetButton: HTMLButtonElement | null = null;
	private zoomInButton: HTMLButtonElement | null = null;
	private scriptButton: HTMLButtonElement | null = null;
	private trustedButton: HTMLButtonElement | null = null;
	private renderVersion = 0;

	constructor(leaf: WorkspaceLeaf, plugin: HtmlViewerPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.state.sourceMode = plugin.settings.defaultSourceMode;
		this.state.scriptsEnabled = plugin.settings.defaultScriptsEnabled;
		this.state.trustedAppMode = plugin.settings.defaultTrustedAppMode;
	}

	getViewType(): string {
		return VIEW_TYPE_HTML_VIEWER;
	}

	getDisplayText(): string {
		return this.file?.name ?? "HTML Viewer";
	}

	getIcon(): string {
		return "file-code";
	}

	canAcceptExtension(extension: string): boolean {
		return HTML_EXTENSIONS.includes(extension.toLowerCase());
	}

	onload(): void {
		super.onload();
		this.buildShell();
	}

	getState(): Record<string, unknown> {
		return {
			...super.getState(),
			sourceMode: this.state.sourceMode,
			scriptsEnabled: this.state.scriptsEnabled,
			trustedAppMode: this.state.trustedAppMode,
			zoomLevel: this.state.zoomLevel,
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === "object") {
			const viewState = state as Record<string, unknown>;
			const filePath =
				typeof viewState.file === "string" ? viewState.file : null;
			const existingLeaf =
				filePath && this.plugin.settings.dedupeTabs
					? this.plugin.findOpenHtmlLeaf(filePath, this)
					: null;

			if (existingLeaf) {
				this.app.workspace.revealLeaf(existingLeaf);
				this.leaf.detach();
				return;
			}

			this.state.sourceMode = booleanFromState(
				viewState.sourceMode,
				this.plugin.settings.defaultSourceMode,
			);
			this.state.scriptsEnabled = booleanFromState(
				viewState.scriptsEnabled,
				this.plugin.settings.defaultScriptsEnabled,
			);
			this.state.trustedAppMode = booleanFromState(
				viewState.trustedAppMode,
				this.plugin.settings.defaultTrustedAppMode,
			);
			this.state.zoomLevel = zoomFromState(viewState.zoomLevel);
		}

		await super.setState(state, result);
		this.updateToolbar();
	}

	async onLoadFile(file: TFile): Promise<void> {
		this.buildShell();
		await this.renderFile(file);
	}

	async onUnloadFile(_file: TFile): Promise<void> {
		this.renderVersion++;
		this.renderEl?.empty();
	}

	async onRename(file: TFile): Promise<void> {
		await super.onRename(file);
		this.updateToolbar();
		await this.renderFile(file);
	}

	async renderFile(file = this.file): Promise<void> {
		if (!file || !this.renderEl) {
			return;
		}

		const version = ++this.renderVersion;
		this.updateToolbar();
		this.renderEl.empty();

		if (this.state.sourceMode) {
			await this.renderSource(file, version);
			return;
		}

		await this.renderIframe(file, version);
	}

	showDeleted(file: TFile): void {
		this.renderVersion++;
		this.renderEl?.empty();
		this.renderEl?.createDiv({
			cls: "html-viewer-message",
			text: `File deleted: ${file.path}`,
		});
	}

	applySettingsDefaults(): void {
		if (!this.file) {
			this.state.sourceMode = this.plugin.settings.defaultSourceMode;
			this.state.scriptsEnabled = this.plugin.settings.defaultScriptsEnabled;
			this.state.trustedAppMode = this.plugin.settings.defaultTrustedAppMode;
			this.updateToolbar();
		}
	}

	private buildShell(): void {
		this.contentEl.empty();
		this.contentEl.addClass("html-viewer-root");

		if (this.plugin.settings.showToolbar) {
			this.toolbarEl = this.contentEl.createDiv({
				cls: "html-viewer-toolbar",
			});
			this.buildToolbar(this.toolbarEl);
		} else {
			this.toolbarEl = null;
			this.sourceButton = null;
			this.zoomOutButton = null;
			this.zoomResetButton = null;
			this.zoomInButton = null;
			this.scriptButton = null;
			this.trustedButton = null;
			this.pathEl = null;
		}

		this.renderEl = this.contentEl.createDiv({
			cls: "html-viewer-content",
		});
		this.updateToolbar();
	}

	private buildToolbar(toolbarEl: HTMLElement): void {
		const viewGroup = toolbarEl.createDiv({
			cls: "html-viewer-toolbar-group",
		});
		this.sourceButton = makeToolbarButton(
			viewGroup,
			"code-xml",
			"Source",
			() => {
				this.state.sourceMode = !this.state.sourceMode;
				void this.renderFile();
			},
		);

		const zoomGroup = toolbarEl.createDiv({
			cls: "html-viewer-toolbar-group",
		});
		this.zoomOutButton = makeToolbarButton(
			zoomGroup,
			"zoom-out",
			"Zoom Out",
			() => {
				this.setZoom(this.state.zoomLevel - ZOOM_STEP);
			},
			{ showLabel: false },
		);
		this.zoomResetButton = makeToolbarButton(
			zoomGroup,
			"rotate-ccw",
			"Reset Zoom",
			() => {
				this.setZoom(DEFAULT_ZOOM_LEVEL);
			},
		);
		this.zoomResetButton.addClass("html-viewer-zoom-reset");
		this.zoomInButton = makeToolbarButton(
			zoomGroup,
			"zoom-in",
			"Zoom In",
			() => {
				this.setZoom(this.state.zoomLevel + ZOOM_STEP);
			},
			{ showLabel: false },
		);

		const securityGroup = toolbarEl.createDiv({
			cls: "html-viewer-toolbar-group",
		});
		this.scriptButton = makeToolbarButton(
			securityGroup,
			"play",
			"Scripts",
			() => {
				this.state.scriptsEnabled = !this.state.scriptsEnabled;
				void this.renderFile();
			},
		);
		this.trustedButton = makeToolbarButton(
			securityGroup,
			"shield-alert",
			"Trusted",
			() => {
				this.state.trustedAppMode = !this.state.trustedAppMode;
				void this.renderFile();
			},
		);

		const actionGroup = toolbarEl.createDiv({
			cls: "html-viewer-toolbar-group",
		});
		makeToolbarButton(actionGroup, "refresh-cw", "Refresh", () => {
			void this.renderFile();
		});

		toolbarEl.createDiv({ cls: "html-viewer-toolbar-spacer" });
		this.pathEl = toolbarEl.createDiv({ cls: "html-viewer-path" });
	}

	private updateToolbar(): void {
		this.sourceButton?.toggleClass("is-active", this.state.sourceMode);
		this.sourceButton
			?.querySelector("span")
			?.setText(this.state.sourceMode ? "Rendered" : "Source");

		this.zoomOutButton?.toggleClass(
			"is-disabled",
			this.state.zoomLevel <= MIN_ZOOM_LEVEL,
		);
		this.zoomInButton?.toggleClass(
			"is-disabled",
			this.state.zoomLevel >= MAX_ZOOM_LEVEL,
		);
		this.zoomResetButton
			?.querySelector("span")
			?.setText(formatZoom(this.state.zoomLevel));
		this.zoomResetButton?.toggleClass(
			"is-active",
			this.state.zoomLevel !== DEFAULT_ZOOM_LEVEL,
		);

		this.scriptButton?.toggleClass("is-active", this.state.scriptsEnabled);
		this.scriptButton
			?.querySelector("span")
			?.setText(this.state.scriptsEnabled ? "Scripts On" : "Scripts Off");

		this.trustedButton?.toggleClass(
			"is-active",
			this.state.trustedAppMode,
		);
		this.trustedButton?.toggleClass(
			"is-warning",
			this.state.trustedAppMode && this.state.scriptsEnabled,
		);
		this.trustedButton
			?.querySelector("span")
			?.setText(this.state.trustedAppMode ? "Trusted On" : "Trusted Off");

		if (this.pathEl) {
			this.pathEl.setText(this.file?.path ?? "");
			this.pathEl.setAttr("title", this.file?.path ?? "");
		}
	}

	private setZoom(zoomLevel: number): void {
		const nextZoomLevel = clampZoom(zoomLevel);
		if (nextZoomLevel === this.state.zoomLevel) {
			return;
		}

		this.state.zoomLevel = nextZoomLevel;
		this.updateToolbar();
		if (!this.state.sourceMode) {
			void this.renderFile();
		}
	}

	private async renderSource(file: TFile, version: number): Promise<void> {
		let source: string;
		try {
			source = await this.app.vault.cachedRead(file);
		} catch (error) {
			if (version === this.renderVersion) {
				this.showError(error);
			}
			return;
		}

		if (version !== this.renderVersion || !this.renderEl) {
			return;
		}

		const textarea = this.renderEl.createEl("textarea", {
			cls: "html-viewer-source",
			attr: {
				readonly: true,
				spellcheck: "false",
			},
		});
		textarea.value = source;
	}

	private async renderIframe(file: TFile, version: number): Promise<void> {
		if (!this.renderEl) {
			return;
		}

		let html: string;
		try {
			html = await this.app.vault.cachedRead(file);
		} catch (error) {
			if (version === this.renderVersion) {
				this.showError(error);
			}
			return;
		}

		if (version !== this.renderVersion || !this.renderEl) {
			return;
		}

		const renderedHtml = await this.plugin.prepareHtmlForRender(
			file,
			html,
			this.state.zoomLevel,
		);
		const iframe = this.renderEl.ownerDocument.createElement("iframe");
		iframe.className = "html-viewer-iframe";
		iframe.title = file.name;
		iframe.setAttribute("sandbox", this.getSandboxPolicy());
		iframe.srcdoc = renderedHtml;
		this.attachLinkHandler(iframe, file);
		this.renderEl.appendChild(iframe);

		if (this.state.scriptsEnabled) {
			iframe.addEventListener(
				"load",
				() => {
					iframe.focus();
				},
				{ once: true },
			);
		}
	}

	private attachLinkHandler(iframe: HTMLIFrameElement, sourceFile: TFile): void {
		iframe.addEventListener(
			"load",
			() => {
				let doc: Document | null = null;
				try {
					doc = iframe.contentDocument;
				} catch {
					return;
				}

				if (!doc) {
					return;
				}

				doc.addEventListener("click", (event) => {
					if (
						event.defaultPrevented ||
						event.button !== 0 ||
						event.metaKey ||
						event.ctrlKey ||
						event.shiftKey ||
						event.altKey
					) {
						return;
					}

					const target = event.target;
					const win = doc.defaultView;
					if (!win || !(target instanceof win.Element)) {
						return;
					}

					const anchor = target.closest("a[href]");
					if (!(anchor instanceof win.HTMLAnchorElement)) {
						return;
					}

					const path = resolveVaultHref(
						sourceFile.path,
						anchor.getAttribute("href") ?? "",
					);
					if (!path) {
						return;
					}

					const linkedFile = this.app.vault.getAbstractFileByPath(path);
					if (!isHtmlFile(linkedFile)) {
						return;
					}

					event.preventDefault();
					void this.leaf.setViewState({
						type: VIEW_TYPE_HTML_VIEWER,
						state: {
							file: linkedFile.path,
							sourceMode: this.state.sourceMode,
							scriptsEnabled: this.state.scriptsEnabled,
							trustedAppMode: this.state.trustedAppMode,
							zoomLevel: this.state.zoomLevel,
						},
						active: true,
					});
				});
			},
			{ once: true },
		);
	}

	private getSandboxPolicy(): string {
		const permissions: string[] = [];

		if (this.state.scriptsEnabled) {
			permissions.push("allow-scripts");
		}

		if (!this.state.scriptsEnabled || this.state.trustedAppMode) {
			permissions.push("allow-same-origin");
		}

		if (this.state.trustedAppMode) {
			permissions.push("allow-forms", "allow-popups", "allow-downloads");
		}

		return permissions.join(" ");
	}

	private showError(error: unknown): void {
		this.renderEl?.empty();
		const message =
			error instanceof Error ? error.message : "Unable to render HTML file.";
		this.renderEl?.createDiv({
			cls: "html-viewer-message",
			text: message,
		});
	}
}

class HtmlViewerEmbed extends Component {
	private renderVersion = 0;
	private unloaded = false;
	private tracked = false;

	constructor(
		private readonly containerEl: HTMLElement,
		private readonly plugin: HtmlViewerPlugin,
		readonly file: TFile,
	) {
		super();
	}

	onload(): void {
		this.loadFile();
	}

	loadFile(): void {
		if (this.unloaded) {
			return;
		}

		if (!this.tracked) {
			this.plugin.trackEmbed(this);
			this.tracked = true;
		}

		void this.render();
	}

	onunload(): void {
		this.unloaded = true;
		this.renderVersion++;
		if (this.tracked) {
			this.plugin.untrackEmbed(this);
			this.tracked = false;
		}
		this.containerEl.empty();
		this.containerEl.removeClass("html-viewer-embed");
		this.containerEl.style.removeProperty("--html-viewer-embed-width");
		this.containerEl.style.removeProperty("--html-viewer-embed-height");
	}

	refresh(): void {
		this.loadFile();
	}

	private async render(): Promise<void> {
		const version = ++this.renderVersion;
		if (this.unloaded || version !== this.renderVersion) {
			return;
		}

		const width =
			this.containerEl.getAttribute("width") ??
			this.containerEl.getAttribute("data-width") ??
			"100%";
		const height = parsePositiveInteger(
			this.containerEl.getAttribute("height"),
			this.plugin.settings.embedHeight,
		);

		this.containerEl.empty();
		this.containerEl.addClass("html-viewer-embed");
		this.containerEl.setCssProps({
			"--html-viewer-embed-width": /^\d+$/.test(width)
				? `${width}px`
				: width,
			"--html-viewer-embed-height": `${height}px`,
		});

		let html: string;
		try {
			html = await this.plugin.app.vault.cachedRead(this.file);
		} catch (error) {
			if (!this.unloaded && version === this.renderVersion) {
				const message =
					error instanceof Error
						? error.message
						: "Unable to render HTML file.";
				this.containerEl.createDiv({
					cls: "html-viewer-message",
					text: message,
				});
			}
			return;
		}

		if (this.unloaded || version !== this.renderVersion) {
			return;
		}

		const iframe = this.containerEl.ownerDocument.createElement("iframe");
		iframe.className = "html-viewer-iframe";
		iframe.title = this.file.name;
		iframe.setAttribute(
			"sandbox",
			this.plugin.getDefaultSandboxPolicy(),
		);
		iframe.srcdoc = await this.plugin.prepareHtmlForRender(this.file, html);
		this.containerEl.appendChild(iframe);
	}
}

export default class HtmlViewerPlugin extends Plugin {
	settings: HtmlViewerSettings = DEFAULT_SETTINGS;
	private readonly embeds = new Set<HtmlViewerEmbed>();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_HTML_VIEWER,
			(leaf: WorkspaceLeaf) => new HtmlViewerView(leaf, this),
		);
		this.registerExtensions(HTML_EXTENSIONS, VIEW_TYPE_HTML_VIEWER);
		this.registerHtmlEmbeds();
		this.registerVaultWatchers();

		this.addCommand({
			id: "open-current-html-file",
			name: "Open current HTML file",
			callback: () => {
				void this.openActiveHtmlFile();
			},
		});

		this.addCommand({
			id: "refresh-open-html-viewers",
			name: "Refresh open HTML viewers",
			callback: () => {
				void this.refreshOpenHtmlDocuments();
			},
		});

		this.addSettingTab(new HtmlViewerSettingTab(this.app, this));
	}

	onunload(): void {
		this.embeds.clear();
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<HtmlViewerSettings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...saved,
			embedHeight: parsePositiveInteger(
				saved?.embedHeight,
				DEFAULT_SETTINGS.embedHeight,
			),
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	getDefaultSandboxPolicy(): string {
		const permissions: string[] = [];

		if (this.settings.defaultScriptsEnabled) {
			permissions.push("allow-scripts");
		}

		if (
			!this.settings.defaultScriptsEnabled ||
			this.settings.defaultTrustedAppMode
		) {
			permissions.push("allow-same-origin");
		}

		if (this.settings.defaultTrustedAppMode) {
			permissions.push("allow-forms", "allow-popups", "allow-downloads");
		}

		return permissions.join(" ");
	}

	getResourceBaseHref(file: TFile): string {
		const parentPath = getParentPath(file.path);
		const folderPath = parentPath ? `${parentPath}/` : "/";
		return withoutQueryAndHash(
			this.app.vault.adapter.getResourcePath(folderPath),
		);
	}

	async prepareHtmlForRender(
		file: TFile,
		html: string,
		zoomLevel = DEFAULT_ZOOM_LEVEL,
	): Promise<string> {
		const doc = new DOMParser().parseFromString(html, "text/html");
		ensureBaseElement(doc, this.getResourceBaseHref(file));

		await this.inlineLocalStylesheets(file, doc);
		await this.inlineLocalScripts(file, doc);
		ensureZoomStyle(doc, zoomLevel);

		return `${getDocumentPrefix(html)}\n${doc.documentElement.outerHTML}`;
	}

	private async inlineLocalStylesheets(
		sourceFile: TFile,
		doc: Document,
	): Promise<void> {
		const links = Array.from(
			doc.querySelectorAll<HTMLLinkElement>("link[href]"),
		);

		for (const link of links) {
			if (!link.rel.toLowerCase().split(/\s+/).includes("stylesheet")) {
				continue;
			}

			const linkedFile = this.getLinkedVaultFile(
				sourceFile,
				link.getAttribute("href") ?? "",
				"css",
			);
			if (!linkedFile) {
				continue;
			}

			const css = await this.app.vault.cachedRead(linkedFile);
			const style = doc.createElement("style");
			style.setAttribute("data-html-viewer-inline-source", linkedFile.path);
			style.textContent = css;
			link.replaceWith(style);
		}
	}

	private async inlineLocalScripts(
		sourceFile: TFile,
		doc: Document,
	): Promise<void> {
		const scripts = Array.from(
			doc.querySelectorAll<HTMLScriptElement>("script[src]"),
		);

		for (const script of scripts) {
			const linkedFile = this.getLinkedVaultFile(
				sourceFile,
				script.getAttribute("src") ?? "",
				null,
			);
			if (!linkedFile || !["js", "mjs"].includes(linkedFile.extension)) {
				continue;
			}

			const source = await this.app.vault.cachedRead(linkedFile);
			script.removeAttribute("src");
			script.setAttribute("data-html-viewer-inline-source", linkedFile.path);
			script.textContent = `${source}\n//# sourceURL=${escapeHtmlAttribute(linkedFile.path)}`;
		}
	}

	private getLinkedVaultFile(
		sourceFile: TFile,
		href: string,
		requiredExtension: string | null,
	): TFile | null {
		const path = resolveVaultHref(sourceFile.path, href);
		if (!path) {
			return null;
		}

		const linkedFile = this.app.vault.getAbstractFileByPath(path);
		if (!(linkedFile instanceof TFile)) {
			return null;
		}

		if (
			requiredExtension &&
			linkedFile.extension.toLowerCase() !== requiredExtension
		) {
			return null;
		}

		return linkedFile;
	}

	findOpenHtmlLeaf(
		filePath: string,
		exceptView: HtmlViewerView | null = null,
	): WorkspaceLeaf | null {
		let found: WorkspaceLeaf | null = null;

		this.app.workspace.iterateAllLeaves((leaf) => {
			if (found || leaf.view === exceptView) {
				return;
			}

			if (!(leaf.view instanceof HtmlViewerView)) {
				return;
			}

			const livePath = leaf.view.file?.path;
			const stateFile = leaf.getViewState().state?.file;
			const statePath = typeof stateFile === "string" ? stateFile : null;

			if (livePath === filePath || statePath === filePath) {
				found = leaf;
			}
		});

		return found;
	}

	trackEmbed(embed: HtmlViewerEmbed): void {
		this.embeds.add(embed);
	}

	untrackEmbed(embed: HtmlViewerEmbed): void {
		this.embeds.delete(embed);
	}

	async refreshOpenHtmlDocuments(changedFile?: TFile): Promise<void> {
		const refreshes: Promise<void>[] = [];

		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof HtmlViewerView)) {
				return;
			}

			const openFile = leaf.view.file;
			if (!openFile) {
				return;
			}

			if (!changedFile || this.shouldRefreshForChangedFile(openFile, changedFile)) {
				refreshes.push(leaf.view.renderFile(openFile));
			}
		});

		for (const embed of this.embeds) {
			if (!changedFile || this.shouldRefreshForChangedFile(embed.file, changedFile)) {
				embed.refresh();
			}
		}

		await Promise.all(refreshes);
	}

	private registerHtmlEmbeds(): void {
		const embedRegistry = (this.app as unknown as AppWithEmbedRegistry)
			.embedRegistry;
		if (!embedRegistry) {
			return;
		}

		for (const extension of HTML_EXTENSIONS) {
			embedRegistry.registerExtension(
				extension,
				(context, file) => new HtmlViewerEmbed(context.containerEl, this, file),
			);
			this.register(() => embedRegistry.unregisterExtension(extension));
		}
	}

	private registerVaultWatchers(): void {
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile) {
					void this.refreshOpenHtmlDocuments(file);
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (!isHtmlFile(file)) {
					return;
				}

				this.app.workspace.iterateAllLeaves((leaf) => {
					if (
						leaf.view instanceof HtmlViewerView &&
						leaf.view.file?.path === file.path
					) {
						leaf.view.showDeleted(file);
					}
				});
			}),
		);
	}

	private shouldRefreshForChangedFile(openFile: TFile, changedFile: TFile): boolean {
		if (openFile.path === changedFile.path) {
			return true;
		}

		if (!this.settings.watchSiblingAssets) {
			return false;
		}

		return (
			getParentPath(openFile.path) === getParentPath(changedFile.path) &&
			ASSET_EXTENSIONS.has(changedFile.extension.toLowerCase())
		);
	}

	private async openActiveHtmlFile(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!isHtmlFile(activeFile)) {
			new Notice("Open an .html or .htm file first.");
			return;
		}

		const existingLeaf = this.settings.dedupeTabs
			? this.findOpenHtmlLeaf(activeFile.path)
			: null;
		if (existingLeaf) {
			this.app.workspace.revealLeaf(existingLeaf);
			return;
		}

		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({
			type: VIEW_TYPE_HTML_VIEWER,
			state: { file: activeFile.path },
			active: true,
		});
		this.app.workspace.revealLeaf(leaf);
	}

}

class HtmlViewerSettingTab extends PluginSettingTab {
	private readonly plugin: HtmlViewerPlugin;

	constructor(app: HtmlViewerPlugin["app"], plugin: HtmlViewerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "HTML Viewer" });

		new Setting(containerEl)
			.setName("Show toolbar")
			.setDesc("Show source, script, trusted mode, and refresh controls.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showToolbar)
					.onChange(async (value) => {
						this.plugin.settings.showToolbar = value;
						await this.plugin.saveSettings();
						await this.plugin.refreshOpenHtmlDocuments();
					}),
			);

		new Setting(containerEl)
			.setName("Open one tab per HTML file")
			.setDesc("Focus an existing tab when the same HTML file is opened again.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.dedupeTabs)
					.onChange(async (value) => {
						this.plugin.settings.dedupeTabs = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default source mode")
			.setDesc("Open HTML files as source instead of rendered pages.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.defaultSourceMode)
					.onChange(async (value) => {
						this.plugin.settings.defaultSourceMode = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default scripts")
			.setDesc("Allow JavaScript by default. Keep this off unless most HTML files in the vault are trusted.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.defaultScriptsEnabled)
					.onChange(async (value) => {
						this.plugin.settings.defaultScriptsEnabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default trusted app mode")
			.setDesc("Adds same-origin, form, popup, and download sandbox permissions. Use only for HTML you control.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.defaultTrustedAppMode)
					.onChange(async (value) => {
						this.plugin.settings.defaultTrustedAppMode = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Refresh when sibling assets change")
			.setDesc("Reload open HTML viewers when nearby CSS, JS, image, or data files change.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.watchSiblingAssets)
					.onChange(async (value) => {
						this.plugin.settings.watchSiblingAssets = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default embed height")
			.setDesc("Height in pixels for ![[file.html]] embeds.")
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.embedHeight))
					.setValue(String(this.plugin.settings.embedHeight))
					.onChange(async (value) => {
						this.plugin.settings.embedHeight = parsePositiveInteger(
							value,
							DEFAULT_SETTINGS.embedHeight,
						);
						await this.plugin.saveSettings();
						await this.plugin.refreshOpenHtmlDocuments();
					}),
			);
	}
}
