import type { EditorView, KeyBinding } from "@codemirror/view";
import type { NodeViewRendererProps } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Selection } from "@tiptap/pm/state";
import {
	type CodeEditorConfiguration,
	defaultCodeEditorConfiguration,
} from "./markdown-code-editing";
import { textCodeBinding } from "./markdown-source-code-binding";
import { sourceCodeEditor } from "./markdown-source-code-editor";

/** Textblock selection and commands remain owned by the outer ProseMirror document. */
export function codeEditor(
	props: NodeViewRendererProps,
	label: string,
	onExit?: () => boolean,
) {
	const { editor, getPos } = props;
	const html = props.node.type.name === "htmlBlock";
	const leave = (view: EditorView, direction: -1 | 1, line: boolean) => {
		const { main } = view.state.selection;
		const range = line
			? view.moveToLineBoundary(main, direction > 0, true)
			: main;
		if (
			!main.empty ||
			(direction < 0 ? range.from > 0 : range.to < view.state.doc.length)
		)
			return false;
		const position = getPos();
		if (position === undefined) return false;
		const node = editor.state.doc.nodeAt(position);
		if (!node) return false;
		const boundary = position + (direction < 0 ? 0 : node.nodeSize);
		const next = Selection.near(editor.state.doc.resolve(boundary), direction);
		if (next.$from.parent === editor.state.selection.$from.parent) {
			if (direction < 0) return false;
			return onExit?.() ?? editor.commands.exitCode();
		}
		editor.view.dispatch(
			closeHistory(editor.state.tr).setSelection(next).scrollIntoView(),
		);
		editor.view.focus();
		return true;
	};
	const keys: KeyBinding[] = [
		{
			key: "Mod-Alt-c",
			run: () => editor.chain().toggleCodeBlock().focus().run(),
		},
		{
			key: "Backspace",
			run: (view) => {
				const { empty, $anchor } = editor.state.selection;
				if (
					!empty ||
					(html
						? view.state.doc.length > 0
						: $anchor.pos !== 1 && view.state.doc.length > 0)
				)
					return false;
				return editor.chain().clearNodes().focus().run();
			},
		},
		{
			key: "Mod-Enter",
			run: () => {
				const result = onExit?.() ?? editor.commands.exitCode();
				if (result) editor.view.focus();
				return result;
			},
		},
		{ key: "ArrowLeft", run: (view) => leave(view, -1, false) },
		{ key: "ArrowRight", run: (view) => leave(view, 1, false) },
		{ key: "ArrowUp", run: (view) => leave(view, -1, true) },
		{ key: "ArrowDown", run: (view) => leave(view, 1, true) },
	];
	return sourceCodeEditor(props, {
		label,
		binding: textCodeBinding,
		keys,
		language: (node) => (html ? "html" : String(node.attrs.language ?? "")),
		preferences: () => {
			const value: CodeEditorConfiguration =
				props.extension.options.getCodeEditorConfiguration?.() ??
				defaultCodeEditorConfiguration;
			return html
				? { ...value, codeLineNumbers: false, codePairing: true }
				: value;
		},
	});
}
