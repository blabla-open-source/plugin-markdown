import { Extension } from "@tiptap/core";

type ProtectSource = (source: string) => string;

const pairedTags =
	"p|h[1-6]|table|figure|ul|ol|dl|left|right|bdo|bdi|dialog|select|textarea|object|applet|map|fieldset|datalist|output|title|menu";
const voidTags = "embed|base|hr";
const doctypeHtml = /<!DOCTYPE(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
const pairedHtml = new RegExp(
	`<(${pairedTags})\\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[^\\n]*?<\\/\\1\\s*>`,
	"gi",
);
const voidHtml = new RegExp(
	`<(?:${voidTags})\\b(?:[^"'<>]|"[^"]*"|'[^']*')*>`,
	"gi",
);
const literalHtml = new RegExp(
	`${doctypeHtml.source}|${pairedHtml.source}|${voidHtml.source}`,
	"gi",
);
const literalHtmlAtStart = new RegExp(`^(?:${literalHtml.source})`, "i");

export function protectInlineHtmlLiteralSource(
	text: string,
	protect: ProtectSource,
): string {
	return text.replace(literalHtml, (source) => protect(source));
}

/** Desktop Markdown editors keep these complete forms literal in ordinary prose. */
export const MarkdownInlineHtmlLiteral = Extension.create({
	name: "inlineHtmlLiteral",
	markdownTokenizer: {
		name: "inlineHtmlLiteral",
		level: "inline",
		start: (source) =>
			source.search(
				/<!DOCTYPE\b|<(?:p|h[1-6]|table|figure|ul|ol|dl|left|right|bdo|bdi|dialog|select|textarea|object|applet|map|fieldset|datalist|output|title|menu|embed|base|hr)\b/i,
			),
		tokenize(source) {
			const raw = literalHtmlAtStart.exec(source)?.[0];
			return raw ? { type: "inlineHtmlLiteral", raw, text: raw } : undefined;
		},
	},
	parseMarkdown: (token, helpers) =>
		helpers.createTextNode(token.raw ?? token.text ?? ""),
});
