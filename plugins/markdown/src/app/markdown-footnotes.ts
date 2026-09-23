import { markdownBlockStart } from "./markdown-grammar";
import { InputRule, Node } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { backspaceFootnoteLabel } from "./markdown-footnote-label";
import { footnoteLabelSelectionPlugin } from "./markdown-footnote-selection";
import {
	footnoteNavigationPlugin,
	focusFootnote,
} from "./markdown-footnote-navigation";
import {
	FOOTNOTE_DEFINITION,
	FOOTNOTE_DEFINITION_START,
	FOOTNOTE_REFERENCE,
	isFootnoteLabel,
} from "./markdown-footnote-source";
import { footnoteNodeView } from "./markdown-footnote-view";
import { normalizeFootnoteClipboard } from "./markdown-footnote-clipboard";

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		markdownFootnotes: {
			insertFootnote: () => ReturnType;
		};
	}
}

const labelAttribute = {
	isRequired: true,
	parseHTML: (element: HTMLElement) =>
		element.getAttribute("data-footnote-label"),
	renderHTML: (attributes: Record<string, unknown>) => ({
		"data-footnote-label": attributes.label,
	}),
};

export const MarkdownFootnoteReference = Node.create({
	name: "footnoteReference",
	inline: true,
	group: "inline",
	atom: true,
	marks: "",
	priority: 1100,
	transformPastedHTML: normalizeFootnoteClipboard,
	addAttributes: () => ({ label: labelAttribute }),
	parseHTML: () => [{ tag: "sup[data-footnote-label]", priority: 1100 }],
	renderHTML: ({ node, HTMLAttributes }) => [
		"sup",
		HTMLAttributes,
		node.attrs.label,
	],
	renderText: ({ node }) => `[^${node.attrs.label}]`,
	markdownTokenizer: {
		name: "footnoteReference",
		level: "inline",
		start: (source) => source.indexOf("[^"),
		tokenize(source) {
			const match = FOOTNOTE_REFERENCE.exec(source);
			return match && isFootnoteLabel(match[1])
				? { type: "footnoteReference", raw: match[0], label: match[1] }
				: undefined;
		},
	},
	parseMarkdown: (token, helpers) =>
		helpers.createNode("footnoteReference", { label: token.label }),
	renderMarkdown: (node) => `[^${node.attrs?.label}]`,
	addNodeView: () => footnoteNodeView,
	addInputRules() {
		return [
			new InputRule({
				find: /\[\^([^\]\r\n]+)\]( ?)$/,
				handler: ({ state, range, match }) => {
					if (!isFootnoteLabel(match[1])) return null;
					const before = state.doc.textBetween(
						state.selection.$from.start(),
						range.from,
					);
					if ((before.match(/\\+$/)?.[0].length ?? 0) % 2) return null;
					// Leave a line-start label available for the definition's `: ` rule.
					if (range.from === state.selection.$from.start() && !match[2])
						return null;
					state.tr.replaceWith(
						range.from,
						range.to,
						this.type.create({ label: match[1] }),
					);
					if (match[2]) state.tr.insertText(" ", range.from + 1);
					return undefined;
				},
			}),
		];
	},
	addCommands() {
		return {
			insertFootnote:
				() =>
				({ tr, state, dispatch }) => {
					const definitionType = state.schema.nodes.footnoteDefinition;
					if (!definitionType) return false;
					const at = tr.selection.to;
					const $at = tr.doc.resolve(at);
					if (!$at.parent.canReplaceWith($at.index(), $at.index(), this.type))
						return false;
					const labels = new Set<string>();
					tr.doc.descendants((node) => {
						if (node.type.name.startsWith("footnote"))
							labels.add(node.attrs.label);
					});
					let number = 1;
					while (labels.has(String(number))) number += 1;
					if (dispatch) {
						const label = String(number);
						tr.insert(at, this.type.create({ label }));
						const end = tr.doc.content.size;
						tr.insert(end, definitionType.create({ label }));
						tr.setSelection(
							TextSelection.create(tr.doc, end + 1),
						).scrollIntoView();
					}
					return true;
				},
		};
	},
	addKeyboardShortcuts() {
		return {
			"Mod-Alt-f": () => this.editor.commands.insertFootnote(),
			"Mod-Enter": () => focusFootnote(this.editor.view),
		};
	},
	addProseMirrorPlugins() {
		return [footnoteNavigationPlugin()];
	},
});

export const MarkdownFootnoteDefinition = Node.create({
	name: "footnoteDefinition",
	group: "block",
	content: "inline*",
	defining: true,
	isolating: true,
	priority: 1100,
	addAttributes: () => ({ label: labelAttribute }),
	parseHTML: () => [
		{
			tag: "div[data-footnote-definition]",
			contentElement: ".footnote-content",
		},
	],
	renderHTML: ({ node, HTMLAttributes }) => [
		"div",
		{ ...HTMLAttributes, "data-footnote-definition": "" },
		["span", { contenteditable: "false" }, `[^${node.attrs.label}]: `],
		["span", { class: "footnote-content" }, 0],
	],
	addNodeView: () => footnoteNodeView,
	renderText: ({ node }) => `[^${node.attrs.label}]: ${node.textContent}`,
	addProseMirrorPlugins: () => [footnoteLabelSelectionPlugin()],
	markdownTokenizer: {
		name: "footnoteDefinition",
		level: "block",
		start: (source) => markdownBlockStart(source, FOOTNOTE_DEFINITION_START),
		tokenize(source, _tokens, helpers) {
			const match = FOOTNOTE_DEFINITION.exec(source);
			return match && isFootnoteLabel(match[1])
				? {
						type: "footnoteDefinition",
						raw: match[0],
						label: match[1],
						tokens: helpers.inlineTokens(match[2] ?? "", {
							from: match.indices![2]![0],
							to: match.indices![2]![1],
						}),
					}
				: undefined;
		},
	},
	parseMarkdown: (token, helpers) =>
		helpers.createNode(
			"footnoteDefinition",
			{ label: token.label },
			helpers.parseInline(token.tokens ?? []),
		),
	renderMarkdown: (node, helpers) =>
		`[^${node.attrs?.label}]: ${helpers.renderChildren(node.content ?? []).replace(/ {2}\n|\\\n|\n/g, "<br>")}`,
	addInputRules() {
		return [
			new InputRule({
				find: /^\[\^([^\]\r\n]+)\]: $/,
				handler: ({ state, range, match }) => {
					if (!isFootnoteLabel(match[1])) return null;
					state.tr
						.delete(range.from, range.to)
						.setBlockType(range.from, range.from, this.type, {
							label: match[1],
						});
					return undefined;
				},
			}),
		];
	},
	addKeyboardShortcuts() {
		const exit = () => {
			return this.editor.commands.command(({ tr, state }) => {
				const { $from, $to } = tr.selection;
				const paragraph = state.schema.nodes.paragraph;
				if (
					$from.parent.type !== this.type ||
					!$from.sameParent($to) ||
					!paragraph
				)
					return false;
				// Explicit Enter may leave the isolated definition; implicit joins
				// must still not consume its label from an adjacent paragraph.
				tr.deleteSelection();
				tr.split(tr.selection.from, 1, [{ type: paragraph }]).scrollIntoView();
				return true;
			});
		};
		return {
			Enter: exit,
			"Mod-Enter": exit,
			Backspace: () => backspaceFootnoteLabel(this.editor.view),
		};
	},
});
