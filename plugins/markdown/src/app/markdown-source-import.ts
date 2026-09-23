import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { HTML_BLOCK_START } from "./markdown-html-block-source";
import { markdownParsedBlockRange } from "./markdown-parse-source";
import { MARKDOWN_LINE_BREAK_GLOBAL_PATTERN, type MarkdownSourceBlock } from "./markdown-source-blocks";
import { containsSourceEditor, isEmptyTextblockNode, serializeNodeSnapshot, serializeTopLevelMarkdownNode } from "./markdown-source-editor-snapshot";
import { MarkdownSourceManager } from "./markdown-source-manager";

/** Only source-only history imports need to bind a recorded presentation to
 * parsed source. Live transactions already carry their actual source ranges. */
interface MarkdownImportedSourceBlock extends MarkdownSourceBlock {
  items?: readonly MarkdownSourceBlock[];
  nodes(): readonly ProseMirrorNode[];
}

const TERMINAL_LINE_BREAKS_PATTERN = /(?:\r\n|\n|\r)+$/u;

function collectMarkdownEditorSourceBlocks(markdown: string, editor: Editor) {
	if (!(editor.markdown instanceof MarkdownSourceManager)) throw new Error("Markdown source region has no source parser.");
	const parsed = editor.markdown.parseSource(markdown);
	const doc = editor.state.schema.nodeFromJSON(parsed.doc);
	return parsed.blocks.map(block => ({
		...markdownParsedBlockRange(markdown, block), items: block.items,
		nodes: () => doc.children.slice(block.fromNode, block.toNode),
	}));
}

export function bindImportedMarkdownSourceRanges(
	markdown: string,
	sourceBlocks: MarkdownImportedSourceBlock[],
	editor: Editor,
): MarkdownSourceBlock[] {
	const alignedBlocks: MarkdownSourceBlock[] = [];
	let sourceIndex = 0;

	for (
		let nodeIndex = 0;
		nodeIndex < editor.state.doc.childCount;
		nodeIndex += 1
	) {
		const node = editor.state.doc.child(nodeIndex);
		if (isEmptyTextblockNode(node)) {
			const original = sourceBlocks[sourceIndex];
			if (original?.synthetic) {
				alignedBlocks.push({ start: original.start, end: original.end, synthetic: true });
				sourceIndex++;
			} else {
				const position = original?.start ?? alignedBlocks.at(-1)?.end ?? 0;
				alignedBlocks.push({ start: position, end: position, synthetic: true });
			}
			continue;
		}
		// Omitted empty presentation nodes keep their bytes in the source gaps.
		while (sourceBlocks[sourceIndex]?.synthetic) sourceIndex++;

		const serializedNode = serializeTopLevelMarkdownNode(editor, nodeIndex);
		if (serializedNode === null) {
			throw new Error(`Markdown source mapping is missing block ${sourceIndex} for node ${nodeIndex}.`);
		}

		let currentSourceBlock = sourceBlocks[sourceIndex];
		if (!currentSourceBlock) {
			throw new Error(`Markdown source mapping is missing block ${sourceIndex} for node ${nodeIndex}.`);
		}
		// An imported presentation may partition a list. The real lexer already
    // emitted each item boundary; consume the requested count without probing lines.
    const items = currentSourceBlock.items;
    if (["bulletList", "taskList", "orderedList"].includes(node.type.name) && items) {
      const count = node.childCount;
      if (count === 0 || count > items.length) throw new Error("Imported list has no matching item range.");
      if (count < items.length) {
        const end = items[count - 1]!.end;
        const terminal = markdown.slice(currentSourceBlock.start, end).match(TERMINAL_LINE_BREAKS_PATTERN)?.[0].length ?? 0;
        const remainder = importedListPartition(markdown, editor, items[count]!.start, currentSourceBlock.end, items.slice(count));
        currentSourceBlock = importedListPartition(markdown, editor, currentSourceBlock.start, end - terminal, items.slice(0, count));
        sourceBlocks = [...sourceBlocks.slice(0, sourceIndex), currentSourceBlock, remainder, ...sourceBlocks.slice(sourceIndex + 1)];
      }
    }
		// Literal presentation owns its emitted source, even when that text spans
		// several canonical blocks. Consume it once, retaining original CRLF offsets.
		const prefixSize = HTML_BLOCK_START.test(serializedNode) || containsSourceEditor(node)
			? literalPrefixSize(markdown.slice(currentSourceBlock.start), serializedNode)
			: null;
		if (prefixSize !== null) {
			const end = currentSourceBlock.start + prefixSize;
			alignedBlocks.push({ start: currentSourceBlock.start, end });
			while (sourceIndex < sourceBlocks.length && sourceBlocks[sourceIndex]!.end <= end) sourceIndex++;
			// Cutting an unclosed HTML token changes the grammar of its remainder.
			// Already complete producer ranges need no second parse.
			if (sourceBlocks[sourceIndex] && sourceBlocks[sourceIndex]!.start < end) {
				sourceBlocks = collectMarkdownEditorSourceBlocks(markdown.slice(end), editor).map(block => ({
					...block, start: block.start + end, end: block.end + end,
					items: block.items?.map(item => ({ start: item.start + end, end: item.end + end })),
				}));
				sourceIndex = 0;
			}
			continue;
		}

		if (importedSourceMatchesNode(currentSourceBlock, node)) {
			alignedBlocks.push({ start: currentSourceBlock.start, end: currentSourceBlock.end });
			sourceIndex += 1;
			continue;
		}

    throw new Error(`Markdown source block ${sourceIndex} does not map to editor node ${nodeIndex}.`);
  }
  if (alignedBlocks.length !== editor.state.doc.childCount)
    throw new Error("Markdown source mapping has an incomplete node range.");
  // Every input range was emitted for an actual parsed node. Definitions
  // without a node never entered this array, so no semantic reparse is needed.
  while (sourceBlocks[sourceIndex]?.synthetic) sourceIndex++;
  if (sourceIndex !== sourceBlocks.length)
    throw new Error("Markdown source mapping leaves a rendered source block unassigned.");
  return alignedBlocks;
}


/** Compare newline-normalized source without losing original source offsets. */
function literalPrefixSize(source: string, serialized: string): number | null {
	let offset = 0;
	for (const character of serialized.replace(
		MARKDOWN_LINE_BREAK_GLOBAL_PATTERN,
		"\n",
	)) {
		if (character === "\n" && source[offset] === "\r") {
			offset += source[offset + 1] === "\n" ? 2 : 1;
		} else {
			if (!source.startsWith(character, offset)) return null;
			offset += character.length;
		}
	}
	return offset === source.length || source[offset] === "\n" || source[offset] === "\r" ? offset : null;
}


/** A changed list boundary has a new parse context. Parse only that actual
 * partition when semantic validation is needed, never candidate prefixes. */
function importedListPartition(markdown: string, editor: Editor, start: number, end: number, items: readonly MarkdownSourceBlock[]): MarkdownImportedSourceBlock {
	return { start, end, items, nodes: () => {
		if (!editor.markdown) throw new Error("Imported list has no Markdown parser.");
		return editor.state.schema.nodeFromJSON(editor.markdown.parse(markdown.slice(start, end))).children;
	} };
}

function importedSourceMatchesNode(block: MarkdownImportedSourceBlock, node: ProseMirrorNode): boolean {
	const nodes = block.nodes();
	return nodes.length === 1 && serializeNodeSnapshot(nodes[0]!) === serializeNodeSnapshot(node);
}
