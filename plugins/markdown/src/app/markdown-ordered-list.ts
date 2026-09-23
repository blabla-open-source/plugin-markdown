import { renderNestedMarkdownContent } from "@tiptap/core";
import type { ProseStyle } from "./markdown-prose-style";
import { ListItem, OrderedList, ORDERED_LIST_MARKER_PATTERN } from "@tiptap/extension-list";

const decimalList = /^ {0,3}\d{1,9}[.)](?:[ \t]|$)/;
const listOpening = new RegExp(`^[ \\t]*(?:${ORDERED_LIST_MARKER_PATTERN})[.)][ \\t]+`);
const extendedTokenizer = OrderedList.config.markdownTokenizer;

/** Decimal lists use the document's Marked grammar, including strict indentation. */
export const MarkdownOrderedList = OrderedList.extend({
	markdownTokenizer: {
		...extendedTokenizer,
		name: "orderedList",
		level: "block",
		tokenize(source, tokens, helpers) {
			// A start hint controls paragraph interruption, not whether this block is a list.
			if (decimalList.test(source) || !listOpening.test(source)) return undefined;
			return extendedTokenizer?.tokenize(source, tokens, helpers);
		},
	},
});

export function createMarkdownListItem(strictMode = true) {
	return ListItem.extend({
		renderMarkdown(node, helpers, context) {
			const attrs = context.meta?.parentAttrs;
			const decimal =
				context.parentType === "orderedList" &&
				(!attrs?.type || attrs.type === "1");
			if (context.parentType === "orderedList" && !decimal)
				return ListItem.config.renderMarkdown?.(node, helpers, context) ?? "";
			const style = attrs?.proseStyle as ProseStyle | null;
			const index = style?.fixed ? 0 : (context.index || 0);
			const number = (Number(attrs?.start) || 1) + index;
			const marker = decimal ? `${number}${style?.marker ?? "."}` : (style?.marker ?? "-");
			const task = node.type === "taskItem";
			const prefix = marker + " ".repeat(style?.gap ?? 1) + (task ? `[${node.attrs?.checked ? "x" : " "}] ` : "");
			const minimum = strictMode && decimal ? prefix.length : 2;
			const indent = style?.indent === "\t" ? "\t" : " ".repeat(Math.max(minimum, style?.indent?.length ?? 2));
			return renderNestedMarkdownContent(node, {
				...helpers,
				indent: (text) => indent + text,
				renderChildren: (children) => helpers.renderChildren(children).replace(/\n/g, `\n${indent}`),
			}, prefix, context);
		},
	});
}
