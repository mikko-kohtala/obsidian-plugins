import type { WebClipperVerifierSettings } from "./settings";

export interface VerifyResult {
	success: boolean;
	output: string;
	error?: string;
	timedOut?: boolean;
	exitCode?: number;
}

export interface ClippingMetadata {
	source: string;
	title?: string;
	author?: string;
	published?: string;
	created?: string;
	description?: string;
	tags?: string[];
}

export interface ExtractedContent {
	title: string;
	textContent: string;
	byline: string | null;
	excerpt: string | null;
	length: number;
	truncated: boolean;
}

export interface VerifyContext {
	fileContent: string;
	settings: WebClipperVerifierSettings;
}
