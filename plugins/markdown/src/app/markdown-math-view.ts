import { blockToolbar } from "./markdown-block-toolbar";
import type { NodeViewRenderer } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import katex from "katex";
import { mathCodeEditor } from "./markdown-math-code-editor";

/** Official math nodes keep one LaTeX value; the input writes it immediately. */
export const mathNodeView: NodeViewRenderer = (props) => {
	const { node: initial, editor, getPos } = props;
	let node = initial;
	const block = node.type.name === "blockMath";
	const dom = document.createElement(block ? "div" : "span");
	dom.className = "markdown-math";
	dom.dataset.type = block ? "block-math" : "inline-math";
	dom.contentEditable = "false";
	const controls = document.createElement("span");
	controls.className = "markdown-math-controls";
	controls.hidden = true;
	const input = document.createElement("textarea");
	input.setAttribute("aria-label", "Formula source");
	input.spellcheck = false;
	input.rows = block ? 3 : 1;
	const preview = document.createElement("button");
	preview.type = "button";
	preview.className = "markdown-math-preview";
	preview.setAttribute("aria-label", "Edit formula");
	const error = document.createElement("span");
	error.className = "markdown-math-error";
	error.setAttribute("role", "status");
	const toolbar = blockToolbar("Formula");
	const done = toolbar.done;
	const remove = document.createElement("button");
	remove.type = "button";
	remove.textContent = "Remove formula";
	const code = block
		? mathCodeEditor(props, (direction, deleting) => leave(direction, deleting))
		: null;
	const source = code?.dom ?? input;
	const focusSource = () => (code ? code.focus() : input.focus());
	const more = document.createElement("details");
	const summary = document.createElement("summary");
	summary.textContent = "•••";
	summary.setAttribute("aria-label", "Formula actions");
	more.append(summary, remove);
	controls.addEventListener("pointerdown", (event) => {
		if (!more.contains(event.target as Node)) more.open = false;
	});
	more.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			event.preventDefault();
			more.open = false;
			summary.focus();
		}
	});
	toolbar.dom.insertBefore(more, done);
	controls.append(toolbar.dom, source);
	dom.append(controls, preview, error);
	const render = () => {
		const latex: string = node.attrs.latex ?? "";
		dom.dataset.latex = latex;
		if (code) code.update(node);
		else if (input.value !== latex) input.value = latex;
		error.hidden = true;
		if (!latex) {
			preview.textContent = "Empty formula";
			return;
		}
		try {
			katex.render(latex, preview, {
				displayMode: block,
				throwOnError: true,
				trust: false,
			});
		} catch {
			preview.textContent = latex;
			error.textContent = "Invalid formula — edit source to correct it.";
			error.hidden = false;
		}
	};
	const leave = (direction = 1, deleting = false) => {
		const position = getPos();
		if (position === undefined) return;
		const tr = editor.state.tr;
		let target = direction < 0 ? position : position + node.nodeSize;
		if (deleting) {
			tr.delete(position, position + node.nodeSize);
			target = position;
		}
		const boundary = tr.doc.resolve(Math.min(target, tr.doc.content.size));
		if (
			block &&
			!(direction < 0 ? boundary.nodeBefore : boundary.nodeAfter)?.isTextblock
		) {
			const paragraph = editor.schema.nodes.paragraph?.create();
			if (paragraph) tr.insert(target, paragraph);
		}
		tr.setSelection(
			TextSelection.near(
				tr.doc.resolve(Math.min(target, tr.doc.content.size)),
				direction,
			),
		);
		editor.view.dispatch(tr);
		editor.view.focus();
	};
	preview.addEventListener("click", () => {
		if (!editor.isEditable) return;
		const position = getPos();
		if (position === undefined) return;
		editor.view.dispatch(
			closeHistory(editor.state.tr).setSelection(
				NodeSelection.create(editor.state.doc, position),
			),
		);
		controls.hidden = false;
		focusSource();
	});
	done.addEventListener("click", () => {
		controls.hidden = true;
		more.open = false;
		preview.focus();
	});
	remove.addEventListener("click", () => leave(1, true));
	input.addEventListener("input", () => {
		const position = getPos();
		if (position === undefined || input.value === node.attrs.latex) return;
		const tr = editor.state.tr.setNodeMarkup(position, undefined, {
			...node.attrs,
			latex: input.value,
			...(input.value.includes("\n") ? { compact: false } : {}),
		});
		// Replacing an inline atom otherwise maps NodeSelection to a text cursor.
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
		if (
			event.key === "Escape" ||
			(event.key === "Enter" && (modified || !block))
		) {
			event.preventDefault();
			leave();
			return;
		}
		if (event.key === "Backspace" && input.value === "") {
			event.preventDefault();
			leave(1, true);
			return;
		}
		if (
			event.shiftKey ||
			modified ||
			input.selectionStart !== input.selectionEnd
		)
			return;
		if (
			(event.key === "ArrowLeft" || event.key === "ArrowUp") &&
			input.selectionStart === 0
		) {
			event.preventDefault();
			leave(-1);
		}
		if (
			(event.key === "ArrowRight" || event.key === "ArrowDown") &&
			input.selectionEnd === input.value.length
		) {
			event.preventDefault();
			leave();
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
			if (!editor.isEditable) return;
			controls.hidden = false;
			dom.classList.add("ProseMirror-selectednode");
			queueMicrotask(() => {
				if (
					dom.isConnected &&
					editor.state.selection instanceof NodeSelection &&
					editor.state.selection.from === getPos()
				)
					focusSource();
			});
		},
		deselectNode() {
			controls.hidden = true;
			more.open = false;
			dom.classList.remove("ProseMirror-selectednode");
		},
		stopEvent: (event) =>
			event.target instanceof globalThis.Node && dom.contains(event.target),
		ignoreMutation: () => true,
		destroy: () => code?.destroy(),
	};
};
