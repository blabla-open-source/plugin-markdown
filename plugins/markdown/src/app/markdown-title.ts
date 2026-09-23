export function markdownTitleFromFileName(name: string): string {
	return name.replace(/\.(md|markdown)$/i, "") || "Untitled";
}

export function normalizeMarkdownTitle(value: string): string {
	const trimmed = value.trim();
	return trimmed ? markdownTitleFromFileName(trimmed) : "Untitled";
}
