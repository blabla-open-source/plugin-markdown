import { bindImportedMarkdownSourceRanges } from "./markdown-source-import";
import type { MarkdownParsedSource } from "./markdown-parse-source";
import type { Transaction } from "@tiptap/pm/state";
import { markdownPresentationPartitions, presentationSourceRecords } from "./markdown-presentation-partitions";
import { MarkdownSourceManager } from "./markdown-source-manager";
import type { Editor } from "@tiptap/core";
import { Fragment, type Node } from "@tiptap/pm/model";
import { collectMarkdownSourceGaps } from "./markdown-source-blocks";
import { captureParsedMarkdownInlineSource, supportsMarkdownInlineSource } from "./markdown-inline-source";
import { collectTopLevelNodeSnapshots, containsSourceEditor, serializeNodeSnapshot } from "./markdown-source-editor-snapshot";
import type { MarkdownSourcePatchPlan, MarkdownSourcePatchPlanState, MarkdownSourcePatchRange } from "./markdown-source-patch-plan";

export type MarkdownSourcePatchState = MarkdownSourcePatchPlanState & { doc: Node };

/** Presentation transactions carry their actual source partitions. */
export function rebindMarkdownPresentationSource(previous: MarkdownSourcePatchState, editor: Editor, origins: Array<number | null>, nodeSnapshots: string[], transactions: readonly Transaction[] = []): MarkdownSourcePatchState {
	const markdown = previous.markdown;
	const blocks = origins.map((origin) => {
		const block = origin === null ? undefined : previous.blocks[origin];
		return block;
	});
	const blockSources = origins.map((origin) => origin === null ? undefined : previous.blockSources[origin]);
	for (const partition of markdownPresentationPartitions(transactions, previous.doc, editor.state.doc)) {
		const first = previous.blocks[partition.previousStart];
		const last = previous.blocks[partition.previousEnd - 1];
		if (!first || !last) throw new Error("Presentation partition has no original block span.");
		const sourceBlocks = presentationSourceRecords(markdown.slice(first.start, last.end), partition.source, partition.blocks, partition.spellings);
		for (const [index, { block, spelling }] of sourceBlocks.entries()) {
			const current = partition.currentStart + index;
			blocks[current] = { ...block, start: first.start + block.start, end: first.start + block.end };
      if (spelling.semantic === nodeSnapshots[current]) {
       blockSources[current] = { authored: blockSources[current]?.authored ?? spelling, current: spelling };
      }
		}
	}
	const assignedBlocks = blocks.map((block) => {
		if (!block) throw new Error("Markdown source update left a node without a range.");
		return block;
	});
	return {
		doc: editor.state.doc, markdown, nodeSnapshots, blocks: assignedBlocks,
		gaps: collectMarkdownSourceGaps(markdown, assignedBlocks),
		blockSources: sourceSpellings(markdown, editor, blockSources, nodeSnapshots, assignedBlocks),
	};
}

function mapSourceOffset(position: number, side: -1 | 1, ranges: readonly MarkdownSourcePatchRange[]) {
	let delta = 0;
	for (const range of ranges) {
		if (position < range.start || (position === range.start && side < 0)) break;
		if (position > range.end || (position === range.end && side > 0)) {
			delta += range.replacement.length - (range.end - range.start);
		} else return range.start + delta + (side < 0 ? 0 : range.replacement.length);
	}
	return position + delta;
}

/** Source-only imported history has no live presentation transactions. Its
 * canonical parse already owns every source block; consume those ranges once. */
