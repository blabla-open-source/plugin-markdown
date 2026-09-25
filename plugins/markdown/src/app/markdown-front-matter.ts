import { InputRule, Node, textblockTypeInputRule } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { HorizontalRule } from "@tiptap/extension-horizontal-rule";
import { closeHistory } from "@tiptap/pm/history";
import {
	AllSelection,
	type EditorState,
	Plugin,
	TextSelection,
} from "@tiptap/pm/state";
import {
	decodeFrontMatterText,
	encodeFrontMatterText,
	readMarkdownFrontMatter,
} from "./markdown-front-matter-source";

// Keep paragraph as the default block. Metadata cannot be moved into a list,
// quote, or the middle of the document through a generic block command.
export const MarkdownDocument = Document.extend({
	content: "block+ | frontMatter block*",
	addProseMirrorPlugins() {
		return [
			...(this.parent?.() ?? []),
			new Plugin({
				appendTransaction(_transactions, before, after) {
					if (
						before.selection instanceof AllSelection ||
						!(after.selection instanceof AllSelection)
					)
						return null;
					// Whole-document replacement is a new edit, not an extension of the
					// preceding insertion even when it happens within the history delay.
					return closeHistory(after.tr);
				},
				props: {
					handleDOMEvents: {
						beforeinput(view, event) {
							const { selection } = view.state;
							if (
								!(selection instanceof AllSelection) ||
								event.inputType !== "insertText" ||
								event.isComposing ||
								view.composing ||
								!event.cancelable ||
								event.data === null
							)
								return false;
							// Like ProseMirror's keypress path, replace the model selection before
							// Chromium can insert into non-contentDOM controls at the document edge.
							const text = event.data;
							const deflt = () =>
								view.state.tr.insertText(text).scrollIntoView();
							if (
								!view.someProp("handleTextInput", (handle) =>
									handle(view, selection.from, selection.to, text, deflt),
								)
							)
								view.dispatch(deflt());
							event.preventDefault();
							return true;
						},
					},
				},
			}),
		];
	},
});

export const MarkdownFrontMatter = Node.create({
	name: "frontMatter",
	priority: 1000,
	content: "text*",
	marks: "",
	code: true,
	defining: true,
	isolating: true,

	addAttributes() {
		return {
			bom: { default: "", rendered: false },
			closing: { default: "---", rendered: false },
		};
	},
	parseHTML() {
		return [{ tag: "pre[data-front-matter]", preserveWhitespace: "full" }];
	},
	renderHTML() {
		return [
			"pre",
			{ "data-front-matter": "", "aria-label": "YAML Front Matter" },
			0,
		];
	},
	markdownTokenizer: {
		name: "frontMatter",
		level: "block",
		start: () => -1,
		tokenize(source, tokens) {
			// Marked's root TokensList owns `links`; nested block token arrays do not.
			// Empty tokens alone also match the beginning of quotes and list items.
			if (tokens.length !== 0 || !Object.hasOwn(tokens, "links"))
				return undefined;
			const block = readMarkdownFrontMatter(source);
			return block ? { ...block, type: "frontMatter" } : undefined;
		},
	},
	parseMarkdown(token, helpers) {
		return helpers.createNode(
			"frontMatter",
			{
				bom: token.bom,
				closing: token.closing,
			},
			token.text
				? [helpers.createTextNode(decodeFrontMatterText(token.text))]
				: [],
		);
	},
	renderMarkdown(node) {
		const text = node.content?.map((child) => child.text ?? "").join("") ?? "";
		// An empty YAML body still needs a line between the delimiters. Desktop
		// editors read two adjacent `---` lines as two horizontal rules, not metadata.
		return `${node.attrs?.bom ?? ""}---\n${encodeFrontMatterText(text)}\n${node.attrs?.closing ?? "---"}`;
	},
	addInputRules() {
		// The document schema rejects this rule outside the first top-level block.
		return [textblockTypeInputRule({ find: /^---\n$/, type: this.type })];
	},
	addKeyboardShortcuts() {
		return {
			Enter: () =>
				this.editor.isActive(this.name) && this.editor.commands.newlineInCode(),
			"Mod-Enter": () =>
				this.editor.isActive(this.name) && this.editor.commands.exitCode(),
			ArrowDown: () => {
				const { $from, empty } = this.editor.state.selection;
				if (
					!empty ||
					$from.parent.type !== this.type ||
					$from.parentOffset !== $from.parent.content.size
				)
					return false;
				if (this.editor.state.doc.nodeAt($from.after())) {
					return this.editor.commands.command(({ tr }) => {
						tr.setSelection(TextSelection.near(tr.doc.resolve($from.after())));
						return true;
					});
				}
				return this.editor.commands.exitCode();
			},
			Tab: () =>
				this.editor.isActive(this.name) &&
				this.editor.commands.insertContent("  "),
			Backspace: () => {
				const { $from, empty } = this.editor.state.selection;
				if (
					!empty ||
					$from.parent.type !== this.type ||
					$from.parentOffset !== 0
				)
					return false;
				if ($from.parent.content.size === 0)
					return this.editor
						.chain()
						.command(({ tr }) => {
							closeHistory(tr);
							return true;
						})
						.deleteNode(this.name)
						.run();
				return true;
			},
		};
	},
	addProseMirrorPlugins() {
		return [
			new Plugin({
				props: {
					handlePaste: (_view, event) => {
						const text = event.clipboardData?.getData("text/plain");
						const replaceTo = frontMatterPasteEnd(this.editor.state);
						if (!text || replaceTo === null || !readMarkdownFrontMatter(text))
							return false;
						const parsed = this.editor.markdown?.parse(text);
						if (!parsed) return false;
						return this.editor.commands.command(({ tr, state }) => {
							const content = state.schema.nodeFromJSON(parsed).content;
							tr.replaceWith(0, replaceTo, content);
							tr.setSelection(TextSelection.near(tr.doc.resolve(content.size)));
							tr.setMeta("paste", true);
							return true;
						});
					},
				},
			}),
		];
	},
});

function frontMatterPasteEnd({ selection, doc }: EditorState): number | null {
	if (selection.from === 0 && selection.to === doc.content.size)
		return selection.to;
	const first = doc.firstChild;
	if (
		selection.empty &&
		selection.from === 1 &&
		first?.isTextblock &&
		!first.type.spec.code &&
		first.content.size === 0
	)
		return first.nodeSize;
	return null;
}

export const MarkdownHorizontalRule = HorizontalRule.extend({
	addInputRules() {
		return (this.parent?.() ?? []).map(
			(rule) =>
				new InputRule({
					find: rule.find,
					undoable: rule.undoable,
					handler: (props) => {
						if (props.match[0] === "---" && props.range.from === 1) return null;
						return rule.handler(props);
					},
				}),
		);
	},
});
