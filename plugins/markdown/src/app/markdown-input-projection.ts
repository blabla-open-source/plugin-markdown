import type { SourceFrame } from "marked";

/** A producer describes one copy or atomic replacement in its output input. */
export interface MarkdownInputSegment {
	from: number;
	to: number;
	frame: SourceFrame;
	parentFrom: number;
	parentTo: number;
	transformed?: true;
}

export interface MarkdownInputRange {
	frame: SourceFrame;
	from: number;
	to: number;
	transformed?: true;
}

/** Producer segments are ordered by output; retain both sides of an endpoint. */
function firstInputSegment(segments: readonly MarkdownInputSegment[], position: number): number {
	let low = 0, high = segments.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (segments[middle]!.to < position) low = middle + 1;
		else high = middle;
	}
	return low;
}

export function sliceMarkdownInput(segments: readonly MarkdownInputSegment[], from: number, to: number): MarkdownInputSegment[] {
	const result: MarkdownInputSegment[] = [];
	for (let index = firstInputSegment(segments, from); index < segments.length; index++) {
		const segment = segments[index]!;
		if (segment.from >= to) break;
		const start = Math.max(from, segment.from);
		const end = Math.min(to, segment.to);
		if (start >= end) continue;
		const copy = !segment.transformed && segment.to - segment.from === segment.parentTo - segment.parentFrom;
		result.push({
			...segment, from: start - from, to: end - from,
			parentFrom: copy ? segment.parentFrom + start - segment.from : segment.parentFrom,
			parentTo: copy ? segment.parentFrom + end - segment.from : segment.parentTo,
			...(!copy ? { transformed: true as const } : {}),
		});
	}
	return result;
}

/** A gap or a partial atomic replacement has no exact source interval. */
export function projectMarkdownInput(range: MarkdownInputRange, segments: readonly MarkdownInputSegment[]): MarkdownInputRange[] | null {
	if (range.from === range.to) {
		const points: MarkdownInputRange[] = [];
		for (let index = firstInputSegment(segments, range.from); index < segments.length; index++) {
			const segment = segments[index]!;
			if (segment.from > range.to) break;
			if (range.from < segment.from || range.from > segment.to) continue;
			const copy = !segment.transformed && segment.to - segment.from === segment.parentTo - segment.parentFrom;
			const position = copy ? segment.parentFrom + range.from - segment.from
				: range.from === segment.from ? segment.parentFrom : range.from === segment.to ? segment.parentTo : undefined;
			if (position === undefined) return null;
			points.push({ frame: segment.frame, from: position, to: position, ...(!copy || range.transformed ? { transformed: true as const } : {}) });
		}
		const first = points[0];
		return first && points.every(point => point.frame === first.frame && point.from === first.from) ? [first] : null;
	}
	const result: MarkdownInputRange[] = [];
	let cursor = range.from;
	for (let index = firstInputSegment(segments, range.from); index < segments.length; index++) {
		const segment = segments[index]!;
		if (segment.to < cursor || (segment.to === cursor && cursor < range.to)) continue;
		if (segment.from > cursor) return null;
		const end = Math.min(range.to, segment.to);
		const copy = !segment.transformed && segment.to - segment.from === segment.parentTo - segment.parentFrom;
		if (!copy && (cursor !== segment.from || end !== segment.to)) return null;
		result.push({
			frame: segment.frame,
			from: copy ? segment.parentFrom + cursor - segment.from : segment.parentFrom,
			to: copy ? segment.parentFrom + end - segment.from : segment.parentTo,
			...(!copy || range.transformed ? { transformed: true as const } : {}),
		});
		cursor = end;
		if (cursor === range.to) return result;
	}
	return null;
}
