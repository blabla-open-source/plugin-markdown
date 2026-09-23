import type { Editor } from "@tiptap/core";
import { createMarkdownFieldDraft } from "./markdown-field-drafts";
import { closeHistory, redo, undo } from "@tiptap/pm/history";
import { Selection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
	FootnoteLabelSelection,
	observeFootnoteSelection,
} from "./markdown-footnote-selection";
import { isFootnoteLabel } from "./markdown-footnote-source";

function changeLabel(
	view: EditorView,
	pos: number,
	value: string,
	start: number,
	end = start,
) {
	const tr = closeHistory(view.state.tr).setNodeAttribute(pos, "label", value);
	view.dispatch(
		tr.setSelection(new FootnoteLabelSelection(tr.doc, pos, start, end)),
	);
}

export function backspaceFootnoteLabel(view: EditorView) {
	const { $from, empty } = view.state.selection;
	if (
		!empty ||
		$from.parent.type.name !== "footnoteDefinition" ||
		$from.parentOffset !== 0
	)
		return false;
	const pos = $from.before();
	const value = String($from.parent.attrs.label);
	if (value) {
		const segments = Array.from(
			new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
		);
		const next = value.slice(0, segments.at(-1)?.index ?? 0);
		changeLabel(view, pos, next, next.length);
	} else {
		const paragraph = view.state.schema.nodes.paragraph;
		if (!paragraph) return false;
		const tr = closeHistory(view.state.tr).setBlockType(
			pos,
			pos + 1,
			paragraph,
		);
		view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)));
		view.focus();
	}
	return true;
}

export function definitionLabelEditor(
	editor: Editor,
	getPos: () => number | undefined,
	input: HTMLInputElement,
	label: HTMLButtonElement,
) {
	const view = editor.view;
	input.placeholder = "name";
	const valid = () => input.value === "" || isFootnoteLabel(input.value);
	const select = () => {
		const pos = getPos();
		if (typeof pos !== "number" || input.hidden || draft.composing || !valid())
			return;
		const selection = new FootnoteLabelSelection(
			view.state.doc,
			pos,
			input.selectionStart ?? 0,
			input.selectionEnd ?? 0,
		);
		if (!selection.eq(view.state.selection))
			view.dispatch(view.state.tr.setSelection(selection));
	};
	const leave = (backward = false) => {
		const pos = getPos();
		if (typeof pos !== "number") return;
		input.hidden = true;
		label.hidden = false;
		view.dispatch(
			view.state.tr.setSelection(
				backward
					? Selection.near(view.state.doc.resolve(pos), -1)
					: TextSelection.create(view.state.doc, pos + 1),
			),
		);
		view.focus();
	};
	const sync = () => {
		if (draft.pending || draft.composing) return;
		const selection = view.state.selection;
		if (
			!(selection instanceof FootnoteLabelSelection) ||
			selection.nodePos !== getPos()
		) {
			const focused = document.activeElement === input;
			input.hidden = true;
			label.hidden = false;
			if (focused) view.focus();
			return;
		}
		const value = String(selection.$from.parent.attrs.label);
		if (draft.composing || draft.pending) return;
		if (input.value !== value) input.value = value;
		input.hidden = false;
		label.hidden = true;
		input.removeAttribute("aria-invalid");
		input.focus({ preventScroll: true });
		// Preserve the native anchor while the model already has this range.
		// Reassigning the same range erases a backward selection's direction.
		if (
			input.selectionStart !== selection.start ||
			input.selectionEnd !== selection.end
		)
			input.setSelectionRange(selection.start, selection.end);
	};
	input.addEventListener("beforeinput", select);
	input.addEventListener("select", () => {
		if (document.activeElement === input && valid()) select();
	});
	const draft = createMarkdownFieldDraft(editor, () => {
		input.removeAttribute("aria-invalid");
		if (!valid()) {
			input.setAttribute("aria-invalid", "true");
			return false;
		}
		const pos = getPos();
		if (typeof pos !== "number" || view.state.doc.nodeAt(pos)?.type.name !== "footnoteDefinition") return false;
		if (input.value !== view.state.doc.nodeAt(pos)?.attrs.label)
			changeLabel(view, pos, input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0);
		return true;
	});
	input.addEventListener("input", () => { draft.input(); draft.commit(); });
	input.addEventListener("compositionstart", () => { select(); draft.compositionStart(); });
	input.addEventListener("compositionend", () => { draft.compositionEnd(); draft.commit(); });
	input.addEventListener("keydown", (event) => {
		if (event.isComposing) return;
		if (
			(event.metaKey || event.ctrlKey) &&
			["z", "y"].includes(event.key.toLowerCase())
		) {
			event.preventDefault();
			event.stopPropagation();
			if (draft.pending) draft.cancel();
			(event.shiftKey || event.key.toLowerCase() === "y" ? redo : undo)(
				view.state,
				view.dispatch,
			);
			// Redo can remove this NodeView and its focused input entirely.
			if (!(view.state.selection instanceof FootnoteLabelSelection))
				view.focus();
			return;
		}
		if (event.key === "Backspace" && !input.value) {
			event.preventDefault();
			backspaceFootnoteLabel(view);
			return;
		}
		const atEnd =
			input.selectionStart === input.value.length &&
			input.selectionEnd === input.value.length;
		const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
		if (
			["Enter", "Escape", "Tab"].includes(event.key) ||
			(!event.shiftKey &&
				((event.key === "ArrowRight" && atEnd) ||
					(event.key === "ArrowLeft" && atStart)))
		) {
			event.preventDefault();
			if (event.key === "Escape") draft.cancel();
			else if (draft.pending && !draft.commit()) return;
			leave(event.key === "ArrowLeft");
		}
	});
	input.addEventListener("blur", () => {
		if (!input.hidden && view.state.selection instanceof FootnoteLabelSelection &&
			!draft.composing && (!draft.pending || draft.commit())) leave();
	});
	const stopObserving = observeFootnoteSelection(view, sync);
	return {
		open() {
			const pos = getPos();
			if (typeof pos !== "number") return;
			const length = String(
				view.state.doc.nodeAt(pos)?.attrs.label ?? "",
			).length;
			view.dispatch(
				view.state.tr.setSelection(
					new FootnoteLabelSelection(view.state.doc, pos, 0, length),
				),
			);
		},
		destroy() { stopObserving(); draft.destroy(); },
	};
}
