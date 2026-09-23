import { Mark, mergeAttributes } from "@tiptap/core";
import {
	BackgroundColor,
	Color,
	TextStyle,
	type TextStyleOptions,
} from "@tiptap/extension-text-style";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import { restoreColorSourceHistory } from "./markdown-color-history";
import { colorPreviewPlugin } from "./markdown-color-preview";
import {
	colorSourcePlugin,
	MarkdownColorSource,
} from "./markdown-color-source";
import { readInlineHtml } from "./markdown-inline-html";
import {
	fontParents,
	inheritInlineStyles,
	inlineStyleAttribute,
	inlineStyleDeclarations,
	readInlineStyles,
	serializeInlineStyles,
} from "./markdown-inline-style";
import { inlineTagInputRule } from "./markdown-inline-tag-input";
import type { MarkdownSourceBlockReader } from "./markdown-source-patch";

// Unmatched span tags remain editable literal source, not executable HTML.
// Like HTML comments, code-mark serialization preserves their original bytes.
const MarkdownColorLiteral = Mark.create({
	name: "colorLiteral",
	code: true,
	excludes: "",
	inclusive: false,
	parseHTML: () => [
		{ tag: "span[data-color-literal]", preserveWhitespace: "full" },
	],
	renderHTML: () => ["span", { "data-color-literal": "" }, 0],
	renderMarkdown: (node, helpers) => helpers.renderChildren(node),
});

/** Marked owns escapes/code spans; count only actual HTML span tokens. */
function readColorSpan(source: string) {
	const span = readInlineHtml(source, "span");
	if (!span) return null;
	// The opening token is one span only. It cannot load a resource.
	const element = new DOMParser().parseFromString(
		`${span.opening}</span>`,
		"text/html",
	).body.firstElementChild as HTMLElement;
	return {
		...span,
		attrs: readInlineStyles(element),
		semantic: element.hasAttribute("data-type"),
	};
}

export const MarkdownTextStyle = TextStyle.extend<
	TextStyleOptions & { readSourceBlock?: MarkdownSourceBlockReader }
>({
	addExtensions() {
		return [
			...(this.parent?.() ?? []),
			MarkdownColorSource,
			MarkdownColorLiteral,
		];
	},
	markdownTokenName: "colorSpan",
	markdownTokenizer: {
		name: "colorSpan",
		level: "inline",
		start: (source) => source.search(/<\/?span\b/i),
		tokenize(source, _tokens, helpers) {
			const span = readColorSpan(source);
			if (span?.semantic)
				return { type: "colorSpan", raw: span.raw, html: true };
			if (!span?.text) {
				const raw =
					span?.raw ??
					/^<\/?span\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/i.exec(source)?.[0];
				return raw
					? { type: "colorSpan", raw, text: raw, literal: true, textSourceRange: { from: 0, to: raw.length } }
					: undefined;
			}
			return {
				...span,
				type: "colorSpan",
				tokens: helpers.inlineTokens(span.text, { from: span.opening.length, to: span.opening.length + span.text.length }),
			};
		},
	},
	parseMarkdown: (token, helpers) =>
		token.html
			? helpers.parseInline([
					{ type: "html", raw: token.raw, text: token.raw, block: false },
				])
			: token.literal
				? helpers.applyMark("colorLiteral", [
						helpers.createTokenText(token),
					])
				: inheritInlineStyles(
						helpers.parseInline(token.tokens ?? []),
						token.attrs as Record<string, unknown>,
						helpers.applyNodeMarks,
					),
	renderMarkdown(node, helpers) {
		const style = serializeInlineStyles(node.attrs);
		const text = helpers.renderChildren(node);
		return fontParents(node.attrs).reduceRight(
			(inner, font) =>
				`<span style="${serializeInlineStyles(font)}">${inner}</span>`,
			style ? `<span style="${style}">${text}</span>` : text,
		);
	},
	renderHTML({ mark, HTMLAttributes }) {
		return fontParents(mark.attrs).reduceRight<DOMOutputSpec>(
			(inner, font) => [
				"span",
				{ style: inlineStyleDeclarations(font) },
				inner,
			],
			["span", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0],
		);
	},
	addInputRules() {
		return [inlineTagInputRule(this.editor, this.type, "span")];
	},
	addProseMirrorPlugins() {
		return [
			...(this.parent?.() ?? []),
			colorPreviewPlugin(),
			colorSourcePlugin(this.editor, this.options.readSourceBlock),
		];
	},
	onTransaction({ editor, transaction }) {
		restoreColorSourceHistory(editor, transaction, this.options.readSourceBlock);
	},
}).configure({ mergeNestedSpanStyles: false });

// Keep official commands and schema attributes. Read only browser-validated CSS
// from native HTML paste as well; arbitrary style attributes never enter the DOM.
export const MarkdownColor = Color.extend({
	addGlobalAttributes() {
		return [
			{
				types: this.options.types,
				attributes: {
					color: inlineStyleAttribute("color"),
				},
			},
		];
	},
});

export const MarkdownBackgroundColor = BackgroundColor.extend({
	addGlobalAttributes() {
		return [
			{
				types: this.options.types,
				attributes: {
					backgroundColor: inlineStyleAttribute("backgroundColor"),
				},
			},
		];
	},
});
