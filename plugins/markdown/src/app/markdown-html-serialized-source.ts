import type { MarkdownInputSegment } from "./markdown-input-projection";
import type { HTMLSerializationRecord } from "./markdown-html-serialization";
import type { createMarkdownHTMLDOM } from "./markdown-html-dom";
import type { HTMLSerialization } from "./markdown-html-serialization";
import { serializedHTMLField, unwrapHTMLSource, htmlFieldSegments, type HTMLFieldInput } from "./markdown-html-serialized-fields";
import { serializedHTMLSyntax } from "./markdown-html-serialized-syntax";
import type { MarkdownCharacterSegment } from "./markdown-text-projection";

export function serializedHTMLSource(source: string, html: ReturnType<typeof createMarkdownHTMLDOM>, serialization: HTMLSerialization): MarkdownCharacterSegment[] {
	const wrapped = `<body>${source}</body>`;
	const result: MarkdownCharacterSegment[] = [];
	const inputs = new WeakMap<object, MarkdownInputSegment[]>();
	const field = (record: HTMLSerializationRecord, owner: object, pieces: readonly HTMLFieldInput[], offset = 0) => {
		let segments = inputs.get(owner);
		if (!segments) {
			segments = htmlFieldSegments(pieces, {source: wrapped, tokens: []});
			inputs.set(owner, segments);
		}
		return serializedHTMLField(record, segments, offset);
	};
	const append = (part: MarkdownCharacterSegment) => {
		const last = result.at(-1);
		if (last?.atomic && part.atomic && last.to === part.from && last.sourceFrom === part.sourceFrom && last.sourceTo === part.sourceTo) last.to = part.to;
		else result.push(part);
	};
	for (const record of serialization.records) {
		if (record.from === record.to) continue;
		let parts: MarkdownCharacterSegment[];
		if (record.kind === "text") {
			const input = html.inputs.get(record.node as Text);
			if (!input || record.input !== input.tree.value.slice(input.from, input.to)) throw new Error("Serialized text lacks its producing input.");
			parts = field(record, input.tree, html.records.get(input.tree)!, input.from);
		} else if (record.kind === "attribute") {
			const input = html.attributes.get(record.attribute!);
			if (!input || input.value !== record.input) throw new Error("Serialized attribute lacks its producing input.");
			parts = field(record, input, input.sourceValue!);
		} else if (record.kind === "comment") {
			const input = html.comments.get(record.node as Comment);
			if (!input || input.data !== record.input) throw new Error("Serialized comment lacks its producing input.");
			parts = field(record, input, input.sourceData!);
		} else {
			const range = serializedHTMLSyntax(record, html);
			if (range.from < 0 || range.to < range.from || range.to > wrapped.length) throw new Error("Serialized syntax is outside its producing input.");
			parts = [{from: record.from, to: record.to, sourceFrom: range.from, sourceTo: range.to, ...(wrapped.slice(range.from, range.to) !== record.output ? {atomic: true as const} : {})}];
		}
		for (const part of parts) append(part);
	}
	let cursor = 0;
	for (const part of result) {
		if (part.from !== cursor) throw new Error("Serialized source has an uncovered output interval.");
		cursor = part.to;
	}
	if (cursor !== serialization.text.length) throw new Error("Serialized source has an uncovered output tail.");
	return unwrapHTMLSource(result, source.length);
}
