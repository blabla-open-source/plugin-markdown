import { DOMParser, type DOMSourceText, type Node, type Schema, type ParseOptions } from "@tiptap/pm/model";

import { type HTMLSerialization } from "./markdown-html-serialization";

export interface DOMTextOutput {
	from: number; to: number; type: string;
	source: DOMSourceText | {kind: "generated"; dom: HTMLElement; serialization?: HTMLSerialization};
}
type Lineage = {kind: "leaf"; record: DOMTextOutput}
	| {kind: "clip"; tree: Lineage; to: number}
	| {kind: "children"; children: {tree: Lineage; offset: number}[]};

/** Retain actual insertion/trim/finish identities; flatten only the final tree. */
export function parseMarkdownDOM(schema: Schema, dom: Element, options: ParseOptions = {}) {
	const records = new WeakMap<object, Lineage>();
	const node = DOMParser.fromSchema(schema).parse(dom, {...options, onSource(event) {
		if (event.kind === "text") {
			records.set(event.node, {kind: "leaf", record: {from: 0, to: event.node.nodeSize, type: event.node.type.name, source: event.source}});
		} else if (event.kind === "generated") {
			const offset = event.node.isLeaf ? 0 : -1;
			records.set(event.node, {kind: "leaf", record: {from: offset, to: offset + event.node.nodeSize, type: event.node.type.name, source: {kind: "generated", dom: event.dom, serialization: event.source?.kind === "markdown-html" ? event.source.value as HTMLSerialization : undefined}}});
		} else if (event.kind === "trim") {
			const tree = records.get(event.node);
			if (tree) records.set(event.output, {kind: "clip", tree, to: event.to});
		} else {
			let offset = 0;
			const children: {tree: Lineage; offset: number}[] = [];
			for (const child of event.children) {
				const tree = records.get(child);
				if (tree) children.push({tree, offset: offset + (child.isLeaf ? 0 : 1)});
				offset += child.nodeSize;
			}
			records.set(event.node, {kind: "children", children});
		}
		options.onSource?.(event);
	}});
	return {node, mapping: flattenDOMSource(node, records)};
}

function flattenDOMSource(node: Node, records: WeakMap<object, Lineage>): DOMTextOutput[] {
	const root = records.get(node);
	const pending = root ? [{tree: root, from: 0, limit: Infinity}] : [];
	const result: DOMTextOutput[] = [];
	while (pending.length) {
		const {tree, from, limit} = pending.pop()!;
		if (tree.kind === "leaf") {
			const start = from + tree.record.from, end = Math.min(limit, from + tree.record.to);
			if (start < end) result.push({...tree.record, from: start, to: end});
		} else if (tree.kind === "clip") pending.push({tree: tree.tree, from, limit: Math.min(limit, from + tree.to)});
		else for (let index = tree.children.length - 1; index >= 0; index--) {
			const child = tree.children[index]!;
			pending.push({tree: child.tree, from: from + child.offset, limit});
		}
	}
	return result;
}
