import type { EditorView } from "@codemirror/view";
import type { NodeViewRendererProps } from "@tiptap/core";
import { defaultCodeEditorConfiguration } from "./markdown-code-editing";
import { mathCodeBinding } from "./markdown-source-code-binding";
import { sourceCodeEditor } from "./markdown-source-code-editor";

export function mathCodeEditor(
	props: NodeViewRendererProps,
	leave: (direction?: number, deleting?: boolean) => void,
) {
	const boundary = (view: EditorView, direction: -1 | 1, line: boolean) => {
		const { main } = view.state.selection;
		const range = line
			? view.moveToLineBoundary(main, direction > 0, true)
			: main;
		if (
			!main.empty ||
			(direction < 0 ? range.from > 0 : range.to < view.state.doc.length)
		)
			return false;
		leave(direction);
		return true;
	};
	return sourceCodeEditor(props, {
		label: "Formula source",
		binding: mathCodeBinding,
		language: () => "latex",
		preferences: () =>
			props.extension.options.getCodeEditorConfiguration?.() ??
			defaultCodeEditorConfiguration,
		keys: [
			{
				key: "Escape",
				run: () => {
					leave();
					return true;
				},
			},
			{
				key: "Mod-Enter",
				run: () => {
					leave();
					return true;
				},
			},
			{
				key: "Backspace",
				run: (view) => {
					if (view.state.doc.length) return false;
					leave(1, true);
					return true;
				},
			},
			{ key: "ArrowLeft", run: (view) => boundary(view, -1, false) },
			{ key: "ArrowRight", run: (view) => boundary(view, 1, false) },
			{ key: "ArrowUp", run: (view) => boundary(view, -1, true) },
			{ key: "ArrowDown", run: (view) => boundary(view, 1, true) },
		],
	});
}
