import type { ViewUpdate } from "@codemirror/view";
import type { Node } from "@tiptap/pm/model";
import {
	type EditorState,
	NodeSelection,
	TextSelection,
	type Transaction,
} from "@tiptap/pm/state";

/** The schema remains the source authority: textblocks and math atoms differ only here. */
export interface SourceCodeBinding {
	read(node: Node): string;
	write(
		tr: Transaction,
		update: ViewUpdate,
		position: number,
		node: Node,
	): void;
	select(tr: Transaction, position: number, anchor: number, head: number): void;
	selection(
		state: EditorState,
		position: number,
		node: Node,
	): { anchor: number; head: number } | true | null;
}
export const textCodeBinding: SourceCodeBinding = {
	read: (node) => node.textContent,
	write(tr, update, position) {
		let offset = position + 1;
		update.changes.iterChanges((from, to, fromB, toB, text) => {
			tr.insertText(text.toString(), offset + from, offset + to);
			offset += toB - fromB - (to - from);
		});
	},
	select(tr, position, anchor, head) {
		tr.setSelection(
			TextSelection.create(tr.doc, position + 1 + anchor, position + 1 + head),
		);
	},
	selection(state, position, node) {
		const { from, to, anchor, head } = state.selection;
		return from > position && to < position + node.nodeSize
			? { anchor: anchor - position - 1, head: head - position - 1 }
			: null;
	},
};
export const mathCodeBinding: SourceCodeBinding = {
	read: (node) => String(node.attrs.latex ?? ""),
	write(tr, update, position, node) {
		const latex = update.state.doc.toString();
		tr.setNodeMarkup(position, undefined, {
			...node.attrs,
			latex,
			...(latex.includes("\n") ? { compact: false } : {}),
		});
	},
	select(tr, position) {
		tr.setSelection(NodeSelection.create(tr.doc, position));
	},
	selection(state, position) {
		return state.selection instanceof NodeSelection &&
			state.selection.from === position
			? true
			: null;
	},
};
