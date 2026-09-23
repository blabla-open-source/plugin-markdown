import type { Editor } from "@tiptap/core";
import { markdownCharacterSourcePosition } from "./markdown-character-source";
import type { MarkdownSourceInput } from "./markdown-source-patch-plan";

/** Read character provenance from the selected source-session version. */
export function colorSourceCaret(
	editor: Editor,
	from: number,
	to: number,
	position: number,
	input: MarkdownSourceInput | null,
): number | null {
	if (!input?.inline) return null;
	const content = editor.state.doc.slice(from, to).content;
	let visibleSource = false;
	content.descendants((node) => {
		if (node.type.spec.code) return false;
		if (
			node.isText &&
			!node.marks.some((mark) => mark.type.spec.code) &&
			/<\/?span(?:\s|>)/i.test(node.text ?? "")
		)
			visibleSource = true;
		return true;
	});
	// Literal/unfinished tags already have a source-editing path. Do not hide
	// that path inside another source editor when navigating a styled parent.
	if (visibleSource) return null;
	const { inline, contentFrom, contentTo, sourceFrom } = input;
	const original = inline.node.content.cut(contentFrom, contentTo);
	if (!original.eq(content)) return null;
	const target = position - from;
	let bias: -1 | 1 = -1;
	// A merged text node continues on the right across source-only delimiters.
	// At actual model node boundaries preserve the preceding node's endpoint.
	original.forEach((node, offset) => {
		if (node.isText && offset < target && target < offset + node.nodeSize) bias = 1;
	});
	const characters = inline.characters.filter(segment => segment.to > contentFrom && segment.from < contentTo);
	const offset = markdownCharacterSourcePosition(characters, contentFrom + target, bias);
	return offset === null ? null : offset - sourceFrom;
}
