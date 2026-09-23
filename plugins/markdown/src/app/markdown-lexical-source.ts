import { projectMarkdownInput, sliceMarkdownInput, type MarkdownInputRange, type MarkdownInputSegment } from "./markdown-input-projection";
import { Lexer, type marked, type SourceEvent, type SourceFrame } from "marked";

export type MarkdownLexicalRange = MarkdownInputRange;

/** Offsets come from the lexer's actual consumption, including discarded defs.
 * Container items are relative to their producing token, never text matches.
 */
export class MarkdownLexicalSource {
	private captures = 0;
	private ranges = new WeakMap<object, readonly MarkdownLexicalRange[]>();
	private items = new WeakMap<object, { parent: object; from: number; to: number }>();
	private merged = new WeakMap<object, object>();
	private inputs = new WeakMap<object, MarkdownInputSegment[]>();
	private textInputs = new WeakMap<object, {frame: SourceFrame; segments: MarkdownInputSegment[]}>();
	private frames = new WeakMap<object, readonly MarkdownInputSegment[]>();

	emptyInput(tokens: object): MarkdownLexicalRange[] {
		const segments = this.inputs.get(tokens);
		return segments ? segments.map(segment => ({frame:segment.frame,from:segment.parentFrom,to:segment.parentTo})) : [];
	}

	get recording(): boolean { return this.captures > 0; }

	recordTextInput(token: object, source: string, segments: MarkdownInputSegment[]): void {
		const frame: SourceFrame = {source, tokens: []};
		this.textInputs.set(token, {frame, segments});
		this.frames.set(frame, segments);
	}

	inheritTextInput(token: object, parent: object): void {
		const input = this.textInputs.get(parent);
		if (input) this.textInputs.set(token, input);
	}

	capture<T>(read: () => T): T {
		this.captures++;
		try { return read(); } finally {
			// Marked's configured tokenizer can retain its last lexer and tokens.
			// Weak keys alone therefore do not bound these tables to the parse.
			// Nested captures finish before their shared producer tables are released.
			if (--this.captures === 0) {
				this.ranges = new WeakMap();
				this.items = new WeakMap();
				this.merged = new WeakMap();
				this.inputs = new WeakMap();
				this.textInputs = new WeakMap();
				this.frames = new WeakMap();
			}
		}
	}

	observe(event: SourceEvent): void {
		if (event.kind === "textInput") {
			const source = "text" in event.token ? event.token.text : undefined;
			if (typeof source !== "string") throw new Error("Text input observation has no token text.");
			const segments = event.segments.map(segment => ({...segment, frame: event.frame}));
			this.recordTextInput(event.token, source, segments);
			return;
		}
		if (event.kind === "reparseInput") {
			const segments: MarkdownInputSegment[] = [];
			let cursor = 0;
			for (const range of this.fragments(event.token)) {
				const length = Math.min(range.to - range.from, event.length - cursor);
				if (length <= 0) break;
				segments.push({ from: cursor, to: cursor + length, frame: range.frame, parentFrom: range.from, parentTo: range.from + length });
				cursor += length;
			}
			const { frame, from, to } = event.remainder;
			segments.push({ from: event.length, to: event.length + to - from, frame, parentFrom: from, parentTo: to });
			this.inputs.set(event.tokens, segments);
			return;
		}
		if (event.kind === "frame") {
			const input = this.inputs.get(event.frame.tokens);
			if (input) this.frames.set(event.frame, [...input]);
			return;
		}
		if (event.kind === "mappedInput") {
			this.inputs.set(event.tokens, event.segments.map(segment => ({ ...segment, frame: event.frame })));
			return;
		}
		if (event.kind === "input") {
			this.inputs.set(event.tokens, [{ from: 0, to: event.to - event.from, frame: event.frame, parentFrom: event.from, parentTo: event.to }]);
			return;
		}
		if (event.kind === "sliceInput") {
			const input = this.inputs.get(event.sourceTokens ?? event.tokens);
			if (input) this.inputs.set(event.tokens, sliceMarkdownInput(input, event.from, event.to));
			return;
		}
		if (event.kind === "appendInput") {
			const segments = this.inputs.get(event.tokens) ?? [];
			if (event.separator) {
				const { frame, from, to } = event.separator;
				segments.push({ from: event.offset - 1, to: event.offset, frame, parentFrom: from, parentTo: to });
			}
			for (const segment of this.inputs.get(event.input) ?? []) {
				segments.push({ ...segment, from: segment.from + event.offset, to: segment.to + event.offset });
			}
			this.inputs.set(event.tokens, segments);
			return;
		}
		if (event.kind === "item") {
			this.items.set(event.token, event);
			return;
		}
		if (event.kind === "merge") {
			// Lexing finishes before parsing reads these private text frames.
			const parent = this.textInputs.get(event.parent), child = this.textInputs.get(event.token);
			if (parent && child) {
				const offset = parent.frame.source.length;
				parent.segments.push(...child.segments.map(segment => ({...segment, from: offset + segment.from, to: offset + segment.to})));
				parent.frame.source += child.frame.source;
			} else this.textInputs.delete(event.parent);
			this.merged.set(event.token, event.parent);
			const ranges = this.ranges.get(event.token);
			if (ranges) this.extend(event.parent, ranges);
			return;
		}
		const range = { frame: event.frame, from: event.from, to: event.to };
		if (event.kind === "trailingSpace") {
			this.extend(event.token, [range]);
			return;
		}
		this.ranges.set(event.token, [range]);
    if ("items" in event.token && Array.isArray(event.token.items)) {
      for (const item of event.token.items) {
        if (!item.sourceRange) continue;
        this.items.set(item, {parent: event.token, from: item.sourceRange.from, to: item.sourceRange.to});
      }
    }
		const parent = this.merged.get(event.token);
		if (parent) this.extend(parent, [range]);
	}

