import { decodedMarkdownInput, originalMarkdownTextSegments, type MarkdownCharacterSegment } from "./markdown-text-projection";
import type { MarkdownSourceBlock } from "./markdown-source-blocks";
import type { JSONContent, MarkdownToken } from "@tiptap/core";
import type { MarkdownParseEvent } from "@tiptap/markdown";
import type { MarkdownLexicalRange, MarkdownLexicalSource } from "./markdown-lexical-source";
import type { MarkdownInputSegment } from "./markdown-input-projection";
import type { HTMLTextOutput, HTMLGeneratedRange } from "./markdown-html-source";

type Derivation = { parent: object; from: number; to: number } | { parent: object; items: readonly object[] };

export interface MarkdownTextOutput {
	/** Generated output is attributed separately from exact character projection. */
	inputGenerated?: readonly HTMLGeneratedRange[];
	generated?: readonly {from: number; to: number; source: readonly {from: number; to: number}[] | null}[];
	/** HTML producer ranges address token.text before original-source projection. */
	inputMapping?: readonly MarkdownCharacterSegment[];
	mapping?: readonly MarkdownCharacterSegment[] | null;
	/** Whole decoder input projected to original block-source ranges, when rooted. */
	source?: readonly { from: number; to: number; transformed?: true }[] | null;
	/** Actual leaf token; retained only by the parse artifact. */
	token: MarkdownToken;
	from: number;
	to: number;
	/** Decoder input coordinates are local to token.text, not token.raw. */
	input: string;
	output: string;
	/** Each edit addresses the string after previous replacements. */
	replacements: readonly { from: number; to: number; text: string }[];
}

export interface MarkdownInlineContribution {
	text?: readonly MarkdownTextOutput[];
	/** Block-content-relative ProseMirror positions, before text merging. */
	from: number;
	to: number;
	nodeIndex: number;
	tokens: readonly MarkdownToken[];
	/** Exact consumed ranges in the lexer input frames; container projection is separate. */
	input: readonly MarkdownLexicalRange[];
	/** Original block-source offsets, null until every parent input is projected. */
	source: readonly { from: number; to: number; transformed?: true }[] | null;
}

export interface MarkdownParsedBlock {
	/** Item boundaries from the producing list token, in original source coordinates. */
	items?: readonly { start: number; end: number }[];
	/** Indexes into the parsed document's top-level content. */
	fromNode: number;
	toNode: number;
	/** Original source UTF-16 offsets, before CRLF normalization. */
	start: number;
	end: number;
	implicit: boolean;
	inline: readonly MarkdownInlineContribution[];
}

export interface MarkdownParsedSource {
	source: string;
	doc: JSONContent;
	blocks: readonly MarkdownParsedBlock[];
}

/** Delimiters belong to the block; terminal separators belong to its gap. */
export function markdownParsedBlockRange(source: string, block: MarkdownParsedBlock): MarkdownSourceBlock {
 const terminal = block.implicit ? "" : source.slice(block.start, block.end).match(/(?:\r\n|\r|\n)+$/)?.[0] ?? "";
 return { start: block.start, end: block.end - terminal.length, ...(block.implicit ? { synthetic: true } : {}) };
}

type TextLineage = { output: MarkdownTextOutput } | { left?: TextLineage; right: TextLineage; offset: number };

/** Joining parser text must not repeatedly copy every preceding leaf record. */
function appendTextLineage(lineage: TextLineage, from: number, output: MarkdownTextOutput[]) {
	const pending = [{lineage, from}];
	while (pending.length) {
		const current = pending.pop()!;
		if ("output" in current.lineage) {
			const text = current.lineage.output;
			output.push({...text, from: current.from + text.from, to: current.from + text.to});
		} else {
			pending.push({lineage: current.lineage.right, from: current.from + current.lineage.offset});
			if (current.lineage.left) pending.push({lineage: current.lineage.left, from: current.from});
		}
	}
}

