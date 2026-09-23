import type { MarkdownCharacterSegment } from "./markdown-text-projection";
import type { MarkdownInlineContribution } from "./markdown-parse-source";
import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";

export interface MarkdownInlineSource {
  node: Node;
  characters: readonly MarkdownCharacterSegment[];
  boundaries: readonly { source: number; content: number }[];
}

/** Index availability is independent of local patch serialization support. */
export function supportsMarkdownInlineSource(node: Node): boolean {
  return node.inlineContent ? node.content.size > 0 && !node.type.spec.code : node.children.some(supportsMarkdownInlineSource);
}

/** Syntax-unit endpoints come from the parse that produced this document. */
export function captureParsedMarkdownInlineSource(node: Node, contributions: readonly MarkdownInlineContribution[]): MarkdownInlineSource | undefined {
  if (!supportsMarkdownInlineSource(node)) return;
  const boundaries: Array<{ source: number; content: number }> = [];
  for (const run of contributions) {
    const first = run.source?.[0], last = run.source?.at(-1);
    if (!first || !last) continue;
    boundaries.push({ source: first.from, content: run.from }, { source: last.to, content: run.to });
  }
  boundaries.sort((a, b) => a.source - b.source || a.content - b.content);
  const characters = contributions.flatMap(run => (run.text ?? []).flatMap(text => text.mapping ?? [])).sort((a, b) => a.from - b.from);
  return { node, characters, boundaries: boundaries.filter((point, index) => {
    const previous = boundaries[index - 1];
    return !previous || point.source !== previous.source || point.content !== previous.content;
  }) };
}

/** Rebuild the touched syntactic interval, retaining source outside its proven
 * boundaries. Structural changes belong to the block serializer. */
export function patchMarkdownInlineSource(editor: Editor, source: string, origin: MarkdownInlineSource | undefined, node: Node): string | null {
	const markdown = editor.markdown;
	// Reading provenance also supports containers whose local serializer needs
	// context (for example quote prefixes). Their edits use the block serializer.
	if (!["paragraph", "bulletList", "orderedList", "taskList"].includes(node.type.name)) return null;
	if (!origin || !markdown || !origin.node.sameMarkup(node)) return null;
	const start = origin.node.content.findDiffStart(node.content);
	const end = origin.node.content.findDiffEnd(node.content);
	if (start === null || end === null) return source;
	const overlap = Math.max(0, start - Math.min(end.a, end.b));
	const parent = origin.node.resolve(start);
	if (!parent.parent.isTextblock || end.a + overlap > parent.end()) return null;
	const points = origin.boundaries.filter(point => point.content >= parent.start() && point.content <= parent.end());
	const insertion = start === end.a + overlap;
  const matches = (result: string) => {
    const parsed = editor.state.schema.nodeFromJSON(markdown.parse(result));
    return parsed.childCount === 1 && parsed.firstChild?.eq(node);
  };
  if (insertion) {
    const current = node.resolve(start);
    if (current.parent.isTextblock && end.b + overlap <= current.end()) {
      const content = current.parent.content.cut(start - current.start(), end.b + overlap - current.start());
      const raw = content.content.every(part => part.isText && !part.marks.length) ? content.textBetween(0, content.size) : null;
      const serialized = markdown.serialize({ type: "doc", content: [current.parent.copy(content).toJSON()] });
      const lineBreak = source.match(/\r\n|\n|\r/)?.[0] ?? "\n";
      for (const point of points.filter(point => point.content === start).reverse()) {
        for (const value of raw === null ? [] : [raw, serialized]) {
          const result = source.slice(0, point.source) + value.replace(/\r\n|\n|\r/g, lineBreak) + source.slice(point.source);
          if (matches(result)) return result;
        }
      }
    }
  }
	const startBoundary = points.findLast(point => point.content <= start && (!insertion || start === parent.start() || point.content < start));
	const endBoundary = points.find(point => point.content >= end.a + overlap && (!insertion || start !== parent.start() || point.content > parent.start()));
  // Coincident text positions may straddle HTML delimiters. Rebuilding a
  // marked run owns its enclosing delimiters, avoiding duplicate wrappers.
  const before = startBoundary && points.find(point => point.content === startBoundary.content);
  const after = endBoundary && points.findLast(point => point.content === endBoundary.content);
	if (!before || !after) return null;
	const newEnd = after.content + end.b - end.a;
	const current = node.resolve(before.content);
	if (!current.parent.isTextblock || newEnd > current.end()) return null;
	const content = current.parent.content.cut(before.content - current.start(), newEnd - current.start());
	const lineBreak = source.match(/\r\n|\n|\r/)?.[0] ?? "\n";
	const replacement = markdown.serialize({ type: "doc", content: [current.parent.copy(content).toJSON()] }).replace(/\r\n|\n|\r/g, lineBreak);
	const result = source.slice(0, before.source) + replacement + source.slice(after.source);
	return matches(result) ? result : null;
}
