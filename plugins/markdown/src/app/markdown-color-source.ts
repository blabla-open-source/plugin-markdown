import { type Editor, Node } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import { colorSourceCaret } from "./markdown-color-caret";
import {
	type ColorSource,
	colorSourceKey as key,
} from "./markdown-color-history";
import {
	colorSourceKeyDown,
	colorSourceKeyUp,
} from "./markdown-color-keyboard";
import { readOriginalColorSource, serializeColorSource } from "./markdown-color-original";
import { colorSourceDecorations } from "./markdown-color-preview";
import { colorRange } from "./markdown-color-range";
import {
	ColorSourceStep,
	foldColorSource,
	replaceColorSource,
} from "./markdown-color-transactions";
import type { MarkdownSourceBlockReader } from "./markdown-source-patch";
import {
	closeOtherSourceEditors,
	registerSourceCloser,
} from "./markdown-source-focus";

const sourceSchema = new Schema({
	nodes: { doc: { content: "text*", whitespace: "pre" }, text: {} },
});

// Present only while editing. The source is document data, including unfinished
// tags and whitespace-only edits; it is never a second unsaved UI draft.
export const MarkdownColorSource = Node.create({
	name: "colorSource",
	inline: true,
	group: "inline",
	atom: true,
	code: true,
	addAttributes: () => ({ source: { default: "", rendered: false } }),
	renderHTML: ({ node }) => [
		"span",
		{ "data-color-source": "" },
		node.attrs.source,
	],
	renderMarkdown: (node) => String(node.attrs?.source ?? ""),
});

