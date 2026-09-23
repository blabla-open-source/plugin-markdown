import type { EditorState } from "@tiptap/pm/state";

/** Keep neighboring colors together, including marks and inline atoms inside. */
export function colorRange(state: EditorState, position: number) {
	const cursor = state.doc.resolve(position);
	if (!cursor.parent.isTextblock || cursor.parent.type.spec.code) return null;
	let current: { from: number; to: number } | null = null;
	const ranges: { from: number; to: number }[] = [];
	cursor.parent.forEach((node, offset) => {
		const colored =
			node.type.name === "colorSource" ||
			node.marks.some(
				(mark) =>
					mark.type.name === "textStyle" &&
					(mark.attrs.color || mark.attrs.backgroundColor),
			);
		if (!colored) {
			current = null;
			return;
		}
		const from = cursor.start() + offset;
		if (current) current.to = from + node.nodeSize;
		else {
			current = { from, to: from + node.nodeSize };
			ranges.push(current);
		}
	});
	return (
		ranges.find((range) => range.from <= position && position <= range.to) ??
		null
	);
}
