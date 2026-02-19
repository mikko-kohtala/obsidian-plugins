import { requestUrl } from "obsidian";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { ExtractedContent } from "../types";
import type { WebClipperVerifierSettings } from "../settings";

const TAG = "[clipper-verifier]";

export class FetchError extends Error {
	constructor(message: string, public statusCode?: number) {
		super(message);
		this.name = "FetchError";
	}
}

export async function extractFromUrl(
	url: string,
	settings: WebClipperVerifierSettings
): Promise<ExtractedContent> {
	console.log(TAG, "fetching:", url);

	let html: string;
	try {
		const response = await requestUrl({
			url,
			headers: {
				"User-Agent": settings.userAgent,
				"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.5",
			},
			throw: false,
		});

		if (response.status === 401 || response.status === 403) {
			throw new FetchError(
				`Access denied (HTTP ${response.status}). The page may require login or be behind a paywall.`,
				response.status
			);
		}
		if (response.status === 429) {
			throw new FetchError(
				"Rate limited (HTTP 429). Try again later.",
				429
			);
		}
		if (response.status >= 400) {
			throw new FetchError(
				`HTTP error ${response.status}: ${response.headers?.["statusText"] ?? "Request failed"}`,
				response.status
			);
		}

		html = response.text;
	} catch (error: unknown) {
		if (error instanceof FetchError) throw error;
		const msg = error instanceof Error ? error.message : String(error);
		throw new FetchError(`Failed to fetch URL: ${msg}`);
	}

	console.log(TAG, "fetched HTML:", html.length, "chars");

	// Parse with linkedom and extract with Readability
	const { document } = parseHTML(html);

	// Set the document URL for Readability's relative URL resolution
	// linkedom doesn't support setting documentURI directly on the document,
	// so we add a <base> tag
	const base = document.createElement("base");
	base.setAttribute("href", url);
	document.head.appendChild(base);

	const reader = new Readability(document);
	const article = reader.parse();

	if (!article || !article.textContent?.trim()) {
		throw new FetchError(
			"Could not extract article content. The page may require JavaScript to render, or it may not contain article content."
		);
	}

	let textContent = article.textContent;
	let truncated = false;

	if (textContent.length > settings.maxContentLength) {
		textContent = textContent.slice(0, settings.maxContentLength);
		truncated = true;
		console.log(TAG, "truncated content to", settings.maxContentLength, "chars");
	}

	console.log(TAG, "extracted:", textContent.length, "chars |", "title:", article.title);

	return {
		title: article.title,
		textContent,
		byline: article.byline,
		excerpt: article.excerpt,
		length: article.length,
		truncated,
	};
}
