import type { SourceBoundary } from "marked";
import { MarkdownSourceManager } from "./markdown-source-manager";
import { recordMarkdownPresentationPartition } from "./markdown-presentation-partitions";
import type { Transaction } from "@tiptap/pm/state";
import { markMarkdownPresentation } from "./markdown-source-operations";
import { type Editor, Node } from "@tiptap/core";
import { Fragment, type Node as PMNode, Slice } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import { MarkdownSourceBlockStep } from "./markdown-source-block-step";
import type { MarkdownSourceBlockReader } from "./markdown-source-patch";
import type { MarkdownParsedSource } from "./markdown-parse-source";
import { assertMarkdownCaretStructure, markdownParsedSourcePoint } from "./markdown-parsed-point";

/** Transient source remains document data, including incomplete block markers. */
export const MarkdownExpandedBlock = Node.create({
	name: "expandedBlock",
	group: "block",
	content: "inline*",
	atom: true,
	code: true,
	whitespace: "pre",
	marks: "_",
	addAttributes: () => ({
		source: { default: "", rendered: false },
		original: { default: "", rendered: false },
	}),
	renderHTML: () => ["div", { "data-expanded-block": "" }, 0],
	renderMarkdown(node, helpers) {
		return JSON.stringify(node.content ?? []) === node.attrs?.original
			? String(node.attrs.source)
			: helpers.renderChildren(node.content ?? []);
	},
});

export function expandMarkdownBlock(
	editor: Editor,
	node: PMNode,
	index: number,
	readBlock?: MarkdownSourceBlockReader,
) {
	if (node.type.name === "expandedBlock") return { node, offset: 0 };
	if (
		!["heading", "footnoteDefinition", "linkDefinition"].includes(
			node.type.name,
		) ||
		!editor.markdown
	)
		return null;
	const source = (
		readBlock?.(node, index)?.source ??
		editor.markdown.serialize({ type: "doc", content: [node.toJSON()] })
	).replace(/[\r\n]+$/, "");
	if (/[\r\n]/.test(source)) return null;
	const prefix =
		node.type.name === "heading"
			? /^ {0,3}#{1,6}[ \t]*/.exec(source)?.[0]
			: /^ {0,3}\[[^\]\r\n]+\]:[ \t]*/.exec(source)?.[0];
	if (prefix === undefined) return null;
	const suffix =
		node.type.name === "heading"
			? (/[ \t]+#+[ \t]*$/.exec(source.slice(prefix.length))?.[0] ?? "")
			: "";
	const schema = editor.schema;
	const content = Fragment.from(schema.text(prefix))
		.append(node.content)
		.append(suffix ? Fragment.from(schema.text(suffix)) : Fragment.empty);
	return {
		node: schema.node(
			"expandedBlock",
			{ source, original: JSON.stringify(content.toJSON()) },
			content,
		),
		offset: prefix.length,
	};
}

export function expandedMarkdown(editor: Editor, node: PMNode) {
	const markdown = editor.markdown;
	if (!markdown)
		throw new Error("Block source editing requires Markdown support.");
	return markdown.serialize({ type: "doc", content: [node.toJSON()] });
}

export function appendFoldedBlock(editor: Editor, tr: Transaction, from: number, to: number, node: PMNode) {
 if (!(editor.markdown instanceof MarkdownSourceManager)) throw new Error("Block folding requires the source parser.");
 const parsed = editor.markdown.parseSource(expandedMarkdown(editor, node));
 const doc = editor.schema.nodeFromJSON(parsed.doc);
 const content = doc.content.size ? doc.content : Fragment.from(editor.schema.node("paragraph"));
 tr.step(new MarkdownSourceBlockStep(new ReplaceStep(from, to, new Slice(content, 0, 0)), undefined, true));
 recordMarkdownPresentationPartition(tr, from, to, content.size, parsed);
 return { doc: doc.copy(content), source: parsed };
}

