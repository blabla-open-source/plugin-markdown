const OPENING = /^(\uFEFF?)---[\t ]*(?:\r\n|\n|\r)/u;
const CLOSING = /(?:^|\r\n|\n|\r)(---|\.\.\.)[\t ]*(?=\r\n|\n|\r|$)/u;
const LINE_BREAKS = /\r\n|\n|\r/gu;

export function encodeFrontMatterText(text: string): string {
	return text.replace(/^(\u200b*(?:---|\.\.\.)[\t ]*)$/gmu, "\u200b$1");
}

export function decodeFrontMatterText(text: string): string {
	return text.replace(/^\u200b(?=\u200b*(?:---|\.\.\.)[\t ]*$)/gmu, "");
}

/** Read only the document prefix. YAML stays text, including invalid YAML. */
export function readMarkdownFrontMatter(source: string) {
	const opening = OPENING.exec(source);
	if (!opening) return null;

	const rest = source.slice(opening[0].length);
	const closing = CLOSING.exec(rest);
	if (!closing) return null;

	return {
		bom: opening[1],
		closing: closing[1],
		raw: source.slice(0, opening[0].length + closing.index + closing[0].length),
		text: rest.slice(0, closing.index),
	};
}

export function frontMatterSourcesEqual(left: string, right: string): boolean {
	return left.replace(LINE_BREAKS, "\n") === right.replace(LINE_BREAKS, "\n");
}
