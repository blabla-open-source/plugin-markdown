import type { JSONContent } from "@tiptap/core";
import type { Schema, Node } from "@tiptap/pm/model";
import type { SourceFrame } from "marked";
import { serializedHTMLSource } from "./markdown-html-serialized-source";
import { createMarkdownHTMLDOM } from "./markdown-html-dom";
import { parseMarkdownDOM, type DOMTextOutput } from "./markdown-dom-source";
import { MarkdownLexicalSource } from "./markdown-lexical-source";
import { sliceMarkdownInput, type MarkdownInputSegment } from "./markdown-input-projection";
import { decodedMarkdownInput, originalMarkdownTextSegments, type MarkdownCharacterSegment } from "./markdown-text-projection";

/** Schema-generated text has an owner, but does not claim character copies. */
export interface HTMLGeneratedRange {from: number; to: number; input: {from: number; to: number} | null}
export interface HTMLTextOutput {node: JSONContent; mapping: MarkdownCharacterSegment[]; generated: HTMLGeneratedRange[]}

/** One HTML parse produces both schema JSON and original HTML character ranges. */
export function parseMarkdownHTMLSource(source: string, schema: Schema) {
	const html = createMarkdownHTMLDOM(source);
	const {node, mapping} = parseMarkdownDOM(schema, html.dom);
	const projected = composeHTMLSource(source, html, mapping);
	for (const part of mapping) {
		if ("input" in part.source) continue;
		if (!part.source.serialization) throw new Error("Generated HTML content lacks its producing serialization.");
		for (const range of serializedHTMLSource(source, html, part.source.serialization)) projected.push({...range, from: part.from + range.from, to: part.from + range.to});
	}
	projected.sort((a, b) => a.from - b.from);
	const generated = mapping.flatMap(part => {
		if ("input" in part.source) return [];
		const location = html.elements.get(part.source.dom)?.sourceCodeLocation;
		const input = location && location.startOffset >= 6 && location.endOffset <= source.length + 6
			? {from: location.startOffset - 6, to: location.endOffset - 6} : null;
		return [{from: part.from, to: part.to, input}];
	});
	const doc: JSONContent = node.toJSON();
	const root = node;
	const text: HTMLTextOutput[] = [];
	let cursor = 0;
	let generatedCursor = 0;
	const visit = (node: Node, json: JSONContent, from: number) => {
		if (node.isText) {
			const to = from + node.nodeSize, ranges: MarkdownCharacterSegment[] = [];
			while (cursor < projected.length && projected[cursor]!.to <= from) cursor++;
			for (let index = cursor; index < projected.length && projected[index]!.from < to; index++) {
				const part = projected[index]!, start = Math.max(from, part.from), end = Math.min(to, part.to);
				if (part.atomic && (start !== part.from || end !== part.to)) throw new Error("HTML entity output crosses incompatible text nodes.");
				ranges.push({...part, from: start - from, to: end - from, sourceFrom: part.sourceFrom + (part.atomic ? 0 : start - part.from), sourceTo: part.sourceTo - (part.atomic ? 0 : part.to - end)});
			}
			while (generatedCursor < generated.length && generated[generatedCursor]!.to <= from) generatedCursor++;
			const produced: HTMLGeneratedRange[] = [];
			for (let index = generatedCursor; index < generated.length && generated[index]!.from < to; index++) {
				const part = generated[index]!;
				produced.push({...part, from: Math.max(from, part.from) - from, to: Math.min(to, part.to) - from});
			}
			text.push({node: json, mapping: ranges, generated: produced});
			return;
		}
		node.forEach((child, offset, index) => {
			visit(child, json.content![index]!, from + offset + (node === root ? 0 : 1));
		});
	};
	visit(node, doc, 0);
	return {doc, text};
}

function composeHTMLSource(source: string, html: ReturnType<typeof createMarkdownHTMLDOM>, mapping: DOMTextOutput[]) {
	const lexical = new MarkdownLexicalSource(), root: SourceFrame = {source, tokens: []};
	const wrapped: SourceFrame = {source: `<body>${source}</body>`, tokens: []};
	const register = (frame: SourceFrame, parent: SourceFrame, segments: Omit<MarkdownInputSegment, "frame">[]) => {
		lexical.observe({kind: "mappedInput", frame: parent, tokens: frame.tokens, segments});
		lexical.observe({kind: "frame", frame});
		return frame;
	};
	register(wrapped, root, [{from: 6, to: 6 + source.length, parentFrom: 0, parentTo: source.length}]);
	const trees = new WeakMap<object, SourceFrame>();
	const pending: MarkdownInputSegment[] = [];
	for (const part of mapping) {
		if (!("input" in part.source)) continue;
		const input = html.inputs.get(part.source.dom);
		if (!input) throw new Error("DOM output lacks its HTML construction input.");
		let parent = trees.get(input.tree);
		if (!parent) {
			const segments: Omit<MarkdownInputSegment, "frame">[] = [];
			for (const record of html.records.get(input.tree) ?? []) {
				const segment = {from: record.from, to: record.to, parentFrom: record.range.from, parentTo: record.range.to, ...(record.range.transformed ? {transformed: true as const} : {})};
				const previous = segments.at(-1);
				if (previous?.transformed && segment.transformed && previous.to === segment.from && previous.parentFrom === segment.parentFrom && previous.parentTo === segment.parentTo) previous.to = segment.to;
				else segments.push(segment);
			}
			parent = register({source: input.tree.value, tokens: []}, wrapped, segments);
			trees.set(input.tree, parent);
		}
		const value = input.tree.value.slice(input.from, input.to);
		if (value !== part.source.input) throw new Error("DOM text changed without its producing observation.");
		const frame: SourceFrame = {source: value, tokens: []};
		const decoded = decodedMarkdownInput(frame, value.length, part.source.replacements);
		const clipped = sliceMarkdownInput(decoded, part.source.from, part.type === "text" ? part.source.from + part.to - part.from : part.source.to);
		for (const segment of clipped) {
			const next = {...segment, from: part.from + segment.from, to: part.from + segment.to, frame: parent, parentFrom: input.from + segment.parentFrom, parentTo: input.from + segment.parentTo};
			if (part.type !== "text") { next.from = part.from; next.to = part.to; next.transformed = true; }
			const previous = pending.at(-1);
			if (previous && !previous.transformed && !next.transformed && previous.frame === next.frame && previous.to === next.from && previous.parentTo === next.parentFrom) {
				previous.to = next.to; previous.parentTo = next.parentTo;
			} else pending.push(next);
		}
	}
	const projected = lexical.projectSegments(pending);
	if (projected.some(segment => segment.frame !== root)) throw new Error("HTML text has an unrooted source interval.");
	return originalMarkdownTextSegments(projected, 0, 0, position => position, []);
}