/** An editing view only: every source input becomes a normal document transaction. */
export function colorSourcePlugin(
	editor: Editor,
	readBlock?: MarkdownSourceBlockReader,
) {
	let sourceView: EditorView | null = null;
	const leave = (position?: number, bias = 1, sourceOffset?: number) => {
		const active = key.getState(editor.state);
		if (!active) return;
		const selection = sourceView?.state.selection;
		const offset = sourceOffset ?? (position === undefined ? selection?.head : undefined);
		const tr = foldColorSource(
			editor,
			editor.state,
			active.from,
			offset,
			active,
			readBlock,
		).setMeta(key, null);
		if (position === undefined && sourceOffset === undefined && selection && !selection.empty) {
			const anchor = foldColorSource(editor, editor.state, active.from, selection.anchor, active, readBlock).selection.head;
			tr.setSelection(TextSelection.create(tr.doc, anchor, tr.selection.head));
		}
		if (position !== undefined)
			tr.setSelection(
				TextSelection.near(
					tr.doc.resolve(tr.mapping.map(position, bias)),
					bias,
				),
			);
		editor.view.dispatch(tr);
		editor.view.dispatch(closeHistory(editor.state.tr));
		editor.view.focus();
		return tr.selection.from;
	};
	const enter = (position: number, automatic = false): boolean => {
		const range = colorRange(editor.state, position);
		if (!range || !editor.isEditable || key.getState(editor.state))
			return false;
		const input = readOriginalColorSource(editor.state, range.from, range.to, readBlock);
		const source = input?.source ?? serializeColorSource(
			editor,
			editor.state,
			range.from,
			range.to,
			readBlock,
		);
		const caret = colorSourceCaret(
			editor,
			range.from,
			range.to,
			position,
			input,
		);
		if (automatic && caret === null) return false;
		const state = editor.state;
		const target = closeOtherSourceEditors(editor, leave, position);
		if (state !== editor.state) return enter(target, automatic);
		editor.view.dispatch(
			closeHistory(editor.state.tr).setMeta(key, { ...range, source }),
		);
		if (sourceView && caret !== null)
			sourceView.updateState(
				sourceView.state.apply(
					sourceView.state.tr.setSelection(
						TextSelection.create(sourceView.state.doc, caret),
					),
				),
			);
		sourceView?.focus();
		return true;
	};
	const mountSource = () => {
		const widget = document.createElement("span");
		const dom = document.createElement("span");
		widget.append(dom);
		dom.className = "markdown-color-source";
		const active = key.getState(editor.state);
		const source = active?.source ?? "";
		sourceView = new EditorView(
			{ mount: dom },
			{
				state: EditorState.create({
					schema: sourceSchema,
					doc: sourceSchema.node(
						"doc",
						null,
						source ? sourceSchema.text(source) : undefined,
					),
				}),
				attributes: (state) => ({
					role: "textbox",
					"aria-label": "Color source",
					spellcheck: "false",
					"data-empty": String(state.doc.content.size === 0),
				}),
				handlePaste: (view, event) => {
					if (!event.clipboardData?.types.includes("text/plain")) return false;
					view.dispatch(
						view.state.tr.insertText(event.clipboardData.getData("text/plain")),
					);
					return true;
				},
				decorations: (state) =>
					DecorationSet.create(
						state.doc,
						colorSourceDecorations(state.doc.textContent, 0),
					),
				handleKeyDown: (view, event) =>
					colorSourceKeyDown(
						editor,
						view,
						event,
						key.getState(editor.state),
						leave,
					),
				dispatchTransaction: (tr) => {
					if (!sourceView) return;
					sourceView.updateState(sourceView.state.apply(tr));
					const current = key.getState(editor.state);
					if (!tr.docChanged || !current) return;
					const value = sourceView.state.doc.textContent;
					const update = replaceColorSource(
						editor.state,
						current.from,
						current.to,
						value,
						tr.getMeta("colorSourceSplit"),
					);
					update.setMeta(key, {
						from: current.from,
						to: current.from + 1,
						source: value,
					});
					editor.view.dispatch(update);
				},
			},
		);
		return widget;
	};
	return new Plugin<ColorSource | null>({
		key,
		state: {
			init: () => null,
			apply(tr, active, oldState, state) {
				const next = tr.getMeta(key) as ColorSource | null | undefined;
				if (next !== undefined) return next;
				if (!active) return null;
				const previous = oldState.doc.resolve(active.from);
				// Source history restores whole blocks. Recover the editing span from
				// its unchanged prefix rather than mapping into a deleted block interior.
				const restored = tr.steps.some(
					(step) => step instanceof ColorSourceStep,
				)
					? colorRange(
							state,
							Math.min(
								state.doc.content.size,
								tr.mapping.map(previous.before(), -1) +
									1 +
									previous.parentOffset,
							),
						)
					: null;
				const from = restored?.from ?? tr.mapping.map(active.from, -1);
				const to = restored?.to ?? tr.mapping.map(active.to, 1);
				const start = state.doc.resolve(from);
				if (
					!start.parent.isTextblock ||
					!start.sameParent(state.doc.resolve(to))
				)
					return null;
				return {
					from,
					to,
					source: active.source,
				};
			},
		},
		appendTransaction(transactions, _before, state) {
			const active = key.getState(state);
			if (!active || !transactions.some(tr => tr.docChanged)) return null;
			// The source-history owner has now applied this edit/undo. State.apply
			// runs earlier and cannot read the new document's source spelling yet.
			const source = serializeColorSource(editor, state, active.from, active.to, readBlock);
			return source === active.source ? null : state.tr.setMeta(key, { ...active, source });
		},
		props: {
			handleClick(view, position, event) {
				if (
					event.button !== 0 ||
					event.shiftKey ||
					event.metaKey ||
					event.ctrlKey ||
					event.altKey
				)
					return false;
				if (!key.getState(view.state)) return enter(position, true);
				leave(position);
				enter(view.state.selection.from, true);
				return true;
			},
			handleDOMEvents: {
				keyup(view, event) {
					if (sourceView && colorSourceKeyUp(editor, sourceView, event, leave))
						return false;
					const selection = view.dom.ownerDocument.getSelection();
					if (
						!event.isComposing &&
						!event.shiftKey &&
						!view.composing &&
						selection?.isCollapsed &&
						selection.anchorNode &&
						view.dom.contains(selection.anchorNode) &&
						view.hasFocus() &&
						[
							"ArrowLeft",
							"ArrowRight",
							"ArrowUp",
							"ArrowDown",
							"Home",
							"End",
						].includes(event.key)
					) {
						const position = view.posAtDOM(
							selection.anchorNode,
							selection.anchorOffset,
						);
						const range = colorRange(view.state, position);
						// Boundary affinity follows movement: Right leaves the end,
						// Left leaves the start. Neither should reopen the source.
						if (
							(event.key === "ArrowRight" && range?.to === position) ||
							(event.key === "ArrowLeft" && range?.from === position)
						)
							return false;
						enter(position, true);
					}
					return false;
				},
				dblclick(view, event) {
					const position = view.posAtCoords({
						left: event.clientX,
						top: event.clientY,
					});
					if (!position || !enter(position.pos)) return false;
					event.preventDefault();
					return true;
				},
			},
			handleKeyDown: (view, event) =>
				event.altKey &&
				event.key === "Enter" &&
				enter(view.state.selection.from),
			decorations(state) {
				const active = key.getState(state);
				if (!active) return null;
				return DecorationSet.create(state.doc, [
					...(active.from < active.to
						? [
								Decoration.inline(active.from, active.to, {
									class: "markdown-color-source-hidden",
								}),
							]
						: []),
					Decoration.widget(active.from, mountSource, {
						key: "color-source",
						side: -1,
						marks: [],
						stopEvent: () => true,
						ignoreSelection: true,
						destroy: () => {
							sourceView?.destroy();
							sourceView = null;
						},
					}),
				]);
			},
		},
		view: () => {
      const unregister = registerSourceCloser(editor, leave);
      return {
			destroy: unregister,
			update(view, previous) {
				const active = key.getState(view.state);
				if (!sourceView || !active) return;
				const tr = sourceView.state.tr;
				if (sourceView.state.doc.textContent !== active.source)
					tr.insertText(active.source, 0, tr.doc.content.size);
				const selection = active.selection;
				const restore =
					selection && selection !== key.getState(previous)?.selection;
				if (!tr.docChanged && !restore) return;
				if (restore)
					tr.setSelection(
						TextSelection.create(
							tr.doc,
							Math.min(selection.anchor, tr.doc.content.size),
							Math.min(selection.head, tr.doc.content.size),
						),
					);
				sourceView.updateState(sourceView.state.apply(tr));
				if (restore) sourceView.focus();
			},
		};
    },
	});
}
