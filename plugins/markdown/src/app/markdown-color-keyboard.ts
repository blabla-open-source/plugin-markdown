import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Selection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/** Keep native Command-arrow movement; fold only after it leaves this source. */
export function colorSourceKeyUp(
	editor: Editor,
	view: EditorView,
	event: KeyboardEvent,
	leave: (position?: number, bias?: number) => void,
): boolean {
	if (
		!event.metaKey ||
		event.ctrlKey ||
		event.altKey ||
		event.shiftKey ||
		event.isComposing ||
		view.composing ||
		!(event.key === "ArrowLeft" || event.key === "ArrowRight")
	)
		return false;
	const selection = view.dom.ownerDocument.getSelection();
	const node = selection?.anchorNode;
	if (
		!selection?.isCollapsed ||
		!node ||
		view.dom.contains(node) ||
		!editor.view.dom.contains(node)
	)
		return false;
	leave(
		editor.view.posAtDOM(node, selection.anchorOffset),
		event.key === "ArrowLeft" ? -1 : 1,
	);
	return true;
}

/** The inner view owns source keystrokes; history and leaving use the outer view. */
export function colorSourceKeyDown(
	editor: Editor,
	view: EditorView,
	event: KeyboardEvent,
	range: { from: number; to: number } | null | undefined,
	leave: (position?: number, bias?: number, sourceOffset?: number) => void,
): boolean {
	if (event.isComposing || view.composing) return false;
	// Native selection can arrive before selectionchange reaches the inner view.
	// Synchronize before its key handling, including ProseMirror's delete guard.
	const nativeSelection = view.dom.ownerDocument.getSelection();
	if (
		nativeSelection?.anchorNode &&
		nativeSelection.focusNode &&
		view.dom.contains(nativeSelection.anchorNode) &&
		view.dom.contains(nativeSelection.focusNode)
	) {
		const next = TextSelection.create(
			view.state.doc,
			view.posAtDOM(nativeSelection.anchorNode, nativeSelection.anchorOffset),
			view.posAtDOM(nativeSelection.focusNode, nativeSelection.focusOffset),
		);
		if (!next.eq(view.state.selection))
			view.dispatch(view.state.tr.setSelection(next));
	}
	if (event.key === "Enter") {
		const sourceKey = !(event.metaKey || event.ctrlKey || event.altKey);
		const split = sourceKey && !event.shiftKey;
		const tr = view.state.tr;
		const { anchor, head } = tr.selection;
		if (sourceKey) editor.view.dispatch(closeHistory(editor.state.tr));
		tr.insertText(split ? "\n\n" : "\n");
		if (sourceKey)
			tr.setMeta("colorSourceSplit", {
				paragraph: split,
				source: view.state.doc.textContent,
				anchor,
				head,
				after: tr.selection.from,
			});
		view.dispatch(tr);
		if (split) leave(undefined, 1, view.state.selection.from);
		else if (sourceKey) editor.view.dispatch(closeHistory(editor.state.tr));
		return true;
	}
	if (event.key === "Escape") {
		leave();
		return true;
	}
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
		if (event.shiftKey) editor.commands.redo();
		else editor.commands.undo();
		return true;
	}
	// Native movement can precede ProseMirror's selectionchange notification.
	const innerSelection = view.dom.ownerDocument.getSelection();
	if (
		!range ||
		!innerSelection?.isCollapsed ||
		!innerSelection.anchorNode ||
		!view.dom.contains(innerSelection.anchorNode) ||
		event.shiftKey ||
		event.metaKey ||
		event.ctrlKey ||
		event.altKey
	)
		return false;
	if (event.key === "ArrowUp" || event.key === "ArrowDown")
		return moveVertically(
			view,
			editor.view,
			range,
			event.key === "ArrowUp" ? -1 : 1,
			leave,
		);
	const direction =
		event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
	if (
		!direction ||
		view.posAtDOM(innerSelection.anchorNode, innerSelection.anchorOffset) !==
			(direction < 0 ? 0 : view.state.doc.content.size)
	)
		return false;
	const outer = editor.view;
	const edge = outer.state.doc.resolve(direction < 0 ? range.from : range.to);
	// near() can fall back inward; leaving requires an outward destination.
	if (
		edge.parentOffset === (direction < 0 ? 0 : edge.parent.content.size) &&
		!Selection.findFrom(
			outer.state.doc.resolve(direction < 0 ? edge.before() : edge.after()),
			direction,
		)
	)
		return true;
	leave(edge.pos, direction);
	const selection = outer.dom.ownerDocument.getSelection();
	// Let the browser move a character, including multi-code-unit graphemes.
	// Adding one to a ProseMirror position would split them and mishandle blocks.
	selection?.modify("move", direction < 0 ? "left" : "right", "character");
	if (selection?.anchorNode && outer.dom.contains(selection.anchorNode)) {
		const position = outer.posAtDOM(
			selection.anchorNode,
			selection.anchorOffset,
		);
		outer.dispatch(
			outer.state.tr
				.setSelection(
					TextSelection.near(outer.state.doc.resolve(position), direction),
				)
				.scrollIntoView(),
		);
	}
	return true;
}

function moveVertically(
	view: EditorView,
	outer: EditorView,
	range: { from: number; to: number },
	direction: number,
	leave: (position?: number, bias?: number) => void,
): boolean {
	const selection = view.dom.ownerDocument.getSelection();
	const widget = view.dom.parentElement;
	if (!selection?.anchorNode || !selection.rangeCount || !widget) return false;
	const position = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
	view.dispatch(
		view.state.tr.setSelection(TextSelection.create(view.state.doc, position)),
	);
	if (!view.endOfTextblock(direction < 0 ? "up" : "down")) return false;
	const original = selection.getRangeAt(0).cloneRange();
	const caret = view.coordsAtPos(position);
	const boundary = view.dom.ownerDocument.createRange();
	boundary.selectNode(widget);
	boundary.collapse(direction < 0);
	// Probe the destination row in the outer editing host, without changing its
	// document. The inner editing host cannot move its native caret outside.
	selection.removeAllRanges();
	selection.addRange(boundary);
	selection.modify("move", direction < 0 ? "backward" : "forward", "line");
	let target =
		selection.anchorNode && outer.dom.contains(selection.anchorNode)
			? outer.posAtDOM(selection.anchorNode, selection.anchorOffset)
			: null;
	const line = selection.rangeCount
		? selection.getRangeAt(0).getBoundingClientRect()
		: null;
	const outside = (value: number) =>
		direction < 0 ? value < range.from : value > range.to;
	if (
		target !== null &&
		outside(target) &&
		line &&
		(direction < 0 ? line.bottom <= caret.top : line.top >= caret.bottom)
	) {
		// Preserve the source caret's visual column, snapping to a text position.
		const projected = outer.posAtCoords({
			left: caret.left,
			top: (line.top + line.bottom) / 2,
		});
		if (projected && outside(projected.pos)) target = projected.pos;
	}
	selection.removeAllRanges();
	selection.addRange(original);
	if (target === null || !outside(target)) return false;
	leave(target, direction);
	return true;
}