/** Parse-scoped provenance, discarded after producing the immutable index. */
export class MarkdownParseSource {
	private readonly text = new WeakMap<JSONContent, TextLineage>();
	private readonly derived = new WeakMap<object, Derivation>();
	private readonly owners = new WeakMap<JSONContent, object>();
	private readonly implicit = new WeakSet<object>();
	private readonly inline = new WeakMap<JSONContent[], Array<Omit<MarkdownInlineContribution, "nodeIndex" | "source">>>();
	private document?: Extract<MarkdownParseEvent, { kind: "document" }>;

	constructor(private readonly lexical: MarkdownLexicalSource, private readonly nodeSize: (node: JSONContent) => number) {}

	recordHTML(token: MarkdownToken, input: string, outputs: readonly HTMLTextOutput[]): void {
		for (const {node, mapping, generated} of outputs) {
			const output = node.text ?? "";
			this.text.set(node, {output: {token, from: 0, to: output.length, input, output, replacements: [], inputMapping: mapping, inputGenerated: generated}});
		}
	}

	observe(event: MarkdownParseEvent): void {
		switch (event.kind) {
			case "concat": {
				const segments: MarkdownInputSegment[] = [];
				let offset = 0;
				for (const input of event.inputs) {
					const text = input.field === "text" ? this.lexical.textInput(input.token) : null;
					const ranges = input.field === "raw" ? this.fragments(input.token) : text ? [text] : [];
					const start = offset;
					for (const range of ranges) {
						const length = range.to - range.from;
						segments.push({from: offset, to: offset + length, frame: range.frame, parentFrom: range.from, parentTo: range.to});
						offset += length;
					}
					if (offset - start !== input.length) throw new Error("Concatenated HTML input lacks its producing source interval.");
				}
				this.lexical.recordTextInput(event.token, event.token.text ?? "", segments);
				break;
			}
			case "text": {
				const source = event.token.textSourceRange as { from: number; to: number } | undefined;
				if (source) {
					const ranges = this.fragments(event.token);
					const range = ranges[0];
					if (!range || ranges.length !== 1 || source.from < 0 || source.to > range.to - range.from || source.to - source.from !== event.input.length)
						throw new Error("Literal text has no complete producing token range.");
					this.lexical.recordTextInput(event.token, event.input, [{ from: 0, to: event.input.length, frame: range.frame, parentFrom: range.from + source.from, parentTo: range.from + source.to }]);
				}
				this.text.set(event.node, { output: { token: event.token, from: 0, to: event.output.length, input: event.input, output: event.output, replacements: event.replacements.map(edit => ({...edit})) } });
				break;
			}
			case "clone": {
				const source = this.text.get(event.source);
				if (source) this.text.set(event.node, source);
				break;
			}
			case "joinText": {
				const target = this.text.get(event.target);
				const source = this.text.get(event.source);
				if (source) this.text.set(event.target, {left: target, right: source, offset: event.offset});
				break;
			}
			case "inline": {
				const runs = this.inline.get(event.content) ?? [];
				const from = runs.at(-1)?.to ?? 0;
				let to = from;
				const text: MarkdownTextOutput[] = [];
				for (let index = event.fromNode; index < event.toNode; index++) {
					const node = event.content[index]!;
					const end = to + this.nodeSize(node);
					const decoded = this.text.get(node);
					if (decoded) appendTextLineage(decoded, to, text);
					to = end;
				}
				runs.push({ input: event.tokens.length ? event.tokens.slice(event.fromToken,event.toToken).flatMap(token => this.fragments(token)) : this.lexical.emptyInput(event.tokens), from, to, ...(text.length ? {text} : {}), tokens: event.tokens.slice(event.fromToken, event.toToken) });
				this.inline.set(event.content, runs);
				break;
			}
			case "derive":
				this.derived.set(event.token, event);
				if (event.copiedText) this.lexical.inheritTextInput(event.token, event.parent);
				break;
			case "listGroup":
				this.derived.set(event.token, { parent: event.parent, items: event.items });
				break;
			case "empty":
				this.derived.set(event.node, { parent: event.token, from: event.from, to: event.to });
				this.owners.set(event.node, event.node);
				this.implicit.add(event.node);
				break;
			case "token":
				for (const node of event.nodes) {
					const owner = this.owners.get(node);
					const group = owner && this.derived.get(owner);
					if (this.implicit.has(node) || (group && "items" in group && group.parent === event.token)) continue;
					this.owners.set(node, event.token);
				}
				break;
			case "document":
				this.document = event;
				break;
		}
	}

