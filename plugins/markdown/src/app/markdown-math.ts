import { defaultCodeEditorConfiguration, type CodeEditorConfiguration } from "./markdown-code-editing";
import { InputRule } from "@tiptap/core";
import { BlockMath, InlineMath, type BlockMathOptions } from "@tiptap/extension-mathematics";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection } from "@tiptap/pm/state";
import {
	mathBlockOpening,
	mathBlockStart,
	readInlineMath,
	readMathBlock,
	renderBlockMath,
	renderInlineMath,
} from "./markdown-math-source";
import { mathNodeView } from "./markdown-math-view";

const delimiterAttribute = (name: string, fallback: string) => ({
	default: fallback,
	parseHTML: (element: HTMLElement) =>
		element.getAttribute(`data-math-${name}`) ?? fallback,
	renderHTML: (attributes: Record<string, unknown>) => ({
		[`data-math-${name}`]: attributes[name],
	}),
});

export function createMarkdownInlineMath(enableDollarMath = true) {
	return InlineMath.extend({
		addOptions() {
			return { ...this.parent?.(), enableDollarMath };
		},
		addAttributes() {
			return {
				...this.parent?.(),
				opening: delimiterAttribute("opening", "$"),
				closing: delimiterAttribute("closing", "$"),
			};
		},
		markdownTokenizer: {
			name: "inlineMath",
			level: "inline",
			start: (source) => source.search(/\$|\\[([]/),
			tokenize(source) {
				const math = readInlineMath(source, enableDollarMath);
				return math ? { type: "inlineMath", ...math } : undefined;
			},
		},
		parseMarkdown: (token, helpers) =>
			helpers.createNode(
				"inlineMath",
				{ latex: token.latex, opening: token.opening, closing: token.closing },
				[helpers.createTextNode(token.raw ?? "")],
			),
		renderMarkdown: (node) => renderInlineMath(node, enableDollarMath),
		addNodeView: () => mathNodeView,
		addInputRules() {
			return [
				new InputRule({
					find: /(?:\$(?!\$)(?:\\[^\n]|[^$\n])+\$|\\\([^\n]*?\\\)|\\\[[^\n]*?\\\])$/,
					handler: ({ state, range, match }) => {
						const before = state.doc.textBetween(
							state.selection.$from.start(),
							range.from,
						);
						if (
							(before.match(/\\+$/)?.[0].length ?? 0) % 2 ||
							before.endsWith("$")
						)
							return null;
						const math = readInlineMath(match[0], enableDollarMath);
						if (!math) return null;
						const marks = state.storedMarks ?? state.selection.$from.marks();
						state.tr
							.replaceWith(
								range.from,
								range.to,
								this.type.create(math, null, marks),
							)
							.setStoredMarks(marks);
						return undefined;
					},
				}),
				...(enableDollarMath ? (this.parent?.() ?? []) : []),
			];
		},
	});
}
export const MarkdownInlineMath = createMarkdownInlineMath();

export const MarkdownBlockMath = BlockMath.extend<BlockMathOptions & { getCodeEditorConfiguration: () => CodeEditorConfiguration }>({
	addOptions() { return { ...this.parent?.(), getCodeEditorConfiguration: () => defaultCodeEditorConfiguration }; },
	addAttributes() {
		return {
			...this.parent?.(),
			opening: delimiterAttribute("opening", "$$"),
			closing: delimiterAttribute("closing", "$$"),
			compact: {
				default: false,
				parseHTML: (element) =>
					element.getAttribute("data-math-compact") === "true",
				renderHTML: (attrs) => ({ "data-math-compact": String(attrs.compact) }),
			},
		};
	},
	markdownTokenizer: {
		name: "blockMath",
		level: "block",
		start: mathBlockStart,
		tokenize(source) {
			const math = readMathBlock(source);
			return math ? { type: "blockMath", ...math } : undefined;
		},
	},
	parseMarkdown: (token, helpers) =>
		helpers.createNode("blockMath", {
			latex: token.latex,
			opening: token.opening,
			closing: token.closing,
			compact: token.compact,
		}),
	renderMarkdown: renderBlockMath,
	addNodeView: () => mathNodeView,
	addKeyboardShortcuts() {
		return {
			Enter: () => {
				const { $from, empty } = this.editor.state.selection;
				if (
					!empty ||
					$from.parent.type.name !== "paragraph" ||
					$from.parentOffset !== $from.parent.content.size ||
					$from.parent.children.some((child) => child.marks.length)
				)
					return false;
				const opening = $from.parent.textContent;
				const delimiter = mathBlockOpening(opening);
				if (!delimiter) return false;
				return this.editor.commands.command(({ tr }) => {
					const position = $from.before();
					closeHistory(tr).replaceWith(
						position,
						$from.after(),
						this.type.create({ opening, closing: delimiter.closing }),
					);
					tr.setSelection(NodeSelection.create(tr.doc, position));
					return true;
				});
			},
		};
	},
});
