import { selectAll } from "@tiptap/pm/commands";
import { closeHistory, redo, undo } from "@tiptap/pm/history";
import { keydownHandler } from "@tiptap/pm/keymap";
import type { Node } from "@tiptap/pm/model";
import { Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { ALERT_HEADER } from "./markdown-alert-source";
import { readAlertType } from "./markdown-alert-types";
import { attributeSelection } from "./markdown-attribute-selection";

const markerSelection = attributeSelection(
	"blockquote",
	"alertMarker",
	"alertMarker",
);
const MarkerSelection = markerSelection.Selection;
export const alertMarkerSelectionPlugin = markerSelection.plugin;

export function exitEmptyAlert(view: EditorView) {
	const { state } = view;
	const { $from, empty } = state.selection;
	const depth = $from.depth - 1;
	if (
		!empty ||
		depth < 1 ||
		$from.parent.type.name !== "paragraph" ||
		$from.parent.content.size
	)
		return false;
	const node = $from.node(depth);
	if (
		node.type.name !== "blockquote" ||
		!node.attrs.alert ||
		node.attrs.alertSource ||
		node.childCount !== 1
	)
		return false;
	// The only paragraph is empty, but its parent still owns the title.
	// Keep that title instead of lifting away the entire blockquote.
	const after = $from.after(depth);
	const tr = closeHistory(state.tr)
		.setNodeMarkup($from.before(depth), undefined, {
			...node.attrs,
			alertBlock: false,
		})
		.insert(after, $from.parent);
	tr.setSelection(TextSelection.create(tr.doc, after + 1));
	view.dispatch(tr.scrollIntoView());
	view.dispatch(closeHistory(view.state.tr));
	return true;
}

function materializeMarker(tr: Transaction, pos: number, node: Node) {
	const marker = String(node.attrs.alertMarker);
	const schema = tr.doc.type.schema;
	const paragraph = schema.nodes.paragraph;
	if (!paragraph) throw new Error("Alert editing requires paragraph nodes.");
	const bodySize = node.firstChild?.content.size ?? 0;
	const inline =
		!node.attrs.alertBlock && node.firstChild?.type.name === "paragraph";
	if (inline && marker)
		tr.insert(pos + 2, schema.text(marker + (bodySize ? "\n" : "")));
	else if (!inline)
		tr.insert(
			pos + 1,
			paragraph.create(null, marker ? schema.text(marker) : null),
		);
	tr.setNodeMarkup(pos, undefined, {
		...node.attrs,
		alertMarker: null,
		alertBlock: false,
		alertSource: true,
	});
	return inline && bodySize > 0;
}

function splitMarker(view: EditorView, soft: boolean) {
	const selection = view.state.selection;
	if (!(selection instanceof MarkerSelection)) return;
	const pos = selection.nodePos;
	const node = view.state.doc.nodeAt(pos);
	if (!node) return;
	const marker = String(node.attrs.alertMarker);
	const tr = closeHistory(view.state.tr);
	const softBreak = materializeMarker(tr, pos, node);
	const from = pos + 2 + selection.start;
	const to = pos + 2 + selection.end;
	// At the marker end both keys separate the header from the body.
	const split = !soft || selection.end === marker.length;
	tr.delete(from, to + (softBreak && selection.end === marker.length ? 1 : 0));
	if (split) tr.split(from);
	else tr.insertText("\n", from);
	tr.setSelection(TextSelection.create(tr.doc, from + (split ? 2 : 1)));
	const first = tr.doc.nodeAt(pos)?.firstChild;
	const match = split && first && ALERT_HEADER.exec(first.textContent);
	if (first && match) {
		tr.delete(pos + 1, pos + 1 + first.nodeSize);
		tr.setNodeMarkup(pos, undefined, {
			...node.attrs,
			alert: readAlertType(match[2]?.toLowerCase()),
			alertMarker: match[1],
			alertBlock: true,
			alertSource: false,
		});
	}
	view.dispatch(tr.scrollIntoView());
	view.dispatch(closeHistory(view.state.tr));
	view.focus();
}

export function settleAlertMarker(tr: Transaction, pos: number) {
	const node = tr.doc.nodeAt(pos);
	if (
		!node ||
		node.attrs.alertMarker === null ||
		node.attrs.alertSource ||
		node.attrs.alert ||
		(tr.selection instanceof MarkerSelection && tr.selection.nodePos === pos)
	)
		return;
	materializeMarker(tr, pos, node);
}

export function alertMarkerEditor(
	view: EditorView,
	getPos: () => number | undefined,
	input: HTMLInputElement,
) {
	let composing = false;
	const rememberCaret = () => {
		const pos = getPos();
		if (pos === undefined || input.hidden || composing) return;
		const selection = new MarkerSelection(
			view.state.doc,
			pos,
			input.selectionStart ?? 0,
			input.selectionEnd ?? 0,
		);
		if (!selection.eq(view.state.selection))
			view.dispatch(view.state.tr.setSelection(selection));
	};
	const leave = (focus = false, backward = false) => {
		const pos = getPos();
		if (pos === undefined || input.hidden) return;
		input.hidden = true;
		const tr = view.state.tr;
		if (view.state.selection instanceof MarkerSelection)
			tr.setSelection(
				backward
					? Selection.near(tr.doc.resolve(pos), -1)
					: Selection.near(tr.doc.resolve(pos + 1)),
			);
		view.dispatch(tr);
		if (focus) view.focus();
	};
	const selectDocument = keydownHandler({
		"Mod-a": () => {
			leave(true);
			return selectAll(view.state, view.dispatch);
		},
	});
	const sync = () => {
		const selection = view.state.selection;
		if (
			!(selection instanceof MarkerSelection) ||
			selection.nodePos !== getPos()
		) {
			input.hidden = true;
			return;
		}
		if (composing) return;
		const value = String(selection.$from.parent.attrs.alertMarker ?? "");
		if (input.value !== value) input.value = value;
		input.size = Math.max(4, value.length + 1);
		input.hidden = false;
		input.focus({ preventScroll: true });
		// Preserve the native anchor while the model already has this range.
		// Reassigning the same range erases a backward selection's direction.
		if (
			input.selectionStart !== selection.start ||
			input.selectionEnd !== selection.end
		)
			input.setSelectionRange(selection.start, selection.end);
	};
	const commit = () => {
		const pos = getPos();
		if (composing || pos === undefined) return;
		const node = view.state.doc.nodeAt(pos);
		if (!node || input.value === node.attrs.alertMarker) return;
		const type = readAlertType(
			ALERT_HEADER.exec(input.value)?.[2]?.toLowerCase(),
		);
		const tr = closeHistory(view.state.tr).setNodeMarkup(pos, undefined, {
			...node.attrs,
			alert: type,
			alertMarker: input.value,
		});
		view.dispatch(
			tr.setSelection(
				new MarkerSelection(
					tr.doc,
					pos,
					input.selectionStart ?? 0,
					input.selectionEnd ?? 0,
				),
			),
		);
	};
	input.addEventListener("beforeinput", rememberCaret);
	input.addEventListener("select", () => {
		if (document.activeElement === input) rememberCaret();
	});
	input.addEventListener("input", commit);
	input.addEventListener("compositionstart", () => {
		rememberCaret();
		composing = true;
	});
	input.addEventListener("compositionend", () => {
		composing = false;
		commit();
	});
	input.addEventListener("blur", () => leave());
	input.addEventListener("keydown", (event) => {
		if (event.isComposing) return;
		if (event.key === "Enter") {
			event.preventDefault();
			rememberCaret();
			splitMarker(view, event.shiftKey);
			return;
		}
		const key = event.key.toLowerCase();
		if (selectDocument(view, event)) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if ((event.metaKey || event.ctrlKey) && (key === "z" || key === "y")) {
			event.preventDefault();
			event.stopPropagation();
			(event.shiftKey || key === "y" ? redo : undo)(view.state, view.dispatch);
			if (!(view.state.selection instanceof MarkerSelection)) view.focus();
			return;
		}
		const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
		const atEnd =
			input.selectionStart === input.value.length &&
			input.selectionEnd === input.value.length;
		if (
			["Escape", "Tab"].includes(event.key) ||
			(!event.shiftKey &&
				((event.key === "ArrowLeft" && atStart) ||
					(event.key === "ArrowRight" && atEnd)))
		) {
			event.preventDefault();
			leave(
				true,
				event.key === "ArrowLeft" || (event.key === "Tab" && event.shiftKey),
			);
		}
	});
	return {
		open() {
			const pos = getPos();
			if (pos === undefined || !view.editable) return;
			view.dispatch(
				view.state.tr.setSelection(new MarkerSelection(view.state.doc, pos, 0)),
			);
		},
		destroy: markerSelection.observe(view, sync),
	};
}
