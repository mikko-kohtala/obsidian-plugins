import type { MarkdownFormatCheckerSettings } from "../settings";

export function buildApplyFixPrompt(
	fileName: string,
	fileContent: string,
	checkResults: string,
	settings: MarkdownFormatCheckerSettings
): string {
	const basePrompt = `You are a markdown formatting fixer for an Obsidian vault.

You previously checked the following file and found formatting issues. Now output the exact edits needed to fix them.

## Output format
For each fix, output a SEARCH/REPLACE block using this exact format:

<<<SEARCH
exact text to find
===
replacement text
>>>

## CRITICAL INSTRUCTIONS
- Output ONLY SEARCH/REPLACE blocks, nothing else
- No commentary, explanations, or preamble
- The SEARCH text must be an EXACT match of the original file content (including whitespace and newlines)
- Include enough context in SEARCH to be unique (typically 1-3 lines)
- Preserve all content, links, and meaning — only fix formatting
- Each block fixes one issue

## File being fixed
**Filename:** ${fileName}

## Issues found during check
${checkResults}

## Original file content
\`\`\`\`markdown
${fileContent}
\`\`\`\``;

	if (settings.customPromptAdditions.trim()) {
		return basePrompt + `\n\n## Additional instructions\n${settings.customPromptAdditions}`;
	}

	return basePrompt;
}

export function buildFormatCheckPrompt(
	fileName: string,
	fileContent: string,
	settings: MarkdownFormatCheckerSettings
): string {
	const skillInstructions = settings.provider === "claude"
		? `Use the /obsidian-markdown skill to check the formatting of this file against Obsidian markdown best practices and common formatting rules.

If you find issues that need fixing, use the /obsidian-cli skill to describe the exact fixes needed.`
		: `Check the formatting of this Obsidian markdown file against the rules below.`;

	const basePrompt = `You are a markdown formatting checker for an Obsidian vault.

${skillInstructions}

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
Be concise and natural. Start with an overall assessment of the file in one sentence.
Then list each issue as a numbered item with:
- A short descriptive title
- The affected line number(s)
- What's wrong and how to fix it, with inline code examples where helpful
If there are no issues, say so clearly in one sentence.
Do not use tables or deeply nested bullet lists.

## File content
\`\`\`markdown
${fileContent}
\`\`\``;

	if (settings.customPromptAdditions.trim()) {
		return basePrompt + `\n\n## Additional instructions\n${settings.customPromptAdditions}`;
	}

	return basePrompt;
}