	private inlineContributions(node: JSONContent, nodeIndex: number, from = 0): MarkdownInlineContribution[] {
		if (!node.content) return [];
		const runs = this.inline.get(node.content);
		if (runs) return runs.map(run => ({ ...run, ...(run.text ? {text: run.text.map(text => ({...text, from: from + text.from, to: from + text.to}))} : {}), nodeIndex, source: null, from: from + run.from, to: from + run.to, input: run.input }));
		const result: MarkdownInlineContribution[] = [];
		let position = from;
		for (const child of node.content) {
			const size = this.nodeSize(child);
			if (child.type === "text") {
				const owner = this.owners.get(child);
				const lineage = this.text.get(child);
				const text: MarkdownTextOutput[] = [];
				if (lineage) appendTextLineage(lineage, position, text);
				const tokens = owner ? [owner as MarkdownToken] : text.map(output => output.token);
				if (tokens.length) result.push({ from: position, to: position + size, nodeIndex, source: null, tokens, input: tokens.flatMap(token => this.fragments(token)), ...(text.length ? {text} : {}) });
			} else result.push(...this.inlineContributions(child, nodeIndex, position + 1));
			position += size;
		}
		return result;
	}

	private fragments(token: object): readonly MarkdownLexicalRange[] {
		const derived = this.derived.get(token);
		if (!derived) return this.lexical.fragments(token);
		if ("items" in derived) return derived.items.flatMap((item) => this.fragments(item));
		const fragments = this.fragments(derived.parent);
		if (fragments.length !== 1) throw new Error("A raw token derivation requires a single source frame.");
		const parent = fragments[0]!;
		return [{ frame: parent.frame, from: parent.from + derived.from, to: Math.min(parent.to, parent.from + derived.to) }];
	}

