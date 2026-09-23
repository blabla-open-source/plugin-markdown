import type { NodeViewRenderer } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";

export const htmlAnchorNodeView: NodeViewRenderer = ({
	node: initial,
	editor,
	getPos,
}) => {
	let node = initial;
	const dom = document.createElement("span");
	dom.contentEditable = "false";
	dom.dataset.markdownHtmlAnchor = "";
	const input = document.createElement("input");
	input.setAttribute("aria-label", "Named anchor source");
	input.autocomplete = "off";
	input.spellcheck = false;
	const render = () => {
		const source = String(node.attrs.source ?? "");
		if (input.value !== source) input.value = source;
		input.size = Math.min(Math.max(source.length, 12), 64);
	};
	const leave = (direction: -1 | 1) => {
		const position = getPos();
		if (position === undefined) return;
		const target = direction < 0 ? position : position + node.nodeSize;
		editor.view.dispatch(
			editor.state.tr.setSelection(
				TextSelection.near(editor.state.doc.resolve(target), direction),
			),
		);
		editor.view.focus();
	};
	dom.append(input);
	input.addEventListener("input", () => {
		const position = getPos();
		if (position === undefined || input.value === node.attrs.source) return;
		const tr = editor.state.tr.setNodeMarkup(position, undefined, {
			...node.attrs,
			source: input.value,
		});
		tr.setSelection(NodeSelection.create(tr.doc, position));
		editor.view.dispatch(tr);
	});
	input.addEventListener("keydown", (event) => {
		if (event.isComposing) return;
		const modified = event.metaKey || event.ctrlKey;
		if (modified && event.key.toLowerCase() === "z") {
			event.preventDefault();
			if (event.shiftKey) editor.commands.redo();
			else editor.commands.undo();
			return;
		}
		if (event.key === "Escape" || event.key === "Enter") {
			event.preventDefault();
			leave(1);
			return;
		}
		if (
			!modified &&
			!event.shiftKey &&
			input.selectionStart === input.selectionEnd &&
			(event.key === "ArrowLeft" || event.key === "ArrowRight")
		) {
			const direction = event.key === "ArrowLeft" ? -1 : 1;
			const atBoundary =
				direction < 0
					? input.selectionStart === 0
					: input.selectionEnd === input.value.length;
			if (atBoundary) {
				event.preventDefault();
				leave(direction);
			}
		}
	});
	render();
	return {
		dom,
		update(next) {
			if (next.type !== node.type) return false;
			node = next;
			render();
			return true;
		},
		selectNode() {
			queueMicrotask(() => input.focus());
		},
		stopEvent: (event) => event.target === input,
		ignoreMutation: () => true,
	};
};
