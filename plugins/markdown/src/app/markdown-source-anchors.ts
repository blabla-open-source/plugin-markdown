/** Origins are unique identities carried by actual transactions. Their longest
 * increasing subsequence is the old source-order LCS, without its quadratic
 * table. Choose the earliest current node on ties, as the old traversal did.
 */
export function markdownSourceAnchors(
	previous: readonly string[],
	current: readonly string[],
	origins: readonly (number | null)[],
): Array<{ currentIndex: number; previousIndex: number }> {
	const candidates = current.flatMap((snapshot, currentIndex) => {
		const origin = origins[currentIndex];
		return origin !== null && origin !== undefined && previous[origin] === snapshot
			? [{ currentIndex, previousIndex: origin }] : [];
	});
	const lengths = new Uint32Array(candidates.length);
	const maxima = new Uint32Array(previous.length + 1);
	let remaining = 0;
	for (let index = candidates.length - 1; index >= 0; index--) {
		const rank = previous.length - candidates[index]!.previousIndex;
		let length = 1;
		for (let cursor = rank - 1; cursor > 0; cursor -= cursor & -cursor) {
			length = Math.max(length, maxima[cursor]! + 1);
		}
		lengths[index] = length;
		remaining = Math.max(remaining, length);
		for (let cursor = rank; cursor < maxima.length; cursor += cursor & -cursor) {
			maxima[cursor] = Math.max(maxima[cursor]!, length);
		}
	}
	const anchors: Array<{ currentIndex: number; previousIndex: number }> = [];
	let previousIndex = -1;
	for (const [index, candidate] of candidates.entries()) {
		if (candidate.previousIndex <= previousIndex || lengths[index]! < remaining) continue;
		anchors.push(candidate);
		previousIndex = candidate.previousIndex;
		remaining--;
	}
	return anchors;
}

export interface MarkdownSourceChange {
	previousStart: number;
	previousEnd: number;
	currentStart: number;
	currentEnd: number;
}

export function markdownSourceChanges(previous: readonly string[], current: readonly string[], origins: readonly (number | null)[]): MarkdownSourceChange[] {
	const changes: MarkdownSourceChange[] = [];
	let previousStart = 0;
	let currentStart = 0;
	for (const anchor of [...markdownSourceAnchors(previous, current, origins), { previousIndex: previous.length, currentIndex: current.length }]) {
		if (previousStart !== anchor.previousIndex || currentStart !== anchor.currentIndex) {
			changes.push({ previousStart, previousEnd: anchor.previousIndex, currentStart, currentEnd: anchor.currentIndex });
		}
		previousStart = anchor.previousIndex + 1;
		currentStart = anchor.currentIndex + 1;
	}
	return changes;
}
