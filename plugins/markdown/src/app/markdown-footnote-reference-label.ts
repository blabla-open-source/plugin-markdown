import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { createMarkdownFieldDraft } from "./markdown-field-drafts";
import { isFootnoteLabel } from "./markdown-footnote-source";
import { isMarkdownSaveShortcut } from "./markdown-save-policy";

export function referenceLabelEditor(
	editor: Editor,
	getPos: () => number | undefined,
	input: HTMLInputElement,
	label: HTMLButtonElement,
) {
	const draft = createMarkdownFieldDraft(editor, () => {
		if (!isFootnoteLabel(input.value)) {
			input.setAttribute("aria-invalid", "true");
			input.setCustomValidity("Enter a non-empty label without ] or line breaks.");
			input.reportValidity();
			return false;
		}
		const pos = getPos();
		const node = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
		if (typeof pos !== "number" || node?.type.name !== "footnoteReference") return false;
		if (input.value !== node.attrs.label)
			editor.view.dispatch(closeHistory(editor.state.tr).setNodeAttribute(pos, "label", input.value));
		return true;
	});
	const commit = draft.commit;
	const endEdit = (save: boolean) => {
		if (save && !commit()) return;
		if (!save) draft.cancel();
		input.hidden = true;
		label.hidden = false;
	};
	input.addEventListener("input", () => {
		input.removeAttribute("aria-invalid");
		input.setCustomValidity("");
		draft.input();
	});
	input.addEventListener("compositionstart", draft.compositionStart);
	input.addEventListener("compositionend", draft.compositionEnd);
	input.addEventListener("keydown", (event) => {
		if (event.isComposing) return;
		if (isMarkdownSaveShortcut(event)) {
			if (!commit()) {
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}
		if (event.key !== "Enter" && event.key !== "Escape") return;
		event.preventDefault();
		endEdit(event.key === "Enter");
		if (input.hidden) {
			label.focus();
			editor.view.focus();
		}
	});
	input.addEventListener("blur", () => {
		if (!input.hidden && !draft.composing) endEdit(true);
	});
	return {
		open() {
			const pos = getPos();
			if (typeof pos !== "number") return;
			input.value = String(editor.state.doc.nodeAt(pos)?.attrs.label ?? "");
			input.removeAttribute("aria-invalid");
			input.setCustomValidity("");
			input.hidden = false;
			label.hidden = true;
			input.focus();
			input.select();
		},
		destroy: draft.destroy,
	};
}
