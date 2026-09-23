import { MarkdownSourceEmission, type MarkdownEmittedBlock } from "./markdown-source-emission";
import { markdownSourceChanges } from "./markdown-source-anchors";
import type { Editor } from "@tiptap/react";
import { patchMarkdownInlineSource, type MarkdownInlineSource } from "./markdown-inline-source";
import {
	MARKDOWN_LINE_BREAK_GLOBAL_PATTERN,
	MARKDOWN_LINE_BREAK_PATTERN,
	type MarkdownSourceBlock,
 type MarkdownSourceGap,
} from "./markdown-source-blocks";
import {
	collectTopLevelNodeSnapshot,
 isEmptyTextblockNode,
	serializeInsertedTopLevelMarkdownNodeRange,
	serializeTopLevelMarkdownNode,
} from "./markdown-source-editor-snapshot";

const TERMINAL_LINE_BREAKS_PATTERN = /(?:\r\n|\n|\r)+$/u;

export interface MarkdownSourcePatchPlan {
	emissions: Array<{ start: number; blocks: MarkdownEmittedBlock[] }>;
	markdown: string;
	ranges: MarkdownSourcePatchRange[];
}

export interface MarkdownSourcePatchRange {
	end: number;
	replacement: string;
	start: number;
}

export interface MarkdownSourceSpelling { semantic: string; source: string; folded?: string; inline?: MarkdownInlineSource }
export interface MarkdownBlockSource { authored: MarkdownSourceSpelling; current: MarkdownSourceSpelling }

export interface MarkdownSourceInput {
  source: string;
  sourceFrom: number;
  contentFrom: number;
  contentTo: number;
  inline?: MarkdownInlineSource;
}

/** Select the spelling and its coordinates together from the same version. */
export function readMarkdownBlockInput(block: MarkdownBlockSource | undefined, semantic: string, range?: { from: number; to: number }): MarkdownSourceInput | null {
  if (!block) return null;
  for (const spelling of [block.current, block.authored]) {
    if (spelling.semantic !== semantic && spelling.folded !== semantic) continue;
    const inline = spelling.inline;
    if (!range) return { source: spelling.source, sourceFrom: 0, contentFrom: 0, contentTo: inline?.node.content.size ?? 0, inline };
    const start = inline?.boundaries.find(point => point.content === range.from);
    const end = inline?.boundaries.findLast(point => point.content === range.to);
    if (!start || !end || start.source > end.source) return null;
    return { source: spelling.source.slice(start.source, end.source), sourceFrom: start.source, contentFrom: range.from, contentTo: range.to, inline };
  }
  return null;
}

export function readMarkdownBlockSource(block: MarkdownBlockSource | undefined, semantic: string): string | null {
  return readMarkdownBlockInput(block, semantic)?.source ?? null;
}

export interface MarkdownSourcePatchPlanState {
  blockSources: MarkdownBlockSource[];
	blocks: MarkdownSourceBlock[];
 gaps: MarkdownSourceGap[];
	markdown: string;
	nodeSnapshots: string[];
}

export function createMarkdownSourcePatchPlan(
	editor: Editor,
	previousState: MarkdownSourcePatchPlanState,
	nodeSnapshots: string[],
  origins: Array<number | null>,
  listBoundaries: Map<number, number>,
): MarkdownSourcePatchPlan | null {
	const changes = markdownSourceChanges(previousState.nodeSnapshots, nodeSnapshots, origins);
	const ranges: MarkdownSourcePatchRange[] = [];
	const emissions: MarkdownSourcePatchPlan["emissions"] = [];
	let sourceDelta = 0;
	for (const change of changes) {
		const patchRange = createMarkdownPatchRange(editor, previousState, origins, listBoundaries, change);
		if (!patchRange) return null;
		ranges.push({ start: patchRange.start, end: patchRange.end, replacement: patchRange.replacement });
		// Changes arrive in source order, so adjacent replacement endpoints
		// have an unambiguous offset in the resulting source.
		emissions.push({ start: patchRange.start + sourceDelta, blocks: patchRange.blocks });
		sourceDelta += patchRange.replacement.length - (patchRange.end - patchRange.start);
	}

	let nextMarkdown = previousState.markdown;
	for (const { end, replacement, start } of ranges.sort(
		(left, right) => right.start - left.start,
	)) {
		nextMarkdown =
			nextMarkdown.slice(0, start) + replacement + nextMarkdown.slice(end);
	}

	return {
		markdown: nextMarkdown,
		emissions,
		ranges,
	};
}

