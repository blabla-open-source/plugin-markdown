import { InputRule, Mark } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Lexer } from "marked";
import { HTML_RAW_ELEMENT_TAGS } from "./markdown-html-block-source";

/** Comment text is editable source, never DOM markup or collaborative metadata. */
export const MarkdownHtmlComment = Mark.create({
	name: "htmlComment",
	code: true,
	excludes: "",
	inclusive: false,
	parseHTML: () => [
		{ tag: "span[data-html-comment]", preserveWhitespace: "full" },
	],
	renderHTML: () => [
		"span",
		{
			"data-html-comment": "",
			"aria-label": "HTML comment",
			spellcheck: "false",
		},
		0,
	],
	markdownTokenizer: {
		name: "htmlComment",
		level: "inline",
		start: (source) => source.indexOf("<!--"),
		tokenize(source) {
			if (!source.startsWith("<!--")) return undefined;
			const token = new Lexer({ gfm: true }).inlineTokens(source)[0];
			return token?.type === "html"
				? { type: "htmlComment", raw: token.raw }
				: undefined;
		},
	},
	parseMarkdown: (token, helpers) =>
		helpers.applyMark("htmlComment", [helpers.createTextNode(token.raw ?? "")]),
	renderMarkdown: (node, helpers) => helpers.renderChildren(node),
	addInputRules() {
		return [
			new InputRule({
				find: /<!--$/,
				handler: ({ state, range }) => {
					const before = state.doc.textBetween(
						state.selection.$from.start(),
						range.from,
					);
					// An escaped opener is prose, not a comment.
					if ((before.match(/\\+$/)?.[0].length ?? 0) % 2) return null;
					state.tr
						.insertText("<!--", range.from, range.to)
						.addMark(range.from, range.from + 4, this.type.create())
						.addStoredMark(this.type.create());
					return undefined;
				},
			}),
		];
	},
	addProseMirrorPlugins() {
		return [
			new Plugin({
				props: {
					handlePaste: (view, event, slice) => {
						if (!event.clipboardData?.getData("text/html")) return false;
						let hasComment = false;
						slice.content.descendants((node) => {
							if (this.type.isInSet(node.marks)) hasComment = true;
						});
						if (!hasComment) return false;
						// Already-parsed HTML is not Markdown input. In particular,
						// paste rules must not consume delimiters inside literal comments.
						view.dispatch(
							view.state.tr.replaceSelection(slice).scrollIntoView(),
						);
						return true;
					},
					handleTextInput: (view, from, to, text) => {
						const marks =
							view.state.storedMarks ?? view.state.selection.$from.marks();
						if (!this.type.isInSet(marks)) return false;
						const closed =
							`${view.state.doc.textBetween(Math.max(0, from - 2), from)}${text}`.endsWith(
								"-->",
							);
						const tr = view.state.tr.insertText(text, from, to);
						if (closed) tr.removeStoredMark(this.type);
						else tr.addStoredMark(this.type.create());
						view.dispatch(tr);
						return true;
					},
					transformPastedHTML: preserveClipboardComments,
				},
			}),
		];
	},
});

function preserveClipboardComments(html: string): string {
	if (!html.includes("<!--")) return html;
	// Detached template contents are inert. Do not execute or fetch comment text.
	const template = document.createElement("template");
	template.innerHTML = html;
	const walker = document.createTreeWalker(
		template.content,
		NodeFilter.SHOW_COMMENT,
	);
	const comments: Comment[] = [];
	while (walker.nextNode()) comments.push(walker.currentNode as Comment);
	const first = comments[0];
	const last = comments.at(-1);
	// Only a paired outer clipboard envelope is transport metadata. A comment
	// named StartFragment inside a paragraph is still the user's source.
	if (
		first?.data === "StartFragment" &&
		last?.data === "EndFragment" &&
		first.parentNode === template.content &&
		last.parentNode === template.content
	) {
		comments.shift()?.remove();
		comments.pop()?.remove();
	}
	for (const comment of comments) {
		// These nodes already retain outerHTML. Do not mutate their original source.
		if (
			comment.parentElement?.closest(
				[
					"pre",
					"code",
					"ruby",
					"audio",
					"video",
					"iframe",
					...HTML_RAW_ELEMENT_TAGS,
				].join(","),
			)
		)
			continue;
		const span = document.createElement("span");
		span.setAttribute("data-html-comment", "");
		span.textContent = `<!--${comment.data}-->`;
		comment.replaceWith(span);
	}
	return template.innerHTML;
}
