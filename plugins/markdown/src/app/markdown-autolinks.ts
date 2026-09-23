import { InputRule, type Editor, type MarkdownToken } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { Lexer } from "marked";
import { decodeLinkAttribute } from "./markdown-link-source";

/** Marked retains the authored syntax even though every link has token type link. */
export function automaticLinkKind(token: MarkdownToken) {
	if (token.htmlLink || !token.raw || token.raw.startsWith("[")) return null;
	return token.raw.startsWith("<") ? "angle" : "bare";
}

export function renderAutomaticLink(kind: unknown, text: string, href: string) {
	if (kind !== "bare" && kind !== "angle") return null;
	const source = kind === "angle" ? `<${text}>` : text;
	const tokens = new Lexer({ gfm: true }).inlineTokens(source);
	const token = tokens[0];
	return tokens.length === 1 &&
		token?.type === "link" &&
		automaticLinkKind(token) &&
		decodeLinkAttribute(token.href) === href
		? source
		: null;
}

/** Preserve disabled URL syntax through the normal text serializer's HTML escaping. */
export function protectInactiveAutolinks(
	text: string,
	protect: (text: string) => string,
) {
	return new Lexer({ gfm: true })
		.inlineTokens(text)
		.map((token) =>
			token.type === "link" && automaticLinkKind(token)
				? protect(token.raw)
				: token.raw,
		)
		.join("");
}

/** An explicit Markdown link is an author command, independent of URL detection. */
export function markdownLinkInputRule(editor: Editor) {
	return new InputRule({
		find(text) {
			if (!/[)\]]$/.test(text)) return null;
			const instance = editor.markdown?.instance;
			if (!instance) return null;
			const tokens = new instance.Lexer(instance.defaults).inlineTokens(text);
			const last = tokens.at(-1);
			if (last?.type !== "link" || !last.raw.startsWith("[")) return null;
			return { index: text.length - last.raw.length, text: last.raw };
		},
		handler({ state, range, match }) {
			const link = state.schema.marks.link;
			if (!link) return null;
			const parsed = editor.markdown?.parse(match[0]);
			const content = parsed?.content?.[0]?.content;
			if (
				!content?.some((node) =>
					node.marks?.some((mark) => mark.type === "link"),
				)
			)
				return null;
			state.tr
				.replaceWith(
					range.from,
					range.to,
					Fragment.fromArray(
						content.map((node) => editor.schema.nodeFromJSON(node)),
					),
				)
				.removeStoredMark(link)
				.setMeta("preventAutolink", true);
			return undefined;
		},
	});
}