function createMarkdownPatchRange(
	editor: Editor,
	previousState: MarkdownSourcePatchPlanState,
  origins: Array<number | null>,
  listBoundaries: Map<number, number>,
	range: {
		currentEnd: number;
		currentStart: number;
		previousEnd: number;
		previousStart: number;
	},
): (MarkdownSourcePatchRange & { blocks: MarkdownEmittedBlock[] }) | null {
	const hasPreviousBlocks = range.previousStart < range.previousEnd;
	const previousBlocks = previousState.blocks.slice(
		range.previousStart,
		range.previousEnd,
	);
	const replacesOnlySyntheticBlocks =
		previousBlocks.length > 0 &&
		previousBlocks.every(isSyntheticMarkdownSourceBlock);
 // Folding an already empty source editor keeps the same keyboard landing
 // block. It is not insertion of another blank paragraph into its source gap.
 const firstEmpty = previousBlocks[0];
 const lastEmpty = previousBlocks.at(-1);
 if (replacesOnlySyntheticBlocks && firstEmpty && lastEmpty && previousBlocks.length === range.currentEnd - range.currentStart && previousBlocks.every((_, offset) => isEmptyTextblockNode(editor.state.doc.child(range.currentStart + offset)))) {
  return { start: firstEmpty.start, end: lastEmpty.end, replacement: previousState.markdown.slice(firstEmpty.start, lastEmpty.end), blocks: previousBlocks.map((block, index) => ({ ...block, nodeIndex: range.currentStart + index, start: block.start - firstEmpty.start, end: block.end - firstEmpty.start })) };
 }

	const output =
		hasPreviousBlocks && !replacesOnlySyntheticBlocks
			? serializeTopLevelMarkdownNodeRange(
					editor,
					previousState,
					range.currentStart,
					range.currentEnd,
          origins,
          listBoundaries,
				)
			: serializeInsertedTopLevelMarkdownNodeRange(
					editor,
					range.currentStart,
					range.currentEnd,
					previousState.blocks
						.slice(range.previousEnd)
						.some((block) => !isSyntheticMarkdownSourceBlock(block)),
          (index) => sourceForOrigin(previousState, origins[index], collectTopLevelNodeSnapshot(editor, index) ?? ""),
					(index) => {
						let position = 0;
						for (let i = 0; i < index; i++) position += editor.state.doc.child(i).nodeSize;
						return "\n".repeat(listBoundaries.get(position) ?? 2);
					},
				);
	if (output === null) {
		return null;
	}
	if (!hasPreviousBlocks || replacesOnlySyntheticBlocks)
		output.lineEndings(previousState.markdown.match(MARKDOWN_LINE_BREAK_PATTERN)?.[0] ?? "\n");

	if (!hasPreviousBlocks) {
		const insertPosition =
			previousState.blocks[range.previousEnd]?.start ??
			terminalContentEnd(previousState.markdown);
		return {
			end: insertPosition,
			replacement: output.markdown,
			blocks: output.blocks,
			start: range.previousEnd === 0 ? 0 : insertPosition,
		};
	}

	const firstBlock = previousState.blocks[range.previousStart];
	const lastBlock = previousState.blocks[range.previousEnd - 1];
	if (!(firstBlock && lastBlock)) {
		return null;
	}
	// An empty paragraph at the front of a split owns both separators. Its preceding
	// source boundary may still be the single newline between typed list groups.
	if (!replacesOnlySyntheticBlocks && range.currentStart > 0 && range.currentEnd > range.currentStart + 1 &&
		isEmptyTextblockNode(editor.state.doc.child(range.currentStart))) {
		const gap = previousState.gaps[range.previousStart];
		if (gap?.kind === "whitespace") {
			const count = previousState.markdown.slice(gap.start, gap.end).match(MARKDOWN_LINE_BREAK_GLOBAL_PATTERN)?.length ?? 0;
			const lineBreak = previousState.markdown.match(MARKDOWN_LINE_BREAK_PATTERN)?.[0] ?? "\n";
			output.prepend(lineBreak.repeat(Math.max(0, 2 - count)));
		}
	}
	// A newly created empty paragraph between blocks needs a separator on
	// both sides, even when the previous typed list groups had only one newline.
	if (!replacesOnlySyntheticBlocks && range.currentEnd > range.currentStart &&
		range.currentEnd < editor.state.doc.childCount &&
		isEmptyTextblockNode(editor.state.doc.child(range.currentEnd - 1))) {
		const followingStart = previousState.blocks[range.previousEnd]?.start;
		const following = followingStart === undefined ? "" : previousState.markdown.slice(lastBlock.end, followingStart);
		const existing = following.match(MARKDOWN_LINE_BREAK_GLOBAL_PATTERN)?.length ?? 0;
		const lineBreak = previousState.markdown.match(MARKDOWN_LINE_BREAK_PATTERN)?.[0] ?? "\n";
		output.separator(lineBreak.repeat(Math.max(0, 2 - existing)));
	}
	if (replacesOnlySyntheticBlocks) {
		// Clearing a content block leaves its surrounding separators in source.
		// Filling that empty block must not append a second following separator.
		const followingStart = previousState.blocks[range.previousEnd]?.start;
		const following =
			followingStart === undefined
				? ""
				: previousState.markdown.slice(lastBlock.end, followingStart);
		const existing =
			following.match(MARKDOWN_LINE_BREAK_GLOBAL_PATTERN)?.length ?? 0;
		const suffix = output.markdown.match(TERMINAL_LINE_BREAKS_PATTERN)?.[0] ?? "";
		const separators = suffix.match(MARKDOWN_LINE_BREAK_GLOBAL_PATTERN) ?? [];
		if (separators.length === 2 && existing) {
			const redundant = separators.slice(0, Math.min(existing, 2)).join("");
			output.truncate(output.markdown.length - redundant.length);
		}
	}

	const followingStart = previousState.blocks[range.previousEnd]?.start;
  const movesSource = origins.some((origin) => origin !== null && origin >= range.previousStart && origin < range.previousEnd);
  const followingGap = previousState.gaps[range.previousEnd];
  const removedEnd = movesSource && range.currentStart === range.currentEnd && followingStart !== undefined &&
    followingGap?.kind === "whitespace" ? followingGap.end : lastBlock.end;
  return {
		end: removedEnd,
		replacement: output.markdown,
		blocks: output.blocks,
		// The first empty block owns the leading whitespace. Replacing it must
		// start at the document boundary, not after an unowned prefix.
		start:
			range.previousStart === 0 && isSyntheticMarkdownSourceBlock(firstBlock)
				? 0
				: firstBlock.start,
	};
}

