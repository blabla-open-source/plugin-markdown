import { Lexer } from "marked";

/** Marked owns escapes and code; count only actual matching HTML tokens. */
export function readInlineHtml(source: string, tag: "span" | "kbd" | "ruby" | "u") {
	const openingPattern = new RegExp(`^<${tag}(?:\\s|>)`, "i");
	if (!openingPattern.test(source)) return null;
	const closingPattern = new RegExp(`^<\\/${tag}\\s*>$`, "i");
	let depth = 0;
	let offset = 0;
	let opening = "";
	for (const token of new Lexer({ gfm: true }).inlineTokens(source)) {
		const raw = token.raw;
		if (token.type === "html" && openingPattern.test(raw)) {
			if (!offset) opening = raw;
			depth += 1;
		}
		if (!opening) return null;
		if (token.type === "html" && closingPattern.test(raw)) depth -= 1;
		offset += raw.length;
		if (depth === 0)
			return {
				opening,
				raw: source.slice(0, offset),
				text: source.slice(opening.length, offset - raw.length),
			};
	}
	return null;
}
