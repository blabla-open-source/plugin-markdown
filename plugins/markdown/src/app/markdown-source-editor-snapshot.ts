import { MarkdownSourceEmission } from "./markdown-source-emission";
import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import {
	MARKDOWN_LINE_BREAK_PATTERN,
} from "./markdown-source-blocks";

const TERMINAL_LINE_BREAKS_PATTERN = /(?:\r\n|\n|\r)+$/u;

export function containsSourceEditor(node: ProseMirrorNode): boolean {
	return node.type.name === "expandedBlock" || node.type.name === "htmlBlock" || node.type.name === "colorSource" ||
		node.children.some(containsSourceEditor);
}

export function collectTopLevelNodeSnapshot(
	editor: Editor,
	nodeIndex: number,
): string | null {
	const node = editor.state.doc.child(nodeIndex);
	return node ? serializeNodeSnapshot(node) : null;
}

export function collectTopLevelNodeSnapshots(editor: Editor): string[] {
	const snapshots: string[] = [];
	for (let index = 0; index < editor.state.doc.childCount; index += 1) {
		const node = editor.state.doc.child(index);
		snapshots.push(serializeNodeSnapshot(node));
	}
	return snapshots;
}

/**
 * Snapshot identity must not distinguish content states the rich editor
 * renders identically. Markdown parsing keeps soft-wrapped lines as "\n"
 * inside text nodes, while ProseMirror's DOM reader replaces that "\n" with
 * the schema's linebreak-replacement node (hardBreak) as soon as the block is
 * touched. Canonicalizing both shapes to the same key keeps touched-then-
 * reverted blocks byte-preserved instead of re-serialized as hard breaks.
 */
// ProseMirror nodes are immutable. A transaction only needs new semantic
// snapshots for the nodes it replaces; the weak keys follow history lifetime.
const nodeSnapshots = new WeakMap<ProseMirrorNode, string>();

export function serializeNodeSnapshot(node: ProseMirrorNode): string {
	const previous = nodeSnapshots.get(node);
	if (previous !== undefined) return previous;
	const snapshot = JSON.stringify(
		canonicalizeSnapshotNodeJson(node.toJSON() as JSONContent),
	);
	nodeSnapshots.set(node, snapshot);
	return snapshot;
}

function canonicalizeSnapshotNodeJson(node: JSONContent): JSONContent {
	// TOC anchors are generated UI identity, not Markdown content changes.
	// Spelling metadata must not turn a semantic reparse into a content edit.
	const { proseStyle: _style, ...attrs } = node.attrs ?? {};
	node = { ...node, attrs, ...(node.marks ? {marks: node.marks.map(mark => mark.type === "link" && mark.attrs?.referenceLabel ? {...mark, attrs: {...mark.attrs, href: "", title: null}} : mark)} : {}) };
	if (node.type === "image" && node.attrs?.referenceLabel)
		node = { ...node, attrs: { ...node.attrs, src: "", title: null } };
	const snapshot =
		node.type === "heading"
			? { ...node, attrs: { ...node.attrs, id: null, "data-toc-id": null } }
			: node;
	if (!Array.isArray(node.content)) {
		return snapshot;
	}

	const content: JSONContent[] = [];
	for (const child of node.content) {
		for (const piece of canonicalizeSnapshotChildJson(child)) {
			appendSnapshotChildJson(content, piece);
		}
	}

	return { ...snapshot, content };
}

function canonicalizeSnapshotChildJson(child: JSONContent): JSONContent[] {
	if (child.type === "hardBreak") {
		return [createSnapshotLineBreakJson()];
	}
	if (child.type === "text" && typeof child.text === "string") {
		return splitSnapshotTextJsonAtLineBreaks(canonicalizeSnapshotNodeJson(child));
	}
	return [canonicalizeSnapshotNodeJson(child)];
}

