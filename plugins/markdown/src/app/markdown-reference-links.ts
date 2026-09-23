import { markdownBlockStart } from "./markdown-grammar";
import { type Editor, InputRule, Node } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import { closeOtherSourceEditors } from "./markdown-source-focus";
import {
	definitionPrefix,
	validReferenceLabel,
	normalizeReferenceLabel,
} from "./markdown-grammar";
import { referenceDefinitionView } from "./markdown-reference-definition-view";
import { referenceResolution } from "./markdown-reference-resolution";

/** Focus the single definition owner, creating a missing address in the document. */
export function focusReferenceDefinition(editor: Editor, label: string) {
	if (!validReferenceLabel(label)) return false;
	const view = editor.view;
	closeOtherSourceEditors(editor, null, view.state.selection.from);
	let found: number | undefined;
	let insertAt = view.state.doc.content.size;
	view.state.doc.descendants((node, pos) => {
		if (node.type.name !== "linkDefinition") return;
		insertAt = pos + node.nodeSize;
		if (
			found === undefined &&
			normalizeReferenceLabel(
				definitionPrefix.exec(node.attrs.prefix)?.[1] ?? "",
			) === normalizeReferenceLabel(label)
		)
			found = pos;
	});
	const tr = view.state.tr;
	if (found === undefined) {
		const type = view.state.schema.nodes.linkDefinition;
		if (!type || !view.editable) return false;
		closeHistory(tr).insert(insertAt, type.create({ prefix: `[${label}]: ` }));
		found = insertAt;
	}
	view.dispatch(
		tr.setSelection(TextSelection.create(tr.doc, found + 1)).scrollIntoView(),
	);
	view.focus();
	return true;
}

/** Marked owns complete definitions. Empty address blocks remain editable and durable. */
export const MarkdownLinkDefinition = Node.create({
	name: "linkDefinition",
	group: "block",
	content: "text*",
	marks: "",
	code: true,
	defining: true,
	isolating: true,
	addAttributes: () => ({ prefix: { default: "", rendered: false } }),
	markdownTokenName: "def",
	markdownTokenizer: {
		name: "def",
		level: "block",
		start: (source) =>
			markdownBlockStart(source, /^ {0,3}\[(?!\^)[^\]\r\n]+\]:[ \t]*(?:\n|$)/m),
		tokenize(source) {
			const raw = /^ {0,3}\[(?!\^)[^\]\r\n]+\]:[ \t]*(?:\n|$)/.exec(
				source,
			)?.[0];
			return raw ? { type: "def", raw } : undefined;
		},
	},
	parseMarkdown(token, helpers) {
		const source = String(token.raw).replace(/[\r\n]+$/, "");
		const prefix = definitionPrefix.exec(source)?.[0] ?? "";
		const body = source.slice(prefix.length);
		return helpers.createNode(
			"linkDefinition",
			{ prefix },
			body ? [helpers.createTokenText(Object.assign(token, {
				text: body,
				textSourceRange: { from: prefix.length, to: source.length },
			}))] : [],
		);
	},
	renderMarkdown: (node, helpers) =>
		`${node.attrs?.prefix ?? ""}${helpers.renderChildren(node.content ?? [])}`,
	renderHTML: ({ node }) => [
		"div",
		{ "data-link-definition": "" },
		["span", { contenteditable: "false" }, node.attrs.prefix],
		["span", 0],
	],
	addNodeView: () => referenceDefinitionView,
	addInputRules() {
		return [
			new InputRule({
				find: /^ {0,3}\[(?!\^)[^\]\r\n]+\]:[ \t]$/,
				handler: ({ state, range, match }) => {
					if (state.selection.$from.parent.type.name !== "paragraph")
						return null;
					state.tr
						.delete(range.from, range.to)
						.setBlockType(range.from, range.from, this.type, {
							prefix: match[0],
						});
					return undefined;
				},
			}),
		];
	},
	addKeyboardShortcuts() {
		return {
			Enter: () =>
				this.editor.isActive(this.name) && this.editor.commands.exitCode(),
			Backspace: () => {
				const { $from, empty } = this.editor.state.selection;
				if (
					!empty ||
					$from.parent.type.name !== this.name ||
					$from.parentOffset
				)
					return false;
				const prefix = String($from.parent.attrs.prefix);
				return this.editor
					.chain()
					.setNode("paragraph")
					.insertContent({ type: "text", text: prefix })
					.run();
			},
		};
	},
	addProseMirrorPlugins() {
		return [referenceResolution(this.editor)];
	},
});
