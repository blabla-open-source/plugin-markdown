import {
	Tokenizer,
	type SourceEvent,
	type SourceFrame,
	type SourceInputSegment,
	type Token,
	type Tokens,
} from "marked";
import type {
	MarkdownLexicalRange,
	MarkdownLexicalSource,
} from "./markdown-lexical-source";

const tabListLexers = new WeakSet<Tokenizer["lexer"]>();

/** Each observed indentation width adds one level to a captured Tab outline. */
function projectTabOutline(source: string) {
	const run = /^(?:[\t ]*[-+*] [^\n]*(?:\n|$)|[\t ]*\n(?=[\t ]*[-+*] ))+/.exec(
		source,
	)?.[0];
	if (!run || !/^\t+[-+*] /m.test(run) || /^[\t ]* [\t ]*[-+*] /m.test(run))
		return undefined;
	const levels = [0];
	const segments: SourceInputSegment[] = [];
	let input = 0,
		output = "";
	for (const line of run.match(/[^\n]+\n?|\n/g) ?? []) {
		const tabs = line.trim() ? /^\t*/.exec(line)![0].length : 0;
		if (line.trim()) {
			while (levels.at(-1)! > tabs) levels.pop();
			if (levels.at(-1)! < tabs) levels.push(tabs);
			// Marked removes one two-space unit per container. Keep each unit
			// atomic so removing an ancestor leaves exact child Tab boundaries.
			for (let depth = 1; depth < levels.length; depth++) {
				segments.push({
					from: output.length + (depth - 1) * 2,
					to: output.length + depth * 2,
					parentFrom: input + levels[depth - 1]!,
					parentTo: input + levels[depth]!,
					transformed: true,
				});
			}
			output += "  ".repeat(levels.length - 1);
		}
		segments.push({
			from: output.length,
			to: output.length + line.length - tabs,
			parentFrom: input + tabs,
			parentTo: input + line.length,
		});
		output += line.slice(tabs);
		input += line.length;
	}
	segments.push({
		from: output.length,
		to: output.length + source.length - input,
		parentFrom: input,
		parentTo: source.length,
	});
	output += source.slice(input);
	const originalPoint = (point: number) => {
		const segment = segments.find(
			(part) => part.from <= point && point < part.to,
		);
		if (!segment) return source.length;
		return segment.transformed
			? segment.parentFrom
			: segment.parentFrom + point - segment.from;
	};
	return { output, segments, originalPoint };
}

/** Restore every container before the outer lexer consumes the original bytes.
 * Collect first: rewriting a parent range would change its relative item ranges.
 */
function restoreListSource(
	token: Tokens.List,
	frame: SourceFrame,
	originalFrame: SourceFrame,
	lexical: MarkdownLexicalSource,
	observe: (event: SourceEvent) => void,
) {
	observe({ kind: "consume", token, frame, from: 0, to: token.raw.length });
	const originals: { token: Token; ranges: MarkdownLexicalRange[] }[] = [];
	const collect = (current: Token) => {
		if (current.type === "list" || current.type === "list_item") {
			const ranges = lexical
				.fragments(current)
				.flatMap((range) => lexical.projectInput(range, originalFrame));
			if (
				!ranges.length ||
				ranges.some((range) => range.frame !== originalFrame)
			)
				throw new Error("Tab list has no original input mapping.");
			originals.push({ token: current, ranges });
		}
		if ("items" in current && Array.isArray(current.items))
			current.items.forEach(collect);
		if ("tokens" in current && Array.isArray(current.tokens))
			current.tokens.forEach(collect);
	};
	collect(token);
	for (const original of originals) {
		original.token.raw = original.ranges
			.map((range) => range.frame.source.slice(range.from, range.to))
			.join("");
		observe({
			kind: "consume",
			token: original.token,
			frame: originalFrame,
			from: original.ranges[0]!.from,
			to: original.ranges.at(-1)!.to,
		});
	}
}

export function tokenizeTabList(
	source: string,
	owner: Tokenizer,
	lexical: MarkdownLexicalSource,
) {
	const lexer = owner.lexer;
	if (tabListLexers.has(lexer))
		return Tokenizer.prototype.list.call(owner, source);
	const projected = projectTabOutline(source);
	if (!projected) return undefined;
	return lexical.capture(() => {
		const context = lexer.sourceContext;
		const previousObserver = lexer.onSource;
		const observe = previousObserver ?? ((event) => lexical.observe(event));
		const frame: SourceFrame = { source: projected.output, tokens: [] };
		lexer.onSource = observe;
		lexer.sourceContext = { frame, from: 0 };
		tabListLexers.add(lexer);
		try {
			if (context) {
				observe({
					kind: "mappedInput",
					tokens: frame.tokens,
					frame: context.frame,
					segments: projected.segments.map((part) => ({
						...part,
						parentFrom: context.from + part.parentFrom,
						parentTo: context.from + part.parentTo,
					})),
				});
				observe({ kind: "frame", frame });
			}
			const tokenizer = new Tokenizer({ ...owner.options, pedantic: false });
			tokenizer.rules = owner.rules;
			tokenizer.lexer = lexer;
			const token = tokenizer.list(projected.output);
			if (!token) return undefined;
			const consumed = projected.originalPoint(token.raw.length);
			if (context)
				restoreListSource(token, frame, context.frame, lexical, observe);
			token.raw = source.slice(0, consumed);
			return token;
		} finally {
			tabListLexers.delete(lexer);
			lexer.sourceContext = context;
			lexer.onSource = previousObserver;
		}
	});
}