function terminalContentEnd(markdown: string): number {
	const terminal = markdown.match(TERMINAL_LINE_BREAKS_PATTERN);
	return terminal?.index ?? markdown.length;
}

function serializeTopLevelMarkdownNodeRange(
	editor: Editor,
	previousState: MarkdownSourcePatchPlanState,
	startIndex: number,
	endIndex: number,
  origins: Array<number | null>,
  listBoundaries: Map<number, number>,
): MarkdownSourceEmission | null {
	const serializedBlocks: string[] = [];
	for (let nodeIndex = startIndex; nodeIndex < endIndex; nodeIndex += 1) {
		const snapshot = collectTopLevelNodeSnapshot(editor, nodeIndex);
		const origin = origins[nodeIndex];
    const source = origin === null || origin === undefined ? undefined : previousState.blockSources[origin];
		const previousSource = readMarkdownBlockSource(source, snapshot ?? "");
		if (previousSource !== null) {
			serializedBlocks.push(previousSource);
			continue;
		}
		const inlineSource = source && patchMarkdownInlineSource(editor, source.current.source, source.current.inline, editor.state.doc.child(nodeIndex));
		if (inlineSource !== null && inlineSource !== undefined) {
			serializedBlocks.push(inlineSource);
			continue;
		}

		const serializedBlock = serializeTopLevelMarkdownNode(editor, nodeIndex);
		if (serializedBlock === null) {
			return null;
		}
		serializedBlocks.push(
				preserveBlockLineEndings(
					previousState.markdown.slice(
						previousState.blocks[origin ?? nodeIndex]?.start,
						previousState.blocks[origin ?? nodeIndex]?.end,
					),
					serializedBlock,
					previousState.markdown,
				),
		);
	}

	// A single replacement inherits the surrounding source separators. An
	// empty replacement clears content; it does not insert another blank line.
	const output = new MarkdownSourceEmission();
	if (serializedBlocks.length === 1) {
		output.block(startIndex, serializedBlocks[0]!, isEmptyTextblockNode(editor.state.doc.child(startIndex)));
		return output;
	}
	const blocks = endIndex === editor.state.doc.childCount
		? trimTrailingEmptyMarkdownBlocks(serializedBlocks)
		: serializedBlocks;
	const lineBreak = previousState.markdown.match(MARKDOWN_LINE_BREAK_PATTERN)?.[0] ?? "\n";
	for (let index = 0; index < serializedBlocks.length; index++) {
  if (index && index < blocks.length) {
  const before = origins[startIndex + index - 1];
  const after = origins[startIndex + index];
  const gap = before !== null && before !== undefined && after === before + 1 ? previousState.gaps[after] : undefined;
  let position = 0;
  for (let i = 0; i < startIndex + index; i++) position += editor.state.doc.child(i).nodeSize;
  let separator = gap ? previousState.markdown.slice(gap.start, gap.end) : lineBreak.repeat(listBoundaries.get(position) ?? 2);
  // A structural command may make a formerly tight boundary loose. Preserve
  // opaque source and larger authored gaps; supply only missing whitespace.
  if (gap?.kind === "whitespace" && listBoundaries.get(position) === 2 && (separator.match(MARKDOWN_LINE_BREAK_GLOBAL_PATTERN)?.length ?? 0) < 2)
    separator = lineBreak.repeat(2);
  output.separator(separator);
  }
  output.block(startIndex + index, blocks[index] ?? "", isEmptyTextblockNode(editor.state.doc.child(startIndex + index)));
 }
 return output;
}

function preserveBlockLineEndings(
	source: string,
	serialized: string,
	fallbackSource = "",
): string {
	// A single-line source block has no delimiter of its own. New lines follow
	// the document instead of introducing LF into an otherwise CRLF document.
	const lineBreak =
		source.match(MARKDOWN_LINE_BREAK_PATTERN)?.[0] ??
		fallbackSource.match(MARKDOWN_LINE_BREAK_PATTERN)?.[0] ??
		"\n";
	return serialized.replace(MARKDOWN_LINE_BREAK_GLOBAL_PATTERN, lineBreak);
}

function isSyntheticMarkdownSourceBlock(block: MarkdownSourceBlock): boolean {
	return block.synthetic === true;
}

function trimTrailingEmptyMarkdownBlocks(blocks: string[]): string[] {
	let end = blocks.length;
	while (end > 1 && blocks[end - 1] === "") {
		end -= 1;
	}
	return blocks.slice(0, end);
}

function sourceForOrigin(state: MarkdownSourcePatchPlanState, origin: number | null | undefined, snapshot: string): string | null {
  return origin === null || origin === undefined ? null : readMarkdownBlockSource(state.blockSources[origin], snapshot);
}
