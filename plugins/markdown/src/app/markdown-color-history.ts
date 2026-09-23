import type { MarkdownSourceBlockReader } from "./markdown-source-patch";
import type { Editor } from "@tiptap/core";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { PluginKey, type Transaction } from "@tiptap/pm/state";
import { colorRange } from "./markdown-color-range";
import {
	ColorSourceStep,
	foldColorSource,
} from "./markdown-color-transactions";

export type ColorSource = {
	from: number;
	to: number;
	source: string;
	selection?: { anchor: number; head: number };
};
export const colorSourceKey = new PluginKey<ColorSource | null>(
	"markdownColorSource",
);

/** View folding must be a separate non-history transaction. An appended undo
 * transaction joins the redo event instead of mapping the older undo branch. */
export function restoreColorSourceHistory(
	editor: Editor,
	transaction: Transaction,
	readBlock?: MarkdownSourceBlockReader,
) {
	if (!isHistoryTransaction(transaction)) return;
	const step = transaction.steps.find(
		(value): value is ColorSourceStep =>
			value instanceof ColorSourceStep && !!value.split,
	);
	if (step?.split) {
		const { split, sourcePosition } = step;
		if (!split.undo && split.paragraph) {
			editor.view.dispatch(
				foldColorSource(
					editor,
					editor.state,
					sourcePosition,
					split.after,
					undefined,
					readBlock,
				).setMeta(colorSourceKey, null),
			);
			editor.view.focus();
			return;
		}
		const range = colorRange(editor.state, sourcePosition);
		if (!range) return;
		editor.view.dispatch(
			editor.state.tr.setMeta(colorSourceKey, {
				...range,
				// Source spelling and offsets are one history snapshot. Serializing
				// rich text here can normalize attributes and move the source caret.
				source: split.undo
					? split.source
					: String(editor.state.doc.nodeAt(sourcePosition)?.attrs.source ?? ""),
				selection: {
					anchor: split.undo ? split.anchor : split.after,
					head: split.undo ? split.head : split.after,
				},
			}),
		);
		return;
	}
	if (colorSourceKey.getState(editor.state)) return;
	let position: number | null = null;
	editor.state.doc.descendants((node, from) => {
		if (position !== null) return false;
		if (node.type.name === "colorSource") position = from;
		return true;
	});
	if (position !== null)
		editor.view.dispatch(foldColorSource(editor, editor.state, position, undefined, undefined, readBlock));
}
