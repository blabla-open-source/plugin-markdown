import { MarkdownSourceManager } from "./markdown-source-manager";
import { markMarkdownSourcePreserving } from "./markdown-source-operations";
import { recordMarkdownPresentationPartition } from "./markdown-presentation-partitions";
import { serializeMarkdownHTMLElement } from "./markdown-html-serialization";
import { markdownBlockStart } from "./markdown-grammar";
import { defaultCodeEditorConfiguration } from "./markdown-code-editing";
import { Extension, Node } from "@tiptap/core";
import { Fragment, type Schema } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import type { BlablaHostBridge } from "../host/host-api";
import {
	HTML_BLOCK_START,
	HTML_RAW_ELEMENT_TAGS,
	readHtmlBlock,
	SOURCE_ONLY_HTML_START,
} from "./markdown-html-block-source";
import {
	exitHtmlBlock,
	type HtmlBlockOpenLink,
	htmlBlockNodeView,
} from "./markdown-html-block-view";
import type { MarkdownMediaSourceResolver } from "./markdown-media-source";

// Clipboard ordering must not change the schema's default paragraph node.
const HtmlBlockClipboard = Extension.create({
	name: "htmlBlockClipboard",
	priority: 1002,
	transformPastedHTML(html) {
		// Preserve literal fragments before the browser handles head/meta or
		// inline transforms touch descendants. The envelope is escaped text.
		const block = readHtmlBlock(html);
		if (
			!block ||
			block.raw.length !== html.length ||
			!SOURCE_ONLY_HTML_START.test(html)
		)
			return html;
		const pre = document.createElement("pre");
		pre.setAttribute("data-html-source", "");
		pre.textContent = block.text;
		return pre.outerHTML;
	},
});

/** HTML remains literal source; disclosure state never becomes document state. */
export const MarkdownHtmlBlock = (
	openLink: HtmlBlockOpenLink,
	resolver: MarkdownMediaSourceResolver,
	navigation: BlablaHostBridge["navigation"],
) =>
	Node.create({
		name: "htmlBlock",
		addOptions: () => ({ getCodeEditorConfiguration: () => defaultCodeEditorConfiguration }),
		group: "block",
		content: "text*",
		marks: "",
		code: true,
		defining: true,
		isolating: true,
		addExtensions() {
			return [HtmlBlockClipboard];
		},
		parseHTML() {
			return [
				// Keep accepting the clipboard envelope emitted before the shared block.
				{
					tag: "pre[data-html-source],pre[data-html-details]",
					preserveWhitespace: "full" as const,
				},
				...[...HTML_RAW_ELEMENT_TAGS, "img[srcset]"].map((tag) => ({
					tag,
					// Literal HTML takes precedence over generic image parsing.
					priority: 60,
					getContent: (element: globalThis.Node, schema: Schema, onSource?: (source: {kind: string; value: unknown}) => void) => {
						const serialization = serializeMarkdownHTMLElement(element as HTMLElement);
						onSource?.({kind: "markdown-html", value: serialization});
						return Fragment.from(schema.text(serialization.text));
					},
				})),
			];
		},
		renderHTML: () => ["pre", { "data-html-source": "" }, 0],
		markdownTokenizer: {
			name: "htmlBlock",
			level: "block",
			start: (source) => {
				return markdownBlockStart(source,
					new RegExp(`\\n${HTML_BLOCK_START.source.slice(1)}`, "i"), 1,
				);
			},
			tokenize: (source, _tokens, helpers) => {
				const block = readHtmlBlock(source);
				const point=helpers.sourcePoint?.();
				const claimed=block && block.sourceEndsAtEof && point===block.raw.length;
				if(claimed){ block.text=block.raw; helpers.claimSourcePoint?.(); }
				return block ? { type: "htmlBlock", ...block, ...(claimed?{sourceContentEnd:point}:{}), textSourceRange: { from: 0, to: block.text.length } } : undefined;
			},
		},
		parseMarkdown: (token, helpers) =>
			helpers.createNode(
				"htmlBlock",
				{},
				token.text ? [helpers.createTokenText(token)] : [],
			),
		renderMarkdown: (node) =>
			node.content?.map((child) => child.text ?? "").join("") ?? "",
		addNodeView: () => htmlBlockNodeView(openLink, resolver, navigation),
		addProseMirrorPlugins() {
			return [
				new Plugin({
					appendTransaction: (transactions, before, after) => {
						const { $from } = before.selection;
						if ($from.parent.type !== this.type) return null;
						const position = transactions.reduce(
							(pos, transaction) => transaction.mapping.map(pos),
							$from.before(),
						);
						const node = $from.parent;
						// An exit at the document end can append a paragraph. Follow the
						// unchanged raw node through that transaction, not through edits/undo.
						if (after.doc.nodeAt(position) !== node) return null;
						if (
							after.selection.from >= position &&
							after.selection.to <= position + node.nodeSize
						)
							return null;
						if (!node.textContent.trim() || !this.editor.markdown) return null;
						if (!(this.editor.markdown instanceof MarkdownSourceManager)) throw new Error("HTML folding requires the source parser.");
						const source = this.editor.markdown.parseSource(node.textContent);
						const parsed = after.schema.nodeFromJSON(source.doc);
						if (parsed.childCount === 1 && parsed.firstChild?.eq(node))
							return null;
						const $position = after.doc.resolve(position);
						if (
							!$position.parent.canReplace(
								$position.index(),
								$position.index() + 1,
								parsed.content,
							)
						)
							return null;
						// Use the normal parser only after leaving the literal source editor.
						// The appended change follows the exit transaction's native undo group.
						const tr = markMarkdownSourcePreserving(after.tr).replaceWith(
							position,
							position + node.nodeSize,
							parsed.content,
						);
						recordMarkdownPresentationPartition(tr, position, position + node.nodeSize, parsed.content.size, source);
						return tr;
					},
				}),
			];
		},
		addKeyboardShortcuts() {
			return {
				Enter: () => {
					if (this.editor.isActive(this.name))
						return this.editor.commands.newlineInCode();
					const { $from, empty } = this.editor.state.selection;
					if (
						!empty ||
						$from.parent.type.name !== "paragraph" ||
						!(
							$from.parent.textContent === "<!--" ||
							($from.parent.textContent.endsWith(">") &&
								!$from.parent.textContent.includes("\n") &&
								readHtmlBlock($from.parent.textContent))
						) ||
						$from.parentOffset !== $from.parent.content.size
					)
						return false;
					return this.editor.commands.setNode(this.name);
				},
				"Mod-Enter": () => exitHtmlBlock(this.editor),
				"Mod-a": () => {
					const { $from, $to } = this.editor.state.selection;
					return (
						$from.parent.type === this.type &&
						$from.sameParent($to) &&
						this.editor.commands.setTextSelection({
							from: $from.start(),
							to: $from.end(),
						})
					);
				},
				Backspace: () => {
					const { $from, empty } = this.editor.state.selection;
					if (
						!empty ||
						$from.parent.type !== this.type ||
						$from.parentOffset !== 0
					)
						return false;
					return $from.parent.content.size === 0
						? this.editor.commands.setParagraph()
						: true;
				},
			};
		},
	});
