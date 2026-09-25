import { Mark } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const RAW_HTML_BREAK = /^<br\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/i;
const ACTIVE_HTML_BREAK = /<br\s*\/?>/gi;

/** Keep raw BR editable while a decoration supplies the visible break desktop editors show. */
export const MarkdownHtmlBreak = Mark.create({
	name: "htmlBreak",
	code: true,
	excludes: "",
	inclusive: false,
	parseHTML: () => [
		{ tag: "span[data-raw-html-break]", preserveWhitespace: "full" },
	],
	renderHTML: () => [
		"span",
		{
			"data-raw-html-break": "",
			spellcheck: "false",
		},
		0,
	],
	markdownTokenizer: {
		name: "htmlBreak",
		level: "inline",
		start: (source) => source.search(/<br\b/i),
		tokenize(source) {
			const raw = RAW_HTML_BREAK.exec(source)?.[0];
			return raw ? { type: "htmlBreak", raw } : undefined;
		},
	},
	parseMarkdown: (token, helpers) =>
		helpers.applyMark("htmlBreak", [helpers.createTextNode(token.raw ?? "")]),
	renderMarkdown: (node, helpers) => helpers.renderChildren(node),
	addProseMirrorPlugins() {
		return [
			new Plugin({
				props: {
					decorations: (state) => {
						const decorations: Decoration[] = [];
						state.doc.descendants((node, position) => {
							if (!node.isText || !node.text || !this.type.isInSet(node.marks))
								return;
							for (const match of node.text.matchAll(ACTIVE_HTML_BREAK)) {
								decorations.push(
									Decoration.widget(
										position + (match.index ?? 0) + match[0].length,
										createRawHtmlBreak,
										{ ignoreSelection: true, side: 1 },
									),
								);
							}
						});
						return DecorationSet.create(state.doc, decorations);
					},
				},
			}),
		];
	},
});

function createRawHtmlBreak() {
	const element = document.createElement("br");
	element.setAttribute("aria-hidden", "true");
	element.setAttribute("data-raw-html-break-widget", "");
	return element;
}
