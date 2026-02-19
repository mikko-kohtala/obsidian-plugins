import type { MarkdownFormatCheckerSettings } from "../settings";

export function buildFormatCheckPrompt(
	fileName: string,
	fileContent: string,
	settings: MarkdownFormatCheckerSettings
): string {
	const basePrompt = `You are a markdown formatting checker for an Obsidian vault.

Use the /obsidian-markdown skill to check the formatting of this file against Obsidian markdown best practices and common formatting rules.

If you find issues that need fixing, use the /obsidian-cli skill to describe the exact fixes needed.

## File being checked
**Filename:** ${fileName}

## Rules to check
1. Headings: proper hierarchy (no skipping levels), single H1 per file, blank lines before and after headings
2. Lists: consistent marker style (all dashes or all asterisks), proper indentation, blank lines around list blocks
3. Links: valid Obsidian wiki-link syntax ([[...]]), no broken external link formatting
4. Blank lines: no excessive consecutive blank lines (max 2), file ends with single newline
5. Frontmatter: if present, valid YAML between --- delimiters
6. Code blocks: properly closed fences, language identifiers where appropriate
7. Emphasis: consistent use of * or _ for italic/bold, no unmatched markers
8. Tags: proper #tag format, no spaces in tags
9. Trailing whitespace: no trailing spaces on lines (except intentional line breaks with two spaces)

## Output format
Provide your findings as a structured report:
- Start with a summary line: "X issue(s) found" or "No issues found - formatting looks good!"
- For each issue, include:
  - **Line number** (or range)
  - **Rule violated**
  - **Description** of the problem
  - **Suggestion** for how to fix it
- End with a "Suggested fixes" section if there are issues

## File content
\`\`\`markdown
${fileContent}
\`\`\``;

	if (settings.customPromptAdditions.trim()) {
		return basePrompt + `\n\n## Additional instructions\n${settings.customPromptAdditions}`;
	}

	return basePrompt;
}