export function importMarkdownSourcePresentation(previous: MarkdownSourcePatchState, editor: Editor, parsed: MarkdownParsedSource): MarkdownSourcePatchState {
  const nodeSnapshots = collectTopLevelNodeSnapshots(editor);
  let start = 0;
  let previousEnd = previous.nodeSnapshots.length;
  let currentEnd = nodeSnapshots.length;
  while (start < previousEnd && start < currentEnd && previous.nodeSnapshots[start] === nodeSnapshots[start]) start++;
  while (previousEnd > start && currentEnd > start && previous.nodeSnapshots[previousEnd - 1] === nodeSnapshots[currentEnd - 1]) { previousEnd--; currentEnd--; }
  if (start === previousEnd && start === currentEnd) return { ...previous, doc: editor.state.doc };
  const from = previous.blocks[start]?.start ?? previous.markdown.length;
  const to = previousEnd > start ? previous.blocks[previousEnd - 1]!.end : from;
  const source = previous.markdown.slice(from, to);
  const doc = editor.state.doc.copy(Fragment.fromArray(editor.state.doc.children.slice(start, currentEnd)));
  const state = Object.defineProperty(Object.create(editor.state), "doc", { value: doc });
  const regionEditor = Object.defineProperty(Object.create(editor), "state", { value: state }) as Editor;
  const inputs = previous.blocks.slice(start, previousEnd).map((block, index) => ({ ...block, nodes: () => [previous.doc.child(start + index)], start: block.start - from, end: block.end - from, items: parsed.blocks[start + index]?.items?.map(item => ({start: item.start - from, end: item.end - from})) }));
  const imported = bindImportedMarkdownSourceRanges(source, inputs, regionEditor);
  const blocks = [...previous.blocks.slice(0, start), ...imported.map(block => ({ ...block, start: from + block.start, end: from + block.end })), ...previous.blocks.slice(previousEnd)];
  const sources = nodeSnapshots.map((_, index) => index < start ? previous.blockSources[index] : index >= currentEnd ? previous.blockSources[previousEnd + index - currentEnd] : index === start ? previous.blockSources[start] : undefined);
  return {
    doc: editor.state.doc, markdown: previous.markdown, nodeSnapshots, blocks,
    gaps: collectMarkdownSourceGaps(previous.markdown, blocks),
    blockSources: sourceSpellings(previous.markdown, editor, sources, nodeSnapshots, blocks),
  };
}

function sourceSpellings(markdown: string, editor: Editor, previousSources: readonly (MarkdownSourcePatchState["blockSources"][number] | undefined)[], nodeSnapshots: string[], blocks: MarkdownSourcePatchPlanState["blocks"]) {
  return nodeSnapshots.map((semantic, index) => {
      const block = blocks[index];
      if (!block) throw new Error("Markdown source node has no assigned range.");
      const source = markdown.slice(block.start, block.end);
      const prior = previousSources[index];
      const previous = prior?.current;
      if (previous?.semantic === semantic && previous.source === source) return prior!;
      const node = editor.state.doc.child(index);
      const presentation = containsSourceEditor(node);
      const needsParse = presentation || supportsMarkdownInlineSource(node);
      if (!(editor.markdown instanceof MarkdownSourceManager)) throw new Error("Markdown spelling has no source parser.");
      const parsed = needsParse ? editor.markdown.parseSource(source) : undefined;
      const canonical = parsed && editor.state.schema.nodeFromJSON(parsed.doc);
      const original = canonical?.childCount === 1 ? canonical.firstChild : null;
      const current = {
        semantic, source,
        inline: parsed && original?.eq(node) ? captureParsedMarkdownInlineSource(node, parsed.blocks.flatMap(block => [...block.inline])) : undefined,
        ...(presentation && original ? { folded: serializeNodeSnapshot(original) } : {}),
      };
      const authored = prior?.authored ?? current;
      return { authored, current };
  });
}

/** Edits already know which node emitted each byte. Surviving ranges move
 * through source replacements; newly written ranges come from the serializer. */
export function advanceEmittedMarkdownSourceState(previous: MarkdownSourcePatchState, markdown: string, editor: Editor, origins: Array<number | null>, nodeSnapshots: string[], plan: MarkdownSourcePatchPlan): MarkdownSourcePatchState {
  const sorted = [...plan.ranges].sort((left, right) => left.start - right.start);
  const blocks = origins.map(origin => {
    const block = origin === null ? undefined : previous.blocks[origin];
    return block && { ...block, start: mapSourceOffset(block.start, 1, sorted), end: mapSourceOffset(block.end, block.start === block.end ? 1 : -1, sorted) };
  });
  for (const emission of plan.emissions) {
    const start = emission.start;
    for (const block of emission.blocks) blocks[block.nodeIndex] = {
      start: start + block.start,
      end: start + block.end,
      ...(block.synthetic ? { synthetic: true } : {}),
    };
  }
  const contentEnd = markdown.match(/(?:\r\n|\r|\n)+$/)?.index ?? markdown.length;
  const assigned = blocks.map(block => {
    if (!block) throw new Error("Markdown serializer left a node without source ownership.");
    const range = block.synthetic ? { ...block, start: Math.min(block.start, contentEnd), end: Math.min(block.end, contentEnd) } : block;
    if (range.start < 0 || range.end < range.start || range.end > markdown.length) throw new Error("Markdown serializer emitted an invalid source range.");
    return range;
  });
  return {
    doc: editor.state.doc, markdown, nodeSnapshots, blocks: assigned,
    gaps: collectMarkdownSourceGaps(markdown, assigned),
    blockSources: sourceSpellings(markdown, editor, origins.map(origin => origin === null ? undefined : previous.blockSources[origin]), nodeSnapshots, assigned),
  };
}
