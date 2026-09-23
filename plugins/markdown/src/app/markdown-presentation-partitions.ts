import { captureParsedMarkdownInlineSource, type MarkdownInlineSource } from "./markdown-inline-source";
import { serializeNodeSnapshot } from "./markdown-source-editor-snapshot";
import type { Node } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import { normalizedOffsets, markdownParsedBlockRange, type MarkdownParsedSource } from "./markdown-parse-source";
import type { MarkdownSourceBlock } from "./markdown-source-blocks";

const partitionKey = "markdownPresentationPartitions";
type Partition = { step: number; from: number; to: number; size: number; source: string; blocks: MarkdownSourceBlock[]; spellings: Array<{ semantic: string; inline?: MarkdownInlineSource }> };

/** Retain document nodes and numeric coordinates; never parse tokens or frames. */
export function recordMarkdownPresentationPartition(tr: Transaction, from: number, to: number, size: number, parsed: MarkdownParsedSource) {
 const blocks = parsed.blocks.map((block, index) => {
  if (block.fromNode !== index || block.toNode !== index + 1) throw new Error("Presentation parser produced an unsplit source group.");
  return markdownParsedBlockRange(parsed.source, block);
 });
 if (!blocks.length && size === 2) blocks.push({start: 0, end: 0, synthetic: true});
 let position = from;
 const spellings = blocks.map((_block, index) => {
  const node = tr.doc.nodeAt(position);
  if (!node) throw new Error("Presentation partition has no produced node.");
  position += node.nodeSize;
  return { semantic: serializeNodeSnapshot(node), inline: captureParsedMarkdownInlineSource(node, parsed.blocks[index]?.inline ?? []) };
 });
 const previous: Partition[] = tr.getMeta(partitionKey) ?? [];
 tr.setMeta(partitionKey, [...previous, {step: tr.steps.length - 1, from, to, size, source: parsed.source, blocks, spellings}]);
}

function topIndex(doc: Node, position: number): number | undefined {
 if (position < 0 || position > doc.content.size) return;
 const resolved = doc.resolve(position);
 return resolved.depth === 0 ? resolved.index(0) : undefined;
}

/** Map actual replacement boundaries through the surrounding transactions. */
export function markdownPresentationPartitions(transactions: readonly Transaction[], before: Node, after: Node) {
 const maps = transactions.flatMap(tr => tr.mapping.maps);
 const result: Array<{previousStart: number; previousEnd: number; currentStart: number; currentEnd: number; source: string; blocks: MarkdownSourceBlock[]; spellings: Partition["spellings"]}> = [];
 let offset = 0;
 for (const tr of transactions) {
  const partitions: Partition[] = tr.getMeta(partitionKey) ?? [];
  for (const partition of partitions) {
   const index = offset + partition.step;
   const inverse = new Mapping(maps.slice(0, index)).invert();
   const following = new Mapping(maps.slice(index + 1));
   const from = following.mapResult(partition.from, 1);
   const to = following.mapResult(partition.from + partition.size, -1);
   if (from.deletedAcross || to.deletedAcross) continue;
   const previousStart = topIndex(before, inverse.map(partition.from, -1));
   const previousEnd = topIndex(before, inverse.map(partition.to, 1));
   const currentStart = topIndex(after, from.pos), currentEnd = topIndex(after, to.pos);
   // Nested replacements retain their outer block; a later replacement may
   // supersede this partition. Only surviving top-level partitions assign spans.
   if (previousStart === undefined || previousEnd === undefined || currentStart === undefined || currentEnd === undefined || currentEnd - currentStart !== partition.blocks.length) continue;
   result.push({previousStart, previousEnd, currentStart, currentEnd, source: partition.source, blocks: partition.blocks, spellings: partition.spellings});
  }
  offset += tr.steps.length;
 }
 return result;
}

/** The editor may use LF while the same source version retains CRLF bytes. */
function presentationSourceProjection(source: string, parsedSource: string) {
 if (source.replace(/\r\n?/g, "\n") !== parsedSource.replace(/\r\n?/g, "\n")) throw new Error("Presentation partition does not describe its source version.");
 const input = normalizedOffsets(parsedSource);
 const inputPositions = input && new Map(input.map((offset, index) => [offset, index]));
 const original = normalizedOffsets(source);
 const project = (offset: number) => {
  const normalized = inputPositions ? inputPositions.get(offset) : offset;
  if (normalized === undefined) throw new Error("Presentation boundary splits a line ending.");
  const result = original ? original[normalized] : normalized;
  if (result === undefined || result > source.length) throw new Error("Presentation boundary is outside its source.");
  return result;
 };
 return project;
}

/** Project all coordinates through the same verified line-ending transform. */
export function presentationSourceRecords(source: string, parsedSource: string, blocks: readonly MarkdownSourceBlock[], spellings: Partition["spellings"]) {
 const project = presentationSourceProjection(source, parsedSource);
 return blocks.map((block, index) => {
  const start = project(block.start), end = project(block.end);
  const spelling = spellings[index];
  if (!spelling) throw new Error("Presentation partition has no source spelling.");
  const inline = spelling.inline;
  const offset = (position: number) => project(block.start + position) - start;
  return {
   block: {...block, start, end},
   spelling: {
    semantic: spelling.semantic, source: source.slice(start, end),
    inline: inline && {
     node: inline.node,
     boundaries: inline.boundaries.map(point => ({...point, source: offset(point.source)})),
     characters: inline.characters.map(segment => ({...segment, sourceFrom: offset(segment.sourceFrom), sourceTo: offset(segment.sourceTo)})),
    },
   },
  };
 });
}
