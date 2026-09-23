import type { JSONContent } from "@tiptap/core";

/** Symbols survive serializer copies without becoming document attributes. */
const selectedSource = Symbol("selected Markdown source");
const sourceParent = Symbol("Markdown source parent");
type LocatedNode = JSONContent & {
	[selectedSource]?: MarkdownSerializedPoint;
	[sourceParent]?: MarkdownSerializedPoint;
};

export class MarkdownSerializedPoint {
	depth = 0;
	private point: number | undefined;
	private prefix = 0;
	private delta = 0;
	constructor(private readonly offset: number | "end", readonly preserveWhitespace = false) {}

	bind(parent: JSONContent, node: JSONContent) {
		(parent as LocatedNode)[sourceParent] = this;
		(node as LocatedNode)[selectedSource] = this;
		return () => {
			delete (parent as LocatedNode)[sourceParent];
			delete (node as LocatedNode)[selectedSource];
		};
	}

	observe(node: JSONContent, from: number, to: number) {
		if (this.depth !== 1 || (node as LocatedNode)[selectedSource] !== this) return;
		const offset = this.offset === "end" ? to - from : this.offset;
		if (this.point !== undefined || offset < 0 || from + offset > to)
			throw new Error("Source node has no unique serialized position.");
		this.point = from + offset;
	}

	textPosition(node: JSONContent, input: string) {
		if (this.depth !== 1 || (node as LocatedNode)[selectedSource] !== this) return;
		const position = this.offset === "end" ? input.length : this.offset;
		if (input !== node.text || position < 0 || position > input.length)
			throw new Error("Source text position requires its literal serialization input.");
		return { position, finish: (point: number) => {
			if (this.point !== undefined) throw new Error("Source text was serialized twice.");
			this.point = point;
		} };
	}

	setPrefix(size: number) {
		if (this.depth === 1) this.prefix = size;
	}

	empty() {
		if (this.depth !== 1 || this.point === undefined) return;
		this.point = 0;
		this.prefix = 0;
		this.delta = 0;
	}

	replace(from: number, size: number, replacement: number) {
		if (this.depth !== 1 || this.point === undefined) return;
		const point = this.point + this.prefix;
		if (from < point && point < from + size)
			throw new Error("Source position crosses a protected serialization fragment.");
		if (from + size <= point) this.delta += replacement - size;
	}

	finish(source: string) {
		if (this.point === undefined) throw new Error("Source node was not serialized.");
		const position = this.point + this.prefix + this.delta;
		if (position < 0 || position > source.length) throw new Error("Serialized source position is outside output.");
		return { source, position };
	}
}

export function recordMarkdownSerializedPrefix(node: JSONContent, size: number) {
	(node as LocatedNode)[sourceParent]?.setPrefix(size);
}
