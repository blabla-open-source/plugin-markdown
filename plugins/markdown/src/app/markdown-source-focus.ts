import type { Editor } from "@tiptap/core";

type CloseSource = (position?: number) => number | undefined;
const closers = new WeakMap<Editor, Set<CloseSource>>();

/** Source projections share one document focus. Folding may change positions,
 * so the next editor must enter using the mapped target, not the old click. */
export function registerSourceCloser(editor: Editor, close: CloseSource) {
	const entries = closers.get(editor) ?? new Set<CloseSource>();
	entries.add(close);
	closers.set(editor, entries);
	return () => {
		entries.delete(close);
		if (!entries.size) closers.delete(editor);
	};
}

export function closeOtherSourceEditors(
	editor: Editor,
	owner: CloseSource | null,
	position: number,
) {
	for (const close of closers.get(editor) ?? [])
		if (close !== owner) position = close(position) ?? position;
	return position;
}

/** Commands consume the active source selection, not a stale outer-editor caret.
 * Navigation supplies a target above; a command lets the source owner project it. */
export function prepareMarkdownCommand(editor: Editor) {
	for (const close of closers.get(editor) ?? []) close();
}
