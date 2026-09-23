import { type EditorState, Plugin, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Lexer } from "marked";
import {
	fontParents,
	inheritInlineStyleValues,
	inlineStyleDeclarations,
	readInlineStyles,
} from "./markdown-inline-style";

type Span = {
	from: number;
	to: number;
	end: number;
	root: number;
	opening: string;
};

// Keep a DOM caret position even while the source occupies no visible space.
const foldedTag = {
	style: "display: inline-block; width: 0; height: 0; overflow: hidden",
	"aria-hidden": "true",
};

/** Preview complete children only. The unfinished outer span remains source. */
function closedChildren(text: string, complete = false): Span[] {
	const stack: Span[] = [];
	const closed: Span[] = [];
	let offset = 0;
	for (const token of new Lexer({ gfm: true }).inlineTokens(text)) {
		if (token.type === "html" && /^<span(?:\s|>)/i.test(token.raw))
			stack.push({
				from: offset + token.raw.length,
				to: 0,
				end: 0,
				root: stack[0]?.root ?? offset,
				opening: token.raw,
			});
		if (token.type === "html" && /^<\/span\s*>$/i.test(token.raw)) {
			const span = stack.pop();
			if (span && span.from < offset)
				closed.push({ ...span, to: offset, end: offset + token.raw.length });
		}
		offset += token.raw.length;
	}
	return closed
		.filter((span) => complete || span.root === stack[0]?.root)
		.sort((left, right) => left.from - right.from);
}

function styledChildren(text: string, complete = false) {
	return closedChildren(text, complete).map((span) => {
		// Parse one opening token only; never attach author HTML to the editor.
		const element = new DOMParser().parseFromString(
			`${span.opening}</span>`,
			"text/html",
		).body.firstElementChild as HTMLElement;
		return { ...span, attrs: readInlineStyles(element) };
	});
}

/** Compose colors, but retain font wrappers so relative sizes inherit each layer. */
function spanDecorations(
	spans: ReturnType<typeof styledChildren>,
	offset: number,
) {
	const boundaries = [
		...new Set(spans.flatMap(({ from, to }) => [from, to])),
	].sort((left, right) => left - right);
	const decorations: Decoration[] = [];
	for (const [index, to] of boundaries.entries()) {
		const from = boundaries[index - 1];
		if (from === undefined) continue;
		const attrs = spans
			.filter((span) => span.from <= from && span.to >= to)
			.reduce(
				(parent, span) => inheritInlineStyleValues(parent, span.attrs),
				{},
			);
		// ProseMirror builds explicit decoration wrappers from the inside out.
		for (const layer of [...fontParents(attrs), attrs].reverse()) {
			const style = inlineStyleDeclarations(layer);
			if (style)
				decorations.push(
					Decoration.inline(offset + from, offset + to, {
						nodeName: "span",
						style,
					}),
				);
		}
	}
	return decorations;
}

/** Display source line breaks as HTML whitespace without collapsing authored
 * spaces or changing the text/positions that history and serialization own. */
function softBreakDecorations(text: string, offset: number) {
	if (!text.includes("\n")) return [];
	return Array.from(text.matchAll(/\r?\n/g), (match) =>
		Decoration.inline(
			offset + match.index,
			offset + match.index + match[0].length,
			{
				class: "markdown-color-softbreak",
			},
		),
	);
}

/** Literal source is never mounted as HTML; only validated inline styles decorate it. */
export function colorSourceDecorations(text: string, offset: number) {
	const spans = styledChildren(text, true);
	const decorations = spanDecorations(spans, offset);
	if (!text.includes("\n")) return decorations;
	let from = 0;
	for (const token of new Lexer({ gfm: true }).inlineTokens(text)) {
		const to = from + token.raw.length;
		// Opening/closing tags remain literal, including newlines in attributes.
		if (
			token.type === "text" &&
			spans.some((span) => span.from <= from && span.to >= to)
		)
			decorations.push(...softBreakDecorations(token.raw, offset + from));
		from = to;
	}
	return decorations;
}

function colorDecorations({ doc, selection }: EditorState): DecorationSet {
	const decorations: Decoration[] = [];
	doc.descendants((block, pos) => {
		if (block.type.spec.code) return false;
		if (!block.isTextblock) return;
		let text = "";
		block.forEach((node, offset) => {
			if (
				node.isText &&
				node.marks.some((mark) => mark.type.name === "textStyle") &&
				!node.marks.some((mark) => mark.type.spec.code)
			)
				decorations.push(
					...softBreakDecorations(node.text ?? "", pos + 1 + offset),
				);
			text +=
				node.isText && !node.marks.some((mark) => mark.type.spec.code)
					? node.text
					: "\ufffc".repeat(node.nodeSize);
		});
		if (!/<\/span\s*>/i.test(text)) return false;
		const spans = styledChildren(text);
		decorations.push(...spanDecorations(spans, pos + 1));
		for (const span of spans) {
			const style = inlineStyleDeclarations(span.attrs);
			const start = pos + 1 + span.from - span.opening.length;
			const end = pos + 1 + span.end;
			if (style && !(selection.from < end && selection.to > start))
				decorations.push(
					Decoration.inline(start, pos + 1 + span.from, foldedTag, {
						colorTag: true,
					}),
					Decoration.inline(pos + 1 + span.to, end, foldedTag, {
						colorTag: true,
					}),
				);
		}
		return false;
	});
	return DecorationSet.create(doc, decorations);
}

export function colorPreviewPlugin() {
	return new Plugin<DecorationSet>({
		state: {
			init: (_config, state) => colorDecorations(state),
			apply: (tr, previous, _oldState, state) =>
				tr.docChanged || tr.selectionSet ? colorDecorations(state) : previous,
		},
		props: {
			handleKeyDown(view, event) {
				const { selection, tr } = view.state;
				if (
					!selection.empty ||
					event.altKey ||
					event.ctrlKey ||
					event.metaKey ||
					event.shiftKey
				)
					return false;
				const direction = {
					ArrowLeft: -1,
					Backspace: -1,
					ArrowRight: 1,
					Delete: 1,
				}[event.key];
				if (!direction) return false;
				const cursor = selection.from;
				const hidden = this.getState(view.state)?.find(
					cursor,
					cursor,
					(spec) => spec.colorTag,
				);
				if (
					!hidden?.some((tag) => (direction < 0 ? tag.to : tag.from) === cursor)
				)
					return false;
				// Native editing skips collapsed text. Cross one source character,
				// so entering unfolds the tag and deleting never drops a whole tag.
				const next = cursor + direction;
				if (event.key === "Backspace" || event.key === "Delete")
					tr.delete(Math.min(cursor, next), Math.max(cursor, next));
				else tr.setSelection(TextSelection.create(tr.doc, next));
				view.dispatch(tr.scrollIntoView());
				return true;
			},
			decorations(state) {
				return this.getState(state);
			},
		},
	});
}