export function foldExpandedBlock(
	editor: Editor,
	from: number,
	position?: number,
	bias = 1,
	selection?: { anchor: number; head: number },
) {
	const state = editor.state;
	const node = state.doc.nodeAt(from);
	const tr = markMarkdownPresentation(state.tr);
	if (node?.type.name === "expandedBlock" && editor.markdown) {
		const parsed = appendFoldedBlock(editor, tr, from, from + node.nodeSize, node);
		if (selection) return tr.setSelection(expandedBlockSelection(editor, node, from, selection, tr.doc, parsed.source));
	}
	const target =
		position === undefined ? from + 1 : tr.mapping.map(position, bias);
	tr.setSelection(
		TextSelection.near(
			tr.doc.resolve(Math.max(0, Math.min(target, tr.doc.content.size))),
			bias,
		),
	);
	return tr;
}

/** A command keeps both directed source endpoints through folding. */
function expandedBlockSelection(
	editor: Editor,
	node: PMNode,
	from: number,
	selection: { anchor: number; head: number },
	doc: PMNode,
	parsed: MarkdownParsedSource,
) {
	const markdown = editor.markdown;
	if (!(markdown instanceof MarkdownSourceManager)) throw new Error("Block source editing requires the source parser.");
	const original = editor.schema.nodeFromJSON(parsed.doc);
	const sources = new Map([[parsed.source, parsed]]);
	const project = (position: number) => {
		const offset = Math.max(0, Math.min(position - 1, node.content.size));
		const parent = node.toJSON();
		// Coordinate emission renders the actual contents; authored bytes remain
		// the fold authority, independently of the pristine-source cache.
		parent.attrs = { ...parent.attrs, original: null };
		let selected: { index: number; offset: number | "end" } | undefined;
		node.forEach((child, start, index) => {
			if (!selected && offset <= start + child.nodeSize)
				selected = { index, offset: child.isText ? offset - start : offset === start ? 0 : "end" };
		});
		if (!selected) return TextSelection.near(doc.resolve(from)).head;
		const target = parent.content![selected.index]!;
		const emitted = markdown.serializeSourcePoint(parent, target, selected.offset);
		let located = sources.get(emitted.source);
		if (!located) { located = markdown.parseSource(emitted.source); sources.set(emitted.source, located); }
		const locatedDoc = editor.schema.nodeFromJSON(located.doc);
		assertMarkdownCaretStructure(locatedDoc, original);
		return TextSelection.near(doc.resolve(from + markdownParsedSourcePoint(located, locatedDoc, emitted.position))).head;
	};
	return TextSelection.create(doc, project(selection.anchor), project(selection.head));
}

/** Keep the edit boundary in the producing parse, without inserting source text. */
export function splitExpandedBlock(
 editor: Editor,
 view: EditorView,
 active: { from: number; node: PMNode },
) {
 const state = editor.state;
 const previous = state.doc.nodeAt(active.from);
 const markdown = editor.markdown;
 if (!previous || !markdown) return null;
 if (!(markdown instanceof MarkdownSourceManager)) throw new Error("Block splitting requires the source parser.");
 const content = view.state.doc.firstChild?.content;
 if (!content) return null;
 const { from, to } = view.state.selection;
 const inserted = active.node.copy(content.cut(0, from - 1)
  .append(Fragment.from(state.schema.text("\n\n"))).append(content.cut(to - 1)));
 const parent = inserted.toJSON();
 parent.attrs = { ...parent.attrs, original: null };
 let index = 0, local = from + 1;
 for (; index < inserted.childCount - 1 && local > inserted.child(index).nodeSize; index++) local -= inserted.child(index).nodeSize;
 const emitted = markdown.serializeSourcePoint(parent, parent.content![index]!, local, true);
 const boundary: SourceBoundary = { point: emitted.source.slice(0, emitted.position).replace(/\r\n?/g, "\n").length, taken: false, affinity: 1 };
 const source = markdown.parseSource(emitted.source, boundary);
 if (boundary.rejected || !source.blocks.some(block => block.start <= emitted.position && emitted.position <= block.end)) return null;
 const replacement = state.schema.nodeFromJSON(source.doc);
 const offset = markdownParsedSourcePoint(source, replacement, emitted.position, boundary.affinity);
 const tr = closeHistory(state.tr).step(new MarkdownSourceBlockStep(new ReplaceStep(
  active.from, active.from + previous.nodeSize, new Slice(replacement.content, 0, 0),
 )));
 tr.setSelection(TextSelection.near(tr.doc.resolve(active.from + offset)));
 return tr;
}
