import type { MarkdownCharacterSegment } from "./markdown-text-projection";

/** A decoded entity has exact endpoints, but no invented interior position. */
export function markdownCharacterSourcePosition(segments: readonly MarkdownCharacterSegment[], position: number, bias: -1 | 1 = -1): number | null {
	let endpoint: number | null = null;
	for (const segment of segments) {
		if (position < segment.from) break;
		if (position > segment.to) continue;
		if (position === segment.from) return segment.sourceFrom;
		if (position === segment.to) {
			if (bias < 0) return segment.sourceTo;
			endpoint = segment.sourceTo;
			continue;
		}
		if (!segment.atomic) return segment.sourceFrom + position - segment.from;
	}
	return endpoint;
}
