import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { MarkdownSourceInput } from "./markdown-source-patch-plan";
import type { MarkdownSourceBlockReader } from "./markdown-source-patch";

export function serializeColorSource(
	editor: Editor,
	state: EditorState,
	from: number,
	to: number,
	readBlock?: MarkdownSourceBlockReader,
): string {
	const node = state.doc.nodeAt(from);
	if (node?.type.name === "colorSource" && from + node.nodeSize === to)
		return node.attrs.source;
	return (
		readOriginalColorSource(state, from, to, readBlock)?.source ??
		editor.markdown?.serialize({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: state.doc.slice(from, to).content.toJSON(),
				},
			],
		}) ??
		""
	);
}

/** Read the syntax interval emitted for this exact document interval. Adjacent
 * runs remain distinct even when ProseMirror merges their equal text marks. */
export function readOriginalColorSource(
	state: EditorState,
	from: number,
	to: number,
	readBlock?: MarkdownSourceBlockReader,
): MarkdownSourceInput | null {
	const cursor = state.doc.resolve(from);
	return readBlock?.(cursor.node(1), cursor.index(0), {
		from: from - cursor.before(1) - 1,
		to: to - cursor.before(1) - 1,
	}) ?? null;
}
