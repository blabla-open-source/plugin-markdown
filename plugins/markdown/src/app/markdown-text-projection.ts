import type { SourceFrame } from "marked";
import type { MarkdownInputSegment } from "./markdown-input-projection";

type Replacement = { from: number; to: number; text: string };

/** Decoder callbacks address successive strings. Consecutive forward edits
 * form a batch; the four ordered entity passes need at most four batches. */
export function decodedMarkdownInput(
	frame: SourceFrame,
	inputLength: number,
	replacements: readonly Replacement[],
): MarkdownInputSegment[] {
	let segments: MarkdownInputSegment[] = [
		{ from: 0, to: inputLength, frame, parentFrom: 0, parentTo: inputLength },
	];
	let length = inputLength;
	let batch: Replacement[] = [],
		delta = 0,
		previousEnd = -1;
	const flush = () => {
		if (!batch.length) return;
		segments = replaceBatch(segments, length, batch);
		length += delta;
		batch = [];
		delta = 0;
		previousEnd = -1;
	};
	for (const replacement of replacements) {
		if (replacement.from < previousEnd) flush();
		batch.push({
			...replacement,
			from: replacement.from - delta,
			to: replacement.to - delta,
		});
		delta += replacement.text.length - (replacement.to - replacement.from);
		previousEnd = replacement.from + replacement.text.length;
	}
	flush();
	return segments;
}

function replaceBatch(
	segments: readonly MarkdownInputSegment[],
	length: number,
	replacements: readonly Replacement[],
): MarkdownInputSegment[] {
	const result: MarkdownInputSegment[] = [];
	let cursor = 0,
		index = 0,
		delta = 0;
	const take = (to: number) => {
		if (to < cursor || to > length)
			throw new Error("Decoder replacement is outside its input.");
		const pieces: MarkdownInputSegment[] = [];
		while (cursor < to) {
			const segment = segments[index];
			if (!segment || segment.from > cursor)
				throw new Error("Decoder input has a gap.");
			const end = Math.min(segment.to, to);
			if (
				segment.transformed &&
				(cursor !== segment.from || end !== segment.to)
			)
				throw new Error("Decoder replacement splits an atomic input.");
			pieces.push({
				...segment,
				from: cursor,
				to: end,
				parentFrom: segment.transformed
					? segment.parentFrom
					: segment.parentFrom + cursor - segment.from,
				parentTo: segment.transformed
					? segment.parentTo
					: segment.parentFrom + end - segment.from,
			});
			cursor = end;
			if (end === segment.to) index++;
		}
		return pieces;
	};
	for (const replacement of replacements) {
		for (const segment of take(replacement.from))
			result.push({
				...segment,
				from: segment.from + delta,
				to: segment.to + delta,
			});
		const consumed = take(replacement.to);
		const first = consumed[0],
			last = consumed.at(-1);
		if (
			!first ||
			!last ||
			consumed.some((segment) => segment.frame !== first.frame)
		)
			throw new Error("Decoder replacement has no single input owner.");
		const from = replacement.from + delta;
		result.push({
			from,
			to: from + replacement.text.length,
			frame: first.frame,
			parentFrom: first.parentFrom,
			parentTo: last.parentTo,
			transformed: true,
		});
		delta += replacement.text.length - (replacement.to - replacement.from);
	}
	for (const segment of take(length))
		result.push({
			...segment,
			from: segment.from + delta,
			to: segment.to + delta,
		});
	return result;
}

export interface MarkdownCharacterSegment {
	from: number;
	to: number;
	sourceFrom: number;
	sourceTo: number;
	atomic?: true;
}

/** CRLF introduces a coordinate discontinuity, not a whole-run replacement. */
export function originalMarkdownTextSegments(
	segments: readonly MarkdownInputSegment[],
	contentFrom: number,
	sourceFrom: number,
	offset: (position: number) => number,
	breaks: readonly number[],
): MarkdownCharacterSegment[] {
	const result: MarkdownCharacterSegment[] = [];
	const append = (
		from: number,
		to: number,
		start: number,
		end: number,
		atomic = false,
	) => {
		if (from === to) return;
		const point: MarkdownCharacterSegment = {
			from: contentFrom + from,
			to: contentFrom + to,
			sourceFrom: offset(start) - sourceFrom,
			sourceTo: offset(end) - sourceFrom,
			...(atomic ? { atomic: true as const } : {}),
		};
		const previous = result.at(-1);
		if (previous && previous.sourceTo === point.sourceFrom) {
			if (!previous.atomic && !point.atomic && previous.to === point.from) {
				previous.to = point.to;
				previous.sourceTo = point.sourceTo;
				return;
			}
			// One replacement can consume multiple adjacent producer ranges.
			if (
				previous.atomic &&
				point.atomic &&
				previous.from === point.from &&
				previous.to === point.to
			) {
				previous.sourceTo = point.sourceTo;
				return;
			}
		}
		result.push(point);
	};
	for (const segment of segments) {
		if (segment.transformed) {
			append(
				segment.from,
				segment.to,
				segment.parentFrom,
				segment.parentTo,
				true,
			);
			continue;
		}
		if (segment.to - segment.from !== segment.parentTo - segment.parentFrom)
			throw new Error("Copy projection changed its coordinate length.");
		let low = 0,
			high = breaks.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (breaks[middle]! < segment.parentFrom) low = middle + 1;
			else high = middle;
		}
		let cursor = segment.parentFrom;
		for (
			let index = low;
			index < breaks.length && breaks[index]! < segment.parentTo;
			index++
		) {
			const newline = breaks[index]!;
			append(
				segment.from + cursor - segment.parentFrom,
				segment.from + newline - segment.parentFrom,
				cursor,
				newline,
			);
			append(
				segment.from + newline - segment.parentFrom,
				segment.from + newline + 1 - segment.parentFrom,
				newline,
				newline + 1,
				true,
			);
			cursor = newline + 1;
		}
		append(
			segment.from + cursor - segment.parentFrom,
			segment.to,
			cursor,
			segment.parentTo,
		);
	}
	return result;
}
