import { Lexer, type Links, Marked, type marked, Tokenizer } from "marked";
import { trackMarkdownLexicalSource } from "./markdown-lexical-source";

export const definitionPrefix = /^ {0,3}\[([^\]\r\n]+)\]:[ \t]*/;
export const validReferenceLabel = (value: string) =>
	Boolean(value.trim()) && !/[[\]\r\n]/.test(value);

export function normalizeReferenceLabel(label: string) {
	return label.replace(/\s+/g, " ").toLowerCase();
}

/** Desktop Markdown editors support full/collapsed references, including unresolved ones.
 * Marked still owns their parsing; bare brackets remain literal prose. */
class ReferenceTokenizer extends Tokenizer {
	override heading(source: string) {
		const token = super.heading(source);
		// Block separators belong to the space token, where the editor counts
		// authored empty paragraphs. Heading syntax ends before those newlines.
		if (token) token.raw = token.raw.replace(/\n+$/, "");
		return token;
	}
	override reflink(source: string, links: Links) {
		const collapsed = this.rules.inline.nolink.exec(source);
		const match =
			this.rules.inline.reflink.exec(source) ??
			(collapsed?.[0].endsWith("[]") ? collapsed : null);
		if (!match || match[1] === undefined) return undefined;
		const referenceLabel = normalizeReferenceLabel(match[2] || match[1]);
		const token = super.reflink(
			source,
			links[referenceLabel]
				? links
				: {
						...links,
						[referenceLabel]: { href: "", title: "" },
					},
		);
		const referenceSuffix = match[0].slice(
			match[1].length + (source.startsWith("!") ? 3 : 2),
		);
		return token?.type === "link" || token?.type === "image"
			? { ...token, referenceLabel, referenceSuffix }
			: token;
	}
}

/** Use Marked's tolerant block algorithms without switching off GFM inline syntax. */
class TolerantBlockTokenizer extends ReferenceTokenizer {
	override heading(source: string) {
		const tokenizer = new Tokenizer({ ...this.options, pedantic: true });
		tokenizer.rules = {
			...this.rules,
			block: {
				...this.rules.block,
				heading: Lexer.rules.block.pedantic.heading,
			},
		};
		tokenizer.lexer = this.lexer;
		const token = tokenizer.heading(source);
		if (token) token.raw = token.raw.replace(/\n+$/, "");
		return token;
	}

	override list(source: string) {
		if (!this.rules.block.list.test(source)) return undefined;
		const tokenizer = new Tokenizer({ ...this.options, pedantic: true });
		tokenizer.rules = this.rules;
		tokenizer.lexer = this.lexer;
		return tokenizer.list(source);
	}

	override paragraph(source: string) {
		// A relaxed heading also interrupts prose. Leave all other block rules to GFM.
		const boundary = source.search(/\n(?= {0,3}#{1,6}[^#\s])/);
		return super.paragraph(
			boundary < 0 ? source : source.slice(0, boundary + 1),
		);
	}
}

export function markdownGrammar(strictMode = true) {
	const instance = new Marked();
	instance.setOptions({ tokenizer: new ReferenceTokenizer() });
	if (!strictMode)
		instance.setOptions({ tokenizer: new TolerantBlockTokenizer() });
	// Tiptap types its injectable instance as the callable namespace, but uses
	// the documented Marked instance methods (Lexer, defaults, use and setOptions).
	return trackMarkdownLexicalSource(instance as unknown as typeof marked);
}

/** Block-start hints only interrupt the current paragraph. All our hints
 * recognize opening lines; the tokenizer still receives the complete source.
 * Looking past its first blank line repeatedly rescans the rest of a long file.
 */
export function markdownBlockStart(
	source: string,
	pattern: RegExp,
	offset = 0,
): number {
	const blank = source.search(/\n[ \t]*\n/);
	const index = (blank < 0 ? source : source.slice(0, blank + 1)).search(pattern);
	return index < 0 ? -1 : index + offset;
}
