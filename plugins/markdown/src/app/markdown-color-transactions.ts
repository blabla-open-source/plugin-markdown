import { MarkdownSourceManager } from "./markdown-source-manager";
import { recordMarkdownPresentationPartition } from "./markdown-presentation-partitions";
import type { MarkdownSourceBlockReader } from "./markdown-source-patch";
import { markMarkdownPresentation } from "./markdown-source-operations";
import type { Editor } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { type EditorState, TextSelection } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { assertMarkdownCaretStructure, markdownParsedSourcePoint } from "./markdown-parsed-point";

import { MarkdownSourceBlockStep as ColorSourceStep, type ColorSourceSplit } from "./markdown-source-block-step";
export { MarkdownSourceBlockStep as ColorSourceStep, type ColorSourceSplit } from "./markdown-source-block-step";

export function replaceColorSource(
	state: EditorState,
	from: number,
	to: number,
	source: string,
	split?: ColorSourceSplit,
) {
	const content = state.schema.node("colorSource", { source });
	const cursor = state.doc.resolve(from);
	const replacement = state.tr.replaceWith(from, to, content);
	const parent = replacement.doc.resolve(from).parent;
	return state.tr.step(
		new ColorSourceStep(
			new ReplaceStep(
				cursor.before(),
				cursor.after(),
				new Slice(Fragment.from(parent), 0, 0),
			),
			split
				? { ...split, offset: cursor.parentOffset, undo: false }
				: undefined,
		),
	);
}

/** Reparse the whole parent, but map only the actual changed range. Keeping
 * the identical prefix/suffix out of the map preserves both history branches. */
export function foldColorSource(
	editor: Editor,
	state: EditorState,
	from: number,
	sourceOffset?: number,
	projection?: { to: number; source: string },
	readBlock?: MarkdownSourceBlockReader,
) {
	const tr = markMarkdownPresentation(state.tr);
	const current = state.doc.nodeAt(from);
	if (!editor.markdown) return tr;
	const node = projection ? state.schema.node("colorSource", { source: projection.source }) : current;
	if (node?.type.name !== "colorSource") return tr;
	const to = projection?.to ?? from + node.nodeSize;
	const cursor = state.doc.resolve(from);
	const sourceParent = state.tr.replaceWith(from, to, node).doc.resolve(from).parent;
	if (!(editor.markdown instanceof MarkdownSourceManager)) throw new Error("Color folding requires the source parser.");
	let emitted: { source: string; position: number } | undefined;
	if (sourceOffset !== undefined) {
		const parent = sourceParent.toJSON();
		const target = parent.content?.[cursor.index()];
		if (!target) throw new Error("Color source caret has no selected node.");
		emitted = editor.markdown.serializeSourcePoint(parent, target, sourceOffset);
	}
	let source: string;
	// A top-level source version owns its spelling. Parsing that exact input
	// makes the fold partitions valid even beside noncanonical inline syntax.
	if (cursor.depth === 1 && readBlock) {
		const original = readBlock(cursor.node(1), cursor.index(0));
		if (original === null) throw new Error("Color fold has no current source spelling.");
		source = original.source;
	} else {
		source = emitted?.source ?? editor.markdown.serialize({ type: "doc", content: [sourceParent.toJSON()] });
	}
	const parsedSource = editor.markdown.parseSource(source);
	const parsed = state.schema.nodeFromJSON(parsedSource.doc);
	const replacement = state.tr.replaceWith(
		cursor.before(),
		cursor.after(),
		parsed.content,
	);
	const start = state.doc.content.findDiffStart(replacement.doc.content);
	const difference = state.doc.content.findDiffEnd(replacement.doc.content);
	if (start !== null && difference) {
		const overlap = Math.max(0, start - Math.min(difference.a, difference.b));
		tr.replace(start, difference.a + overlap, replacement.doc.slice(start, difference.b + overlap));
		recordMarkdownPresentationPartition(tr, cursor.before(), cursor.after(), parsed.content.size, parsedSource);
	}
	let end = replacement.mapping.map(cursor.after(), 1);
	if (parsed.lastChild?.isTextblock) {
		const suffix = cursor.parent.content.cut(
			to - cursor.start(),
		);
		const tail = parsed.lastChild.content.findDiffEnd(suffix);
		end -= 1 + suffix.size - (tail?.b ?? 0);
	}
	if (emitted) {
		const located = emitted.source === source ? parsedSource : editor.markdown.parseSource(emitted.source);
		const locatedDoc = located === parsedSource ? parsed : state.schema.nodeFromJSON(located.doc);
		assertMarkdownCaretStructure(locatedDoc, parsed);
		end = cursor.before() + markdownParsedSourcePoint(located, locatedDoc, emitted.position);
	}
	return tr
		.setSelection(TextSelection.near(tr.doc.resolve(end), -1))
		.setStoredMarks([]);
}
