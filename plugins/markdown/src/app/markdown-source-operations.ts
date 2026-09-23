import type { Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";

const boundaryKey = "markdownSourceBoundaries";
type SourceBoundary = { position: number; afterStep: number; lineBreaks: 1 | 2 };

/** A structural operation explicitly creates a sibling boundary within a list. */
export function recordMarkdownListBoundary(tr: Transaction, position: number, lineBreaks: 1 | 2 = 1) {
	const previous: SourceBoundary[] = tr.getMeta(boundaryKey) ?? [];
	tr.setMeta(boundaryKey, [
		...previous,
		{ position, afterStep: tr.steps.length, lineBreaks },
	]);
}

export function markdownListBoundaries(
	transactions: readonly Transaction[],
): Map<number, number> {
	const positions = new Map<number, number>();
	for (const [index, tr] of transactions.entries()) {
		const boundaries: SourceBoundary[] = tr.getMeta(boundaryKey) ?? [];
		for (const boundary of boundaries) {
			const mapping = new Mapping(tr.mapping.maps.slice(boundary.afterStep));
			for (const later of transactions.slice(index + 1))
				mapping.appendMapping(later.mapping);
			const mapped = mapping.mapResult(boundary.position, 1);
			if (!mapped.deletedAcross) positions.set(mapped.pos, boundary.lineBreaks);
		}
	}
	return positions;
}

const presentationKey = "markdownSourcePresentation";
/** Source identity and native history participation are separate contracts. */
export function markMarkdownSourcePreserving(tr: Transaction): Transaction {
	return tr.setMeta(presentationKey, true);
}

export function markMarkdownPresentation(tr: Transaction): Transaction {
	return markMarkdownSourcePreserving(tr).setMeta("addToHistory", false);
}
export function isMarkdownPresentation(tr: Transaction): boolean {
	return tr.getMeta(presentationKey) === true;
}
