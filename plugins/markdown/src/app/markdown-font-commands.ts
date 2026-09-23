import { type Command, getMarkType } from "@tiptap/core";
import { type FontProperty, fontParents } from "./markdown-inline-style";

/** Official setMark then replaces the leaf; reset only this property in parents. */
export function clearParentFont(property: FontProperty): Command {
	return ({ tr, dispatch }) => {
		if (!dispatch) return true;
		const type = getMarkType("textStyle", tr.doc.type.schema);
		const clear = (attrs: Record<string, unknown>) => {
			const parents = fontParents(attrs)
				.map((font) => ({ ...font, [property]: null }))
				.filter((font) => font.fontFamily || font.fontSize);
			return { ...attrs, fontParents: parents.length ? parents : null };
		};
		if (tr.selection.empty) {
			const mark = type.isInSet(tr.storedMarks ?? tr.selection.$from.marks());
			if (mark) tr.addStoredMark(type.create(clear(mark.attrs)));
			return true;
		}
		for (const { $from, $to } of tr.selection.ranges) {
			tr.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
				const mark = type.isInSet(node.marks);
				if (!mark) return;
				tr.addMark(
					Math.max(pos, $from.pos),
					Math.min(pos + node.nodeSize, $to.pos),
					type.create(clear(mark.attrs)),
				);
			});
		}
		return true;
	};
}
