import type { Node } from "@tiptap/pm/model";
import type { MarkdownParsedSource } from "./markdown-parse-source";

/** Source-only syntax lands on the boundary of its producing inline run. */
export function markdownParsedSourcePoint(parsed: MarkdownParsedSource, doc: Node, position: number, bias: -1 | 1 = -1): number {
	if (position < 0 || position > parsed.source.length) throw new Error("Source caret is outside parser input.");
	const bases: number[] = [];
	doc.forEach((_node, offset) => { bases.push(offset + 1); });
	const block = parsed.blocks.reduce<(typeof parsed.blocks)[number] | undefined>((nearest, block) => {
		const distance = (range: typeof block) => Math.max(range.start - position, position - range.end, 0);
		return !nearest || distance(block) < distance(nearest) || (bias > 0 && distance(block) === distance(nearest)) ? block : nearest;
	}, undefined);
	if (!block) return 0;
	const point = position - block.start;
	const enclosing = block.inline.filter(run => run.source?.some(range => range.from <= point && point <= range.to));
	const runs = enclosing.length ? enclosing : block.inline;
	const candidates: Array<{ source: number; content: number; distance: number }> = [];
	const add = (source: number, content: number) => candidates.push({ source, content, distance: Math.abs(source - point) });
	for (const run of runs) {
		const base = bases[run.nodeIndex];
		if (base === undefined) throw new Error("Source caret has no producing node.");
		for (const text of run.text ?? []) for (const part of text.mapping ?? []) {
			if (!part.atomic && part.sourceFrom <= point && point <= part.sourceTo)
				return base + part.from + point - part.sourceFrom;
			add(part.sourceFrom, base + part.from);
			add(part.sourceTo, base + part.to);
		}
		const first = run.source?.[0], last = run.source?.at(-1);
		if (first) add(first.from, base + run.from);
		if (last) add(last.to, base + run.to);
	}
	candidates.sort((a, b) => a.distance - b.distance || a.source - b.source);
	return candidates[0]?.content ?? bases[block.fromNode] ?? 0;
}

/** Attribute spelling may differ; every model position must still correspond. */
export function assertMarkdownCaretStructure(left: Node, right: Node): void {
	if (left.type !== right.type || left.text !== right.text || left.childCount !== right.childCount)
		throw new Error("Authored and serialized source have different caret structures.");
	left.forEach((node, _offset, index) => { assertMarkdownCaretStructure(node, right.child(index)); });
}
