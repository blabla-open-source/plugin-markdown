import { openMarkdownBlockSource } from "./markdown-block-expansion";
import type { NodeViewRendererProps } from "@tiptap/core";
import type { NodeView } from "@tiptap/pm/view";
import { focusFootnote } from "./markdown-footnote-navigation";
import { definitionLabelEditor } from "./markdown-footnote-label";
import { referenceLabelEditor } from "./markdown-footnote-reference-label";
import { footnotePreview } from "./markdown-footnote-preview";

export function footnoteNodeView({
	node,
	editor,
	view,
	getPos,
}: NodeViewRendererProps): NodeView {
	let current = node;
	const definition = node.type.name === "footnoteDefinition";
	const dom = document.createElement(definition ? "div" : "sup");
	dom.className = definition ? "footnote-definition" : "footnote-reference";
	dom.setAttribute(
		definition ? "data-footnote-definition" : "data-footnote-reference",
		"",
	);
	const label = document.createElement("button");
	label.type = "button";
	label.contentEditable = "false";
	label.className = "footnote-label";
	const input = document.createElement("input");
	input.className = "footnote-label-input";
	input.setAttribute("aria-label", "Footnote label");
	input.hidden = true;
	dom.append(label, input);
	const contentDOM = definition ? document.createElement("span") : undefined;
	if (contentDOM) {
		contentDOM.className = "footnote-content";
		dom.append(contentDOM);
	}
	const preview = definition
		? undefined
		: footnotePreview(label, view, () => current.attrs.label);
	const labelEditor = definition
		? definitionLabelEditor(editor, getPos, input, label)
		: referenceLabelEditor(editor, getPos, input, label);
	const hidePreview = () => {
		preview?.hide();
	};
	const refreshLabel = () => {
		dom.dataset.footnoteLabel = current.attrs.label;
		label.textContent = definition
			? `[^${current.attrs.label}]:`
			: current.attrs.label;
		label.setAttribute(
			"aria-label",
			`${definition ? "Footnote definition" : "Footnote reference"} ${current.attrs.label}`,
		);
		label.title = "Edit label · Ctrl/⌘ click to open definition";
	};
	label.addEventListener("click", (event) => {
		event.preventDefault();
		if (!view.editable) return;
		hidePreview();
		if ((event.ctrlKey || event.metaKey) && !definition) {
			focusFootnote(view, current.attrs.label);
			return;
		}
		const position = getPos();
 if (definition && typeof position === "number" && openMarkdownBlockSource(editor, position + 1)) return;
		labelEditor.open();
	});

	refreshLabel();
	return {
		dom,
		contentDOM,
		update(next) {
			if (next.type !== current.type) return false;
			current = next;
			refreshLabel();
			hidePreview();
			return true;
		},
		stopEvent: (event) => event.target === input || event.target === label,
		ignoreMutation: (mutation) =>
			mutation.type !== "selection" && !contentDOM?.contains(mutation.target),
		destroy() {
			preview?.destroy();
			labelEditor.destroy();
		},
	};
}
