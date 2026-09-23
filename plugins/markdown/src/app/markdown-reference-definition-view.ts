import type { NodeViewRendererProps } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import type { NodeView } from "@tiptap/pm/view";
import { openMarkdownBlockSource } from "./markdown-block-expansion";

import { createMarkdownFieldDraft } from "./markdown-field-drafts";

import { definitionPrefix, validReferenceLabel } from "./markdown-grammar";

/** A label rename is one author transaction. The address remains ordinary editable text. */
export function referenceDefinitionView({
	node,
	editor,
	view,
	getPos,
}: NodeViewRendererProps): NodeView {
	let current = node;
	const dom = document.createElement("div");
	dom.dataset.linkDefinition = "";
	const button = document.createElement("button");
	button.type = "button";
	button.contentEditable = "false";
	button.className = "reference-definition-label";
	const input = document.createElement("input");
	input.setAttribute("aria-label", "Definition label");
	input.className = "reference-definition-input";
	input.hidden = true;
	const contentDOM = document.createElement("div");
	contentDOM.className = "reference-definition-content";
	contentDOM.setAttribute("role", "textbox");
	contentDOM.setAttribute("aria-label", "Reference address and title");
	dom.append(button, input, contentDOM);
	const refresh = () => {
		const label = definitionPrefix.exec(current.attrs.prefix)?.[1] ?? "";
		button.textContent = current.attrs.prefix;
		button.setAttribute("aria-label", `Edit definition ${label}`);
	};
	const draft = createMarkdownFieldDraft(editor, () => {
		const pos = getPos();
		if (typeof pos !== "number") return false;
		if (!validReferenceLabel(input.value)) {
			input.setAttribute("aria-invalid", "true");
			return false;
		}
		const prefix = String(current.attrs.prefix).replace(/\[[^\]]*\]/, `[${input.value}]`);
		if (prefix !== current.attrs.prefix)
			view.dispatch(closeHistory(view.state.tr).setNodeAttribute(pos, "prefix", prefix));
		return true;
	});
	const leave = (commit: boolean, focus: boolean) => {
		const pos = getPos();
		if (input.hidden || typeof pos !== "number" || draft.composing) return;
		if (commit && !draft.commit()) return;
		if (!commit) draft.cancel();
		input.hidden = true;
		button.hidden = false;
		if (focus) {
			view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)));
			view.focus();
		}
	};
	input.addEventListener("input", () => {
		input.removeAttribute("aria-invalid");
		draft.input();
	});
	input.addEventListener("compositionstart", draft.compositionStart);
	input.addEventListener("compositionend", draft.compositionEnd);
	button.addEventListener("click", () => {
		const pos = getPos();
		if (!view.editable || typeof pos !== "number") return;
		if (openMarkdownBlockSource(editor, pos + 1)) return;
		input.value = definitionPrefix.exec(current.attrs.prefix)?.[1] ?? "";
		input.removeAttribute("aria-invalid");
		button.hidden = true;
		input.hidden = false;
		input.focus();
		input.select();
	});
	input.addEventListener("keydown", (event) => {
		if (event.isComposing) return;
		if (["Enter", "Escape", "Tab"].includes(event.key)) {
			event.preventDefault();
			leave(event.key !== "Escape", true);
		}
	});
	input.addEventListener("blur", () =>
		leave(true, false),
	);
	refresh();
	return {
		dom,
		contentDOM,
		destroy: draft.destroy,
		update(next) {
			if (next.type !== current.type) return false;
			current = next;
			refresh();
			return true;
		},
		stopEvent: (event) => event.target === input || event.target === button,
		ignoreMutation: (mutation) =>
			mutation.type !== "selection" && !contentDOM.contains(mutation.target),
	};
}
