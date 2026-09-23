// Whole physical lines only; four-space indentation remains a code block.
export const TOC_LINE = /^ {0,3}(\[toc\]|\{:toc\}|\[\[_TOC_\]\])[\t ]*$/i;
export const TOC_START =
	/\n {0,3}(?:\[toc\]|\{:toc\}|\[\[_TOC_\]\])[\t ]*(?=\n|$)/i;
const KRAMDOWN_TOC = /^ {0,3}[-+*][\t ]+[^\n]+\n {0,3}\{:[\t ]*toc(?:[\t ]+[^}\n]*)?\}[\t ]*(?=\n|$)/;

export function readMarkdownToc(source: string) {
	const line = source.split("\n", 1)[0] ?? "";
	const marker = TOC_LINE.exec(line)?.[1];
	if (marker) return { raw: line, marker };
	const raw = KRAMDOWN_TOC.exec(source)?.[0];
	return raw ? { raw, marker: raw } : null;
}

export function tocMarker(text: string): string | null {
	const block = readMarkdownToc(text);
	return block?.raw.length === text.length ? block.marker : null;
}
