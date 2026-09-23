import type { createMarkdownHTMLDOM } from "./markdown-html-dom";
import type { HTMLSerializationRecord } from "./markdown-html-serialization";

type HTMLInput = ReturnType<typeof createMarkdownHTMLDOM>;
type Range = {from: number; to: number};
const point = (at: number): Range => ({from: at, to: at});

/** Syntax comes from its actual tag/attribute/comment, or a creation anchor. */
export function serializedHTMLSyntax(record: HTMLSerializationRecord, html: HTMLInput): Range {
	if (record.attribute) {
		const attr = html.attributes.get(record.attribute)!;
		if (record.kind === "name") return attr.sourceName!;
		if (record.role === "attribute-space") return point(attr.sourceName!.from);
		if (record.role === "attribute-value-open") return {from: attr.sourceName!.to, to: attr.sourceValueRange?.from ?? attr.sourceEnd!};
		if (record.role === "attribute-value-close") return {from: attr.sourceValueRange?.to ?? attr.sourceEnd!, to: attr.sourceEnd!};
	}
	if (record.node.nodeType === 8) {
		const comment = html.comments.get(record.node as Comment)!;
		if (record.role === "comment-open") return {from: comment.location!.startOffset, to: comment.sourceDataRange!.from};
		if (record.role === "comment-close") return {from: comment.sourceDataRange!.to, to: comment.sourceEnd!};
	}
	const tree = html.elements.get(record.node as Element)!;
	if (!tree) throw new Error("Serialized syntax lacks its producing element.");
	const operation = html.elementOperations.get(tree)!;
	const location = tree.sourceCodeLocation;
	const ending = record.role === "end" || record.role?.startsWith("end-");
	const tag = ending ? location?.endTag : location?.startTag;
	const explicit = ending && operation.closing?.explicit ? operation.closing : undefined;
	const name = tag?.sourceName ?? explicit?.name;
	const from = tag?.startOffset ?? explicit?.from, to = tag?.endOffset ?? explicit?.to;
	if (name && from !== undefined && to !== undefined) {
		if (record.kind === "name") return name;
		if (record.role?.endsWith("open")) return {from, to: name.from};
		return {from: to - 1, to};
	}
	const anchor = ending ? operation.closing?.from ?? location?.endOffset : operation.createdAt;
	if (anchor === undefined) throw new Error("Generated syntax lacks its producing operation.");
	return point(anchor);
}
