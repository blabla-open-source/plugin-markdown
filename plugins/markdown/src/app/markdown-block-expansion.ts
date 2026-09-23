import { markMarkdownPresentation } from "./markdown-source-operations";
import {
	blockSourceKeyDown,
	blockSourceKeymap,
} from "./markdown-block-source-keyboard";
import "./markdown-block-expansion.css";
import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node, Slice } from "@tiptap/pm/model";
import {
	EditorState,
	Plugin,
	PluginKey,
	TextSelection,
} from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import {
	expandMarkdownBlock,
	expandedMarkdown,
	foldExpandedBlock,
	appendFoldedBlock,
} from "./markdown-block-expansion-source";
import {
	closeOtherSourceEditors,
	registerSourceCloser,
} from "./markdown-source-focus";
import { MarkdownSourceBlockStep } from "./markdown-source-block-step";
import type { MarkdownSourceBlockReader } from "./markdown-source-patch";

const sourceOpeners = new WeakMap<Editor, (position: number) => boolean>();
export function openMarkdownBlockSource(editor: Editor, position: number) {
	return sourceOpeners.get(editor)?.(position) ?? false;
}

type Active = { from: number; node: Node; offset: number; prefix: number };
export const blockExpansionKey = new PluginKey<Active | null>(
	"markdownBlockExpansion",
);

export function MarkdownBlockExpansion(
	enabled: () => boolean,
	readBlock?: MarkdownSourceBlockReader,
) {
	return Extension.create({
		name: "markdownBlockExpansion",
		priority: 1200,
		addProseMirrorPlugins() {
			return [blockExpansionPlugin(this.editor, enabled, readBlock)];
		},
	});
}

