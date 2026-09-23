import { Extension } from "@tiptap/core";

type ProtectSource = (source: string) => string;

export function protectWordBreakSource(
	text: string,
	protect: ProtectSource,
): string {
	return text.replace(
		/<wbr\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi,
		(source) => protect(source),
	);
}


export const MarkdownWordBreakLiteral = Extension.create({
	name: "wordBreakLiteral",
	markdownTokenizer: {
		name: "wordBreakLiteral",
		level: "inline",
		start: (source) => source.search(/<wbr\b/i),
		tokenize(source) {
			const raw = /^<wbr\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/i.exec(source)?.[0];
			return raw ? { type: "wordBreakLiteral", raw, text: raw } : undefined;
		},
	},
	parseMarkdown: (token, helpers) =>
		helpers.createTextNode(token.raw ?? token.text ?? ""),
});
