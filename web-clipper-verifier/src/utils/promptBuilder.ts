import type { ExtractedContent } from "../types";
import type { WebClipperVerifierSettings } from "../settings";

export function buildVerifyPrompt(
	sourceContent: ExtractedContent,
	clippingBody: string,
	settings: WebClipperVerifierSettings
): string {
	const truncationNote = sourceContent.truncated
		? "\n\n**Note:** The source text was truncated due to length. Only compare content that appears in the source text above."
		: "";

	const basePrompt = `You are a web clipping verification assistant. Your job is to compare an Obsidian Web Clipper's saved markdown against the original source page's text content to verify that the clipping is complete and accurate.

## Source page text (extracted via Readability)
Title: ${sourceContent.title}
${sourceContent.byline ? `Author: ${sourceContent.byline}` : ""}

\`\`\`\`text
${sourceContent.textContent}
\`\`\`\`${truncationNote}

## Clipped markdown (saved in Obsidian)

\`\`\`\`markdown
${clippingBody}
\`\`\`\`

## Your task

Compare the clipped markdown against the source text and report:

1. **Completeness estimate** — What percentage of the source article's substantive content is present in the clipping? (e.g., "~95% complete")

2. **Missing content** — List any paragraphs, sections, or significant text from the source that are absent from the clipping. Quote the first few words of each missing segment so the user can locate them.

3. **Altered content** — Note any text that appears significantly different between source and clipping (beyond expected HTML-to-markdown formatting changes).

4. **Extra content** — Note any substantial content in the clipping that doesn't appear in the source (e.g., added by the clipper or from page chrome).

5. **Metadata accuracy** — If the clipping has frontmatter metadata (title, author, date), verify it matches the source.

## Guidelines
- Ignore formatting differences (bold, italic, headings, lists) — these are expected from HTML-to-markdown conversion.
- Ignore navigation elements, sidebars, footers, ads, and other non-article content that Readability may have included.
- Focus on the article's substantive text content.
- Be concise and practical. If the clipping is complete, say so clearly.
- Use markdown formatting in your response.`;

	if (settings.customPromptAdditions.trim()) {
		return basePrompt + `\n\n## Additional instructions\n${settings.customPromptAdditions}`;
	}

	return basePrompt;
}