	finish(source: string, doc: JSONContent): MarkdownParsedSource {
		const parsed = this.document;
		if (!parsed) throw new Error("Markdown parser did not report a document.");
		const offsets = normalizedOffsets(source);
		const lineBreaks = offsets?.flatMap((offset, index) => index + 1 < offsets.length && offsets[index + 1]! - offset > 1 ? [index] : []) ?? [];
		const blocks: MarkdownParsedBlock[] = [];
		let previousOwner: object | undefined;
		for (const [index, node] of (parsed.document.content ?? []).entries()) {
			const owner = this.owners.get(node);
			if (!owner) throw new Error("Parsed Markdown node has no producing token.");
			if (owner === previousOwner) {
				const previous = blocks[blocks.length - 1]!;
				blocks[blocks.length - 1] = { ...previous, toNode: index + 1, inline: [...previous.inline, ...this.inlineContributions(node, index)] };
				continue;
			}
			const fragments = this.fragments(owner);
			if (!fragments.length || fragments.some((fragment) => fragment.frame.tokens !== parsed.tokens)) {
				throw new Error(`Top-level Markdown ${node.type} has ${fragments.length} source fragments outside its document frame.`);
			}
			const syntax = (owner as MarkdownToken).sourceRange;
			const start = fragments[0]!.from + (syntax?.from ?? 0);
			const end = syntax ? Math.min(fragments.at(-1)!.to, fragments[0]!.from + syntax.to) : fragments.at(-1)!.to;
			const startOffset = offsets ? offsets[start] : start;
			const endOffset = offsets ? offsets[end] : end;
			if (startOffset === undefined || endOffset === undefined || startOffset < (blocks.at(-1)?.end ?? 0) || endOffset < startOffset || endOffset > source.length) {
				throw new Error(`Markdown parser produced invalid source intervals: ${node.type} [${startOffset}, ${endOffset}) after ${blocks.at(-1)?.end ?? 0}, length ${source.length}.`);
			}
			const inline = this.inlineContributions(node, index);
			const items = (owner as MarkdownToken).items?.map(item => {
        const ranges = this.fragments(item).flatMap(range => this.lexical.projectInput(range));
        if (!ranges.length || ranges.some(range => range.frame.tokens !== parsed.tokens)) throw new Error("List item has no original source range.");
        const from = ranges[0]!.from, to = ranges.at(-1)!.to;
        const sourceFrom = offsets ? offsets[from] : from, sourceTo = offsets ? offsets[to] : to;
        if (sourceFrom === undefined || sourceTo === undefined) throw new Error("List item projects outside the input.");
        // The parser may extract absorbed blank lines from the parent token.
        // Its derived block range is the authority for those separators.
        const start = Math.max(startOffset, sourceFrom), end = Math.min(endOffset, sourceTo);
        if (end < start) throw new Error("List item source range is outside its list.");
        return {start, end};
      });
      blocks.push({ fromNode: index, toNode: index + 1, start: startOffset, end: endOffset, implicit: this.implicit.has(owner), inline, ...(items ? {items} : {}) });
			previousOwner = owner;
		}
		const originalOffset = (position: number) => {
			const offset = offsets ? offsets[position] : position;
			if (offset === undefined) throw new Error("Markdown input projects outside its original source.");
			return offset;
		};
		for (const block of blocks) block.inline = block.inline.map(run => {
			const input = run.input.flatMap(range => this.lexical.projectInput(range));
			return {
				...run,
				...(run.text ? {text: run.text.map(text => {
					const range = this.lexical.textInput(text.token);
					const input = range ? this.lexical.projectInput(range) : [];
					const decoded = range ? text.inputMapping
						? text.inputMapping.map(part => ({from: part.from, to: part.to, frame: range.frame, parentFrom: part.sourceFrom, parentTo: part.sourceTo, ...(part.atomic ? {transformed: true as const} : {})}))
						: decodedMarkdownInput(range.frame, text.input.length, text.replacements) : [];
					const output = this.lexical.projectSegments(decoded);
					const mapping = output.length && output.every(segment => segment.frame.tokens === parsed.tokens)
						? originalMarkdownTextSegments(output, text.from, block.start, originalOffset, lineBreaks) : null;
					const generated = text.inputGenerated?.map(part => {
						const owner = range && part.input ? this.lexical.projectInput({frame: range.frame, ...part.input}) : [];
						return {from: text.from + part.from, to: text.from + part.to, source: owner.length && owner.every(range => range.frame.tokens === parsed.tokens)
							? owner.map(range => ({from: originalOffset(range.from) - block.start, to: originalOffset(range.to) - block.start})) : null};
					});
					return {...text, mapping, ...(generated ? {generated} : {}), source: input.length && input.every(part => part.frame.tokens === parsed.tokens)
						? input.map(part => ({from: originalOffset(part.from) - block.start, to: originalOffset(part.to) - block.start, ...(part.transformed ? {transformed: true as const} : {})})) : null};
				})} : {}),
				source: input.length && input.every(range => range.frame.tokens === parsed.tokens)
					? input.map(range => ({ from: originalOffset(range.from) - block.start, to: originalOffset(range.to) - block.start, ...(range.transformed ? { transformed: true as const } : {}) }))
					: null,
			};
		});
		return { source, doc, blocks };
	}
}

export function normalizedOffsets(source: string): number[] | undefined {
	if (!source.includes("\r")) return undefined;
	const offsets: number[] = [];
	for (let index = 0; index < source.length; index++) {
		offsets.push(index);
		if (source[index] === "\r" && source[index + 1] === "\n") index++;
	}
	offsets.push(source.length);
	return offsets;
}
