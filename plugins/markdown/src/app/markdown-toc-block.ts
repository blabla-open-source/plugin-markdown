import { markdownBlockStart } from "./markdown-grammar";
import { Node } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { readMarkdownToc, tocMarker, TOC_START } from "./markdown-toc-source";
import { createTocBlockView } from "./markdown-toc-view";

export const MarkdownTocBlock = Node.create({
	name: "tableOfContentsBlock",
	group: "block",
	atom: true,
	selectable: true,
	draggable: true,
	addAttributes() {
		return {
			marker: {
				default: "[TOC]",
				rendered: false,
				parseHTML: (element) =>
					tocMarker(element.getAttribute("data-toc-marker") ?? "") ?? "[TOC]",
			},
		};
	},
	parseHTML() {
		return [
			{ tag: "nav[data-markdown-toc]" },
			{ tag: 'div.md-toc[mdtype="toc"]' },
		];
	},
	renderHTML({ node }) {
		return [
			"nav",
			{
				"data-markdown-toc": "",
				"data-toc-marker": node.attrs.marker,
				"aria-label": "Table of contents",
			},
			node.attrs.marker,
		];
	},
	markdownTokenizer: {
		name: "tableOfContentsBlock",
		level: "block",
		// Marked searches src.slice(1); only a real newline can interrupt prose.
		start: (source) => {
			return markdownBlockStart(source, TOC_START, 1);
		},
		tokenize(source) {
			const block = readMarkdownToc(source);
			return block
				? { type: "tableOfContentsBlock", ...block }
				: undefined;
		},
	},
	parseMarkdown(token, helpers) {
		return helpers.createNode("tableOfContentsBlock", { marker: token.marker });
	},
	renderMarkdown: (node) => tocMarker(node.attrs?.marker ?? "") ?? "[TOC]",
	addNodeView: () => createTocBlockView,
	addKeyboardShortcuts() {
		return {
			Enter: () => {
				const { selection } = this.editor.state;
				if (
					selection instanceof NodeSelection &&
					selection.node.type === this.type
				)
					return this.editor.commands.insertContentAt(selection.to, {
						type: "paragraph",
					});
				const { $from, empty } = selection;
				if (!empty || $from.parent.type.name !== "paragraph") return false;
				const marker = tocMarker($from.parent.textContent);
				if (
					!marker ||
					$from.parentOffset !== $from.parent.content.size ||
					$from.parent.children.some((child) => child.marks.length > 0)
				)
					return false;
				return this.editor.commands.command(({ tr }) => {
					const start = $from.before();
					closeHistory(tr).replaceWith(start, $from.after(), [
						this.type.create({ marker }),
						$from.parent.type.create(),
					]);
					tr.setSelection(TextSelection.create(tr.doc, start + 2));
					return true;
				});
			},
		};
	},
});