function blockExpansionPlugin(
	editor: Editor,
	enabled: () => boolean,
	readBlock?: MarkdownSourceBlockReader,
) {
	const key = blockExpansionKey;
	const markdown = editor.markdown;
	if (!markdown)
		throw new Error("Block source editing requires Markdown support.");
	let inner: EditorView | null = null;
	let changing = false;
	const leave = (position?: number, bias = 1) => {
		const active = key.getState(editor.state);
		if (!active) return position;
		const tr = foldExpandedBlock(editor, active.from, position, bias, position === undefined ? inner?.state.selection : undefined).setMeta(
			key,
			null,
		);
		editor.view.dispatch(tr);
		editor.view.dispatch(closeHistory(editor.state.tr));
		return tr.selection.from;
	};
	const enter = (position: number): boolean => {
		if (!enabled() || !editor.isEditable || key.getState(editor.state))
			return false;
		const state = editor.state;
		const cursor = state.doc.resolve(position);
		if (cursor.depth !== 1) return false;
		const expanded = expandMarkdownBlock(
			editor,
			cursor.parent,
			cursor.index(0),
			readBlock,
		);

		if (!expanded) return false;
		const target = closeOtherSourceEditors(editor, leave, position);
		if (state !== editor.state) return enter(target);
		const offset = expanded.offset + cursor.parentOffset;
		editor.view.dispatch(
			closeHistory(state.tr).setMeta(key, {
				from: cursor.before(),
				...expanded,
				offset,
				prefix: expanded.offset,
			}),
		);
		inner?.focus();
		return true;
	};
	const mount = (active: Active) => {
		const dom = document.createElement("div");
		const makeDoc = (node: Node) =>
			editor.schema.node(
				"doc",
				null,
				editor.schema.node("paragraph", null, node.content),
			);
		inner = new EditorView(dom, {
			editable: () => editor.isEditable,
			state: EditorState.create({
				schema: editor.schema,
				doc: makeDoc(active.node),
				plugins: [blockSourceKeymap(editor.schema)],
			}),
			attributes: {
				role: "textbox",
				"aria-label": "Block source",
				class: "markdown-block-source",
				spellcheck: "false",
			},
			handleKeyDown: (view, event) =>
				blockSourceKeyDown(
					editor,
					view,
					event,
					() => key.getState(editor.state),
					leave,
					(tr) => editor.view.dispatch(tr.setMeta(key, null)),
				),
			handlePaste(view, event) {
				if (!event.clipboardData?.types.includes("text/plain")) return false;
				view.dispatch(
					view.state.tr.insertText(
						event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n"),
					),
				);
				return true;
			},
			dispatchTransaction(tr) {
				if (!inner) return;
				const previous = inner.state;
				inner.updateState(previous.apply(tr));
				const current = key.getState(editor.state);
				if (!current) return;
				if (!tr.docChanged) {
					if (!tr.selectionSet) return;
					const node = editor.state.doc.nodeAt(current.from);
					if (!node?.isTextblock) return;
					const prefix =
						node.type.name === "expandedBlock" ? 0 : current.prefix;
					const project = (position: number) =>
						current.from +
						1 +
						Math.max(0, Math.min(position - 1 - prefix, node.content.size));
					const selection = TextSelection.create(
						editor.state.doc,
						project(tr.selection.anchor),
						project(tr.selection.head),
					);
					if (!selection.eq(editor.state.selection))
						editor.view.dispatch(editor.state.tr.setSelection(selection));
					return;
				}
				const replacement = current.node.copy(inner.state.doc.child(0).content);
				const outer = editor.state;
				const previousNode = outer.doc.nodeAt(current.from);
				if (!previousNode) return;
				const update = outer.tr.step(
					new MarkdownSourceBlockStep(
						new ReplaceStep(
							current.from,
							current.from + previousNode.nodeSize,
							new Slice(Fragment.from(replacement), 0, 0),
						),
					),
				);
				if (!previous.selection.empty) closeHistory(update);
				update.setSelection(
					TextSelection.create(
						update.doc,
						current.from + inner.state.selection.anchor,
						current.from + inner.state.selection.head,
					),
				);
				update.setMeta(key, { ...current, node: replacement });
				changing = true;
				try {
					editor.view.dispatch(update);
				} finally {
					changing = false;
				}
			},
		});
		inner.updateState(
			inner.state.apply(
				inner.state.tr.setSelection(
					TextSelection.create(
						inner.state.doc,
						Math.min(active.offset + 1, inner.state.doc.content.size - 1),
					),
				),
			),
		);
		return dom;
	};
	return new Plugin<Active | null>({
		key,
		state: {
			init: () => null,
			apply(tr, active, _old, state) {
				if (tr.getMeta(key) !== undefined) return tr.getMeta(key);
				if (!active) return null;
				const from = tr.mapping.map(active.from, -1);
				const node = state.doc.nodeAt(from);
				if (!node) return null;
				const expanded = expandMarkdownBlock(
					editor,
					node,
					state.doc.resolve(from).index(0),
					readBlock,
				);
				return expanded ? { ...active, from, node: expanded.node } : null;
			},
		},
		appendTransaction(transactions, _old, state) {
			if (
				key.getState(state) ||
				!transactions.some((tr) => tr.docChanged) ||
				!editor.markdown
			)
				return null;
			const tr = markMarkdownPresentation(state.tr);
			state.doc.forEach((node, pos) => {
				if (node.type.name !== "expandedBlock") return;
				appendFoldedBlock(editor, tr, tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize), node);
			});
			return tr.docChanged ? tr : null;
		},
		props: {
			handleClick(view, pos, event) {
				if (
					event.button ||
					event.shiftKey ||
					event.metaKey ||
					event.ctrlKey ||
					event.altKey
				)
					return false;
				if (key.getState(view.state)) {
					const target = leave(pos) ?? pos;
					if (
						!enter(target) &&
						!view.someProp("handleClick", (handler) =>
							handler(view, target, event),
						)
					)
						editor.view.focus();
					return true;
				}
				return enter(pos);
			},
			handleDoubleClick(_view, pos) {
				return enter(pos);
			},
			handleDOMEvents: {
				keyup(view, event) {
					if (
						!view.composing &&
						!event.isComposing &&
						view.hasFocus() &&
						view.state.selection.empty &&
						/^Arrow|Home|End$/.test(event.key)
					)
						enter(view.state.selection.from);
					return false;
				},
			},
			decorations(state) {
				const active = key.getState(state);
				if (!active) return null;
				const node = state.doc.nodeAt(active.from);
				if (!node) return null;
				return DecorationSet.create(state.doc, [
					Decoration.node(active.from, active.from + node.nodeSize, {
						style: "display:none",
					}),
					Decoration.widget(active.from, () => mount(active), {
						key: "block-source",
						side: -1,
						stopEvent: () => true,
						ignoreSelection: true,
						destroy() {
							inner?.destroy();
							inner = null;
						},
					}),
				]);
			},
		},
		view: () => {
      const unregister = registerSourceCloser(editor, leave);
      sourceOpeners.set(editor, enter);
      return {
			destroy() {
				unregister();
				sourceOpeners.delete(editor);
			},
			update(view) {
				const active = key.getState(view.state);
				if (active && !enabled()) {
					queueMicrotask(() => {
						if (!editor.isDestroyed && !enabled()) leave();
					});
					return;
				}
				if (
					!active ||
					!inner ||
					changing ||
					inner.state.doc.child(0).content.eq(active.node.content)
				)
					return;
				inner.updateState(
					inner.state.apply(
						inner.state.tr.replaceWith(
							1,
							inner.state.doc.content.size - 1,
							active.node.content,
						),
					),
				);
			},
		};
    },
	});
}