	private extend(token: object, ranges: readonly MarkdownLexicalRange[]): void {
		const previous = this.ranges.get(token);
		if (!previous) throw new Error("Markdown lexer merged into an unobserved token.");
		const result = [...previous];
		for (const range of ranges) {
			const last = result.at(-1);
			if (last?.frame === range.frame && last.to === range.from) {
				result[result.length - 1] = { ...last, to: range.to };
			} else result.push(range);
		}
		this.ranges.set(token, result);
	}

	/** Project only ranges covered by an observed parent-input transformation.
	 * Unprojected ranges retain their actual frame identity for coverage audits. */
	projectInput(range: MarkdownLexicalRange): MarkdownLexicalRange[] {
		const input = this.frames.get(range.frame);
		const projected = input && projectMarkdownInput(range, input);
		if (!projected) return [range];
		return projected.flatMap(parent => {
			if (parent.frame === range.frame) throw new Error("Markdown input projects into itself.");
			return this.projectInput(parent);
		});
	}

	/** Preserve output coordinates while composing input frames. Partial atomic
	 * inputs remain unrooted, just like projectInput; their interiors are unknown. */
	projectSegments(segments: readonly MarkdownInputSegment[]): MarkdownInputSegment[] {
		return segments.flatMap(segment => {
			const parents = this.frames.get(segment.frame);
			if (!parents) return [segment];
			const range = {frame: segment.frame, from: segment.parentFrom, to: segment.parentTo};
			if (!projectMarkdownInput(range, parents)) return [segment];
			if (segment.transformed) return this.projectInput(range).map(parent => ({...segment, frame: parent.frame, parentFrom: parent.from, parentTo: parent.to}));
			const input = sliceMarkdownInput(parents, segment.parentFrom, segment.parentTo).map(parent => ({...parent, from: segment.from + parent.from, to: segment.from + parent.to}));
			if (input.some(parent => parent.frame === segment.frame)) throw new Error("Markdown input projects into itself.");
			return this.projectSegments(input);
		});
	}

	textInput(token: object): MarkdownLexicalRange | null {
		const input = this.textInputs.get(token);
		return input ? {frame: input.frame, from: 0, to: input.frame.source.length} : null;
	}

	fragments(token: object): readonly MarkdownLexicalRange[] {
		const direct = this.ranges.get(token);
		if (direct) return direct;
		const item = this.items.get(token);
		if (!item) return [];
		const parents = this.fragments(item.parent);
		if (parents.length !== 1) throw new Error("List items require one producing list range.");
		const parent = parents[0]!;
		return [{
			frame: parent.frame,
			from: parent.from + item.from,
			to: Math.min(parent.to, parent.from + item.to),
		}];
	}
}

const sources = new WeakMap<object, MarkdownLexicalSource>();

export function trackMarkdownLexicalSource(instance: typeof marked): typeof marked {
	const source = new MarkdownLexicalSource();
	sources.set(instance, source);
	instance.Lexer = class SourceLexer<ParserOutput = string, RendererOutput = string> extends Lexer<ParserOutput, RendererOutput> {
		override onSource = source.recording ? (event: SourceEvent) => source.observe(event) : undefined;
	};
	return instance;
}

export function markdownLexicalSource(instance: typeof marked): MarkdownLexicalSource {
	const source = sources.get(instance);
	if (!source) throw new Error("Markdown grammar has no lexical source producer.");
	return source;
}
