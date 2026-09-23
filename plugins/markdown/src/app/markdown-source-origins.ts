import type { Node } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { StepMap } from "@tiptap/pm/transform";

/** Node positions are ProseMirror positions; source ranges remain UTF-16 offsets. */
export function markdownSourceOrigins(
	before: Node,
	after: Node,
	transactions: readonly Transaction[],
): Array<number | null> {
	let document = before;
	let origins: Array<number | null> = positions(before).map(
		(_, index) => index,
	);
	// A removed node can be reinserted by a later step of the same operation.
	// This registry lives only for this transaction batch, never across history.
	const known = new Map<Node, Set<number>>();
	const prefixes = new Map<Node, Set<number>>();
	const contents = new Map<Node, Set<number>>();
	const remember = () =>
		document.forEach((node, _from, index) => {
			const origin = origins[index];
			if (origin === null || origin === undefined) return;
			const values = known.get(node) ?? new Set<number>();
			if (values.has(origin)) return;
			values.add(origin);
			known.set(node, values);
			const register = (registry: Map<Node, Set<number>>, child: Node) => {
				const owners = registry.get(child) ?? new Set<number>();
				owners.add(origin);
				registry.set(child, owners);
			};
			for (let child = node.firstChild; child; child = child.firstChild)
				register(prefixes, child);
			node.descendants((child) => {
				register(contents, child);
			});
		});
	for (const transaction of transactions) {
		if (!transaction.before.eq(document)) {
			throw new Error(
				"Markdown source transaction does not follow its source document.",
			);
		}
		for (const [index, step] of transaction.steps.entries()) {
			remember();
			const next = transaction.docs[index + 1] ?? transaction.doc;
			origins = advanceOrigins(
				document,
				next,
				origins,
				step.getMap(),
				known,
				prefixes,
				contents,
			);
			document = next;
		}
	}
	if (!document.eq(after)) {
		throw new Error(
			"Markdown source update is missing its document transactions.",
		);
	}
	return origins;
}

function advanceOrigins(
	before: Node,
	after: Node,
	prior: Array<number | null>,
	mapping: StepMap,
	known: Map<Node, Set<number>>,
	prefixes: Map<Node, Set<number>>,
	contents: Map<Node, Set<number>>,
) {
	const previous = positions(before);
	const current = positions(after);
	const currentByStart = new Map(current.map((entry, index) => [entry.from, index]));
	const origins = current.map((): number | null => null);
	const used = new Set<number>();
	// Boundary insertions belong outside a surviving block. Resolve these
	// ranges before matching shared node references from an inserted copy.
	for (const [oldIndex, entry] of previous.entries()) {
		const origin = prior[oldIndex];
		if (origin === null || origin === undefined) continue;
		const from = mapping.mapResult(entry.from, 1);
		const to = mapping.mapResult(entry.to, -1);
		if (from.deletedAcross || to.deletedAcross || from.pos >= to.pos) continue;
		const index = currentByStart.get(from.pos);
		if (index !== undefined && current[index]?.node === entry.node && current[index]?.to === to.pos) {
			origins[index] = origin;
			used.add(origin);
		}
	}
	// Surviving ranges take priority over copies that share the same Node object.
	for (const [oldIndex, entry] of previous.entries()) {
		const origin = prior[oldIndex];
		if (origin === null || origin === undefined || used.has(origin)) continue;
		const from = mapping.mapResult(entry.from, -1);
		const to = mapping.mapResult(entry.to, 1);
		if (from.deletedAcross || to.deletedAcross || from.pos === to.pos) continue;
		const index = currentByStart.get(from.pos);
		if (index !== undefined && origins[index] === null && current[index]?.to === to.pos) {
			origins[index] = origin;
			used.add(origin);
		}
	}
	// Splitting or joining inside a block retains its untouched opening
	// boundary. That leading fragment carries the original source identity.
	for (const [oldIndex, entry] of previous.entries()) {
		const origin = prior[oldIndex];
		if (origin === null || origin === undefined || used.has(origin)) continue;
		const from = mapping.mapResult(entry.from, 1);
		if (from.deletedAfter || from.deletedAcross) continue;
		const index = currentByStart.get(from.pos);
		if (index !== undefined && origins[index] === null) {
			origins[index] = origin;
			used.add(origin);
		}
	}
	// A container replacement can split/merge existing children without
	// preserving the container object. Its retained opening subtree anchors its
	// source; a remaining fragment may instead have one unambiguous contributor.
	// These are immutable identities from actual steps, not content comparisons.
	for (const [index, entry] of current.entries()) {
		if (origins[index] !== null) continue;
		const opening = new Set<number>();
		for (let child = entry.node.firstChild; child; child = child.firstChild)
			for (const origin of prefixes.get(child) ?? []) opening.add(origin);
		const contributors = new Set<number>();
		const retainedStarts = new Set<number>();
		entry.node.descendants((child) => {
			for (const origin of prefixes.get(child) ?? [])
				retainedStarts.add(origin);
			for (const origin of contents.get(child) ?? []) contributors.add(origin);
		});
		const candidates =
			opening.size === 1
				? opening
				: retainedStarts.size === 1
					? retainedStarts
					: contributors;
		const origin = candidates.size === 1 ? [...candidates][0] : undefined;
		if (origin === undefined || used.has(origin)) continue;
		origins[index] = origin;
		used.add(origin);
	}
	// Immutable nodes prove a move only when their source is unambiguous and
	// unclaimed. Equal content alone cannot provide an origin.
	for (const [index, entry] of current.entries()) {
		if (origins[index] !== null) continue;
		const candidates = [...(known.get(entry.node) ?? [])].filter(
			(origin) => !used.has(origin),
		);
		if (candidates.length !== 1) continue;
		const origin = candidates[0];
		if (origin === undefined) continue;
		origins[index] = origin;
		used.add(origin);
	}
	return origins;
}

function positions(doc: Node) {
	const result: Array<{ node: Node; from: number; to: number }> = [];
	doc.forEach((node, from) => {
		result.push({ node, from, to: from + node.nodeSize });
	});
	return result;
}
