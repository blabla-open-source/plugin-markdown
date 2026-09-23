import { baseKeymap, toggleMark, selectTextblockStart, selectTextblockEnd } from "@tiptap/pm/commands";
import { keymap } from "@tiptap/pm/keymap";
import { closeHistory } from "@tiptap/pm/history";
import type { Node, Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { splitExpandedBlock } from "./markdown-block-expansion-source";
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";

export function blockSourceKeyDown(
	editor: Editor,
	view: EditorView,
	event: KeyboardEvent,
	active: () => { from: number; node: Node } | null | undefined,
	leave: (position?: number, bias?: number) => number | undefined,
	commit: (tr: Transaction) => void,
): boolean {
	if (event.isComposing || view.composing) return false;
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
		if (event.shiftKey) editor.commands.redo();
		else editor.commands.undo();
		return true;
	}
	if (
		event.key === "Escape" ||
		(event.key === "Enter" && (event.metaKey || event.ctrlKey))
	) {
		leave();
		editor.view.focus();
		return true;
	}
	if (event.key === "Enter") {
		if (event.shiftKey) view.dispatch(view.state.tr.insertText("\n"));
		else {
			const current = active();
			const tr = current && splitExpandedBlock(editor, view, current);
			if (!tr) return false;
			commit(tr);
			editor.view.dispatch(closeHistory(editor.state.tr));
			editor.view.focus();
		}
		return true;
	}
	if (
		!event.shiftKey &&
		!event.metaKey &&
		!event.ctrlKey &&
		view.state.selection.empty
	) {
		const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
		const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
		if (
			(backward || forward) &&
			view.endOfTextblock(
				event.key.slice(5).toLowerCase() as "left" | "right" | "up" | "down",
			)
		) {
			const current = active();
			if (!current) return false;
			const node = editor.state.doc.nodeAt(current.from);
			if (!node) return false;
			leave(
				backward ? current.from : current.from + node.nodeSize,
				backward ? -1 : 1,
			);
			editor.view.focus();
			return true;
		}
	}
	return false;
}

export function blockSourceKeymap(schema: Schema) {
	const { bold, italic } = schema.marks;
	return keymap({
		...baseKeymap,
		"Meta-ArrowLeft": selectTextblockStart,
		"Meta-ArrowRight": selectTextblockEnd,
		...(bold ? { "Mod-b": toggleMark(bold) } : {}),
		...(italic ? { "Mod-i": toggleMark(italic) } : {}),
	});
}
