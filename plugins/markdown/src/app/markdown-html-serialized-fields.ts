import type { Token } from "parse5";
import type { SourceFrame } from "marked";
import { decodedMarkdownInput, type MarkdownCharacterSegment } from "./markdown-text-projection";
import { sliceMarkdownInput, type MarkdownInputSegment } from "./markdown-input-projection";
import type { HTMLSerializationRecord } from "./markdown-html-serialization";

export interface HTMLFieldInput {from: number; to: number; range: Token.SourceTextRange}

/** Build each producing field once, even when DOM text is split into chunks. */
export function htmlFieldSegments(input: readonly HTMLFieldInput[], frame: SourceFrame): MarkdownInputSegment[] {
	const parents: MarkdownInputSegment[] = [];
	for (const piece of input) {
		const next: MarkdownInputSegment = {from: piece.from, to: piece.to, frame, parentFrom: piece.range.from, parentTo: piece.range.to, ...(piece.range.transformed ? {transformed: true} : {})};
		const last = parents.at(-1);
		if (last?.transformed && next.transformed && last.to === next.from && last.parentFrom === next.parentFrom && last.parentTo === next.parentTo) last.to = next.to;
		else parents.push(next);
	}
	return parents;
}

/** Join aliases of one decoded entity before exposing any exact endpoints. */
export function serializedHTMLField(record: HTMLSerializationRecord, parents: readonly MarkdownInputSegment[], inputFrom = 0): MarkdownCharacterSegment[] {
	const frame: SourceFrame = {source: record.input!, tokens: []};
	const result: MarkdownCharacterSegment[] = [];
	for (const segment of decodedMarkdownInput(frame, record.input!.length, record.replacements ?? [])) {
		for (const part of sliceMarkdownInput(parents, inputFrom + segment.parentFrom, inputFrom + segment.parentTo)) {
			const next: MarkdownCharacterSegment = {
				from: record.from + segment.from + (segment.transformed ? 0 : part.from),
				to: record.from + (segment.transformed ? segment.to : segment.from + part.to),
				sourceFrom: part.parentFrom, sourceTo: part.parentTo,
				...(segment.transformed || part.transformed ? {atomic: true} : {}),
			};
			const last = result.at(-1);
			if (last?.atomic && next.atomic && last.to === next.from && last.sourceFrom === next.sourceFrom && last.sourceTo === next.sourceTo) last.to = next.to;
			else result.push(next);
		}
	}
	return result;
}

/** The wrapper copies user input between two explicitly generated strings. */
export function unwrapHTMLSource(parts: readonly MarkdownCharacterSegment[], length: number): MarkdownCharacterSegment[] {
	const start = 6, end = start + length;
	const boundaries = [...new Set([start, end])];
	const point = (position: number) => position <= start ? 0 : position >= end ? length : position - start;
	return parts.flatMap(part => {
		if (part.atomic) return [{...part, sourceFrom: point(part.sourceFrom), sourceTo: point(part.sourceTo)}];
		const stops = [part.sourceFrom, ...boundaries.filter(at => at > part.sourceFrom && at < part.sourceTo), part.sourceTo];
		return stops.slice(1).map((to, index) => {
			const from = stops[index]!;
			return {...part, from: part.from + from - part.sourceFrom, to: part.from + to - part.sourceFrom, sourceFrom: point(from), sourceTo: point(to), ...(to <= start || from >= end ? {atomic: true as const} : {})};
		});
	});
}
