import { Node } from "@tiptap/core";
import { readInlineHtml } from "./markdown-inline-html";
import { inlineTagInputRule } from "./markdown-inline-tag-input";

/** Inline content preserves nested key combinations, unlike a flat mark. */
export const MarkdownKeyboard = Node.create({
	name: "keyboard",
	group: "inline",
	inline: true,
	isolating: true,
	content: "inline*",
	parseHTML: () => [{ tag: "kbd" }],
	renderHTML: () => ["kbd", 0],
	addNodeView() {
		return () => {
			const dom = document.createElement("span");
			const contentDOM = document.createElement("kbd");
			const boundary = () => {
				const span = document.createElement("span");
				span.contentEditable = "false";
				span.setAttribute("aria-hidden", "true");
				span.textContent = "\u2060";
				return span;
			};
			// View-only boundaries keep Chromium input outside a completed key.
			// Only contentDOM enters the document and clipboard serializers.
			dom.append(boundary(), contentDOM, boundary());
			return { dom, contentDOM };
		};
	},
	markdownTokenizer: {
		name: "keyboard",
		level: "inline",
		start: (source) => source.search(/<\/?kbd\b/i),
		tokenize(source, _tokens, helpers) {
			const block = readInlineHtml(source, "kbd");
			if (block)
				return {
					...block,
					type: "keyboard",
					tokens: helpers.inlineTokens(block.text),
				};
			const raw = /^<\/?kbd\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/i.exec(source)?.[0];
			return raw
				? { type: "keyboard", raw, text: raw, literal: true }
				: undefined;
		},
	},
	parseMarkdown: (token, helpers) =>
		token.literal
			? helpers.createTextNode(token.text ?? "")
			: helpers.createNode(
					"keyboard",
					{},
					helpers.parseInline(token.tokens ?? []),
				),
	renderMarkdown: (node, helpers) =>
		`<kbd>${helpers.renderChildren(node.content ?? [])}</kbd>`,
	addInputRules() {
		return [inlineTagInputRule(this.editor, null, "kbd")];
	},
});