function splitSnapshotTextJsonAtLineBreaks(
	textNode: JSONContent,
): JSONContent[] {
	const segments = (textNode.text ?? "").split(MARKDOWN_LINE_BREAK_PATTERN);
	const pieces: JSONContent[] = [];
	segments.forEach((segment, index) => {
		if (index > 0) {
			pieces.push(createSnapshotLineBreakJson());
		}
		if (segment !== "") {
			pieces.push({ ...textNode, text: segment });
		}
	});
	return pieces;
}

function createSnapshotLineBreakJson(): JSONContent {
	return { text: "\n", type: "text" };
}

function appendSnapshotChildJson(
	children: JSONContent[],
	child: JSONContent,
): void {
	const previous = children.at(-1);
	if (
		previous?.type === "text" &&
		child.type === "text" &&
		snapshotMarksKey(previous) === snapshotMarksKey(child)
	) {
		children[children.length - 1] = {
			...previous,
			text: (previous.text ?? "") + (child.text ?? ""),
		};
		return;
	}
	children.push(child);
}

function snapshotMarksKey(node: JSONContent): string {
	return JSON.stringify(node.marks ?? []);
}

/** Empty source slots have no syntax of their own. Headings and definitions
 * retain their delimiters and therefore own ordinary source ranges. */
export function isEmptyTextblockNode(node: ProseMirrorNode): boolean {
	// Fenced literal blocks retain delimiters when empty; source projections do not.
	return (
		node.isTextblock &&
		(!node.type.spec.code || node.type.name === "htmlBlock" || node.type.name === "expandedBlock") &&
		node.type.name !== "heading" &&
		node.type.name !== "footnoteDefinition" &&
		node.content.size === 0
	);
}

export function serializeInsertedTopLevelMarkdownNodeRange(
	editor: Editor,
	startIndex: number,
	endIndex: number,
	hasFollowingBlock: boolean,
	readSource: (index: number) => string | null,
	separator: (index: number) => string = () => "\n\n",
): MarkdownSourceEmission | null {
	const pieces: string[] = [];
	for (let index = startIndex; index < endIndex; index++) {
		const source = isEmptyTextblockNode(editor.state.doc.child(index)) ? "" : readSource(index) ?? serializeTopLevelMarkdownNode(editor, index);
		if (source === null) return null;
		pieces.push(source);
	}
	const output = new MarkdownSourceEmission();
	if (!pieces.length) return output;
	if (pieces.every(piece => piece === "")) {
		for (let index = startIndex; index < endIndex; index++) {
			output.block(index, "", true);
			output.separator("\n\n");
		}
		return output;
	}
	const retained = hasFollowingBlock ? pieces.length : trimTrailingEmptyMarkdownBlocks(pieces).length;
	for (let index = 0; index < pieces.length; index++) {
		if (index && index < retained) output.separator(separator(startIndex + index));
		output.block(startIndex + index, index < retained ? pieces[index]! : "", isEmptyTextblockNode(editor.state.doc.child(startIndex + index)));
	}
	if (hasFollowingBlock) output.separator(separator(endIndex));
	else if (startIndex) output.prepend(separator(startIndex));
	return output;
}

export function serializeTopLevelMarkdownNode(
	editor: Editor,
	nodeIndex: number,
): string | null {
	const node = editor.state.doc.child(nodeIndex);
	if (!(editor.markdown && node)) {
		return null;
	}

	try {
		const singleNodeDocument = editor.state.schema.topNodeType.create(null, [
			node,
		]);
		const serialized = editor.markdown.serialize(
			singleNodeDocument.toJSON() as JSONContent,
		);
		return stripTerminalLineBreaks(serialized);
	} catch {
		return null;
	}
}

export function topLevelSnapshotsEqual(
	left: string[],
	right: string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((snapshot, index) => snapshot === right[index])
	);
}

function stripTerminalLineBreaks(markdown: string): string {
	return markdown.replace(TERMINAL_LINE_BREAKS_PATTERN, "");
}

function trimTrailingEmptyMarkdownBlocks(blocks: string[]): string[] {
	let end = blocks.length;
	while (end > 1 && blocks[end - 1] === "") {
		end -= 1;
	}
	return blocks.slice(0, end);
}
