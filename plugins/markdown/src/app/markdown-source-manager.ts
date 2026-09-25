import type { SourceBoundary } from "marked";
import { generateTocIds } from "@tiptap/extension-table-of-contents";
import stringWidth from "string-width";
import {
	callOrReturn,
	flattenExtensions,
	getExtensionField,
	getHTMLFromFragment,
	type JSONContent,
	type MarkdownParseHelpers,
	type MarkdownToken,
} from "@tiptap/core";
import { Fragment, type Schema } from "@tiptap/pm/model";
import { assumeContentType, Markdown, MarkdownManager } from "@tiptap/markdown";
import {
	protectInactiveAutolinks,
	renderAutomaticLink,
} from "./markdown-autolinks";
import { protectAlertSource } from "./markdown-alert-source";
import { EMOJI_SHORTCODE, emojiByShortcode } from "./markdown-emoji-data";
import {
	type InlineFormatPreferences,
	protectInlineFormatLiterals,
} from "./markdown-inline-formats";
import { protectInlineHtmlLiteralSource } from "./markdown-inline-html-literal";
import { fontParents, serializeInlineStyles } from "./markdown-inline-style";
import { renderInlineMath } from "./markdown-math-source";
import { protectWordBreakSource } from "./markdown-word-break";
import { renderInlineCode } from "./markdown-inline-code";
import { markdownLexicalSource } from "./markdown-lexical-source";
import { MarkdownParseSource, type MarkdownParsedSource } from "./markdown-parse-source";
import { parseMarkdownHTMLSource } from "./markdown-html-source";
import { MarkdownSerializedPoint } from "./markdown-serialized-point";

/**
 * Tiptap 3.27 has no text-escaping hook and drops marks on inline atoms.
 * Project inline atoms to protected text only while serializing. Upstream owns
 * mark boundaries, indentation and escaping. No token enters editor/Host state.
 */
export class MarkdownSourceManager extends MarkdownManager {
	private serializedPoint?: MarkdownSerializedPoint;

	serializeSourcePoint(parent: JSONContent, node: JSONContent, offset: number | "end", preserveWhitespace = false) {
		if (this.serializedPoint) throw new Error("Source point serialization is already active.");
		const point = new MarkdownSerializedPoint(offset, preserveWhitespace);
		const release = point.bind(parent, node);
		this.serializedPoint = point;
		try {
			return point.finish(this.serialize(parent));
		} finally {
			release();
			this.serializedPoint = undefined;
		}
	}

	protected override onRenderNode(node: JSONContent, _parent: JSONContent | undefined, from: number, to: number) {
		this.serializedPoint?.observe(node, from, to);
	}

	protected override collapseEmptyOutput() { return !this.serializedPoint?.preserveWhitespace; }

	protected override onRenderEmpty() {
		this.serializedPoint?.empty();
	}

	protected override getRenderTextPosition(node: JSONContent, input: string) {
		return this.serializedPoint?.textPosition(node, input);
	}
	private readonly sourceSchema: Schema;
	private readonly sourceNodeSize: (node: JSONContent) => number;
	private readonly sourceParses: MarkdownParseSource[];
	private openingSource?: MarkdownParsedSource;
	private readonly literalTypes: Set<string>;
	private readonly dollarMath: boolean;
	private readonly autoLink: boolean;
	private readonly inlineFormats: InlineFormatPreferences;
	private readonly renderHtml: (node: JSONContent) => string;
	constructor(
		options: NonNullable<ConstructorParameters<typeof MarkdownManager>[0]>,
		schema: Schema,
	) {
		const sourceParses: MarkdownParseSource[] = [];
		super({ ...options, onParse(event) {
			sourceParses.at(-1)?.observe(event);
			options.onParse?.(event);
		} });
		this.sourceParses = sourceParses;
		this.sourceSchema = schema;
		this.sourceNodeSize = (node) => {
			const type = schema.nodes[node.type ?? ""];
			if (!type) throw new Error(`Unknown parsed Markdown node: ${node.type}`);
			if (type.isText) return node.text?.length ?? 0;
			if (type.isLeaf) return 1;
			return 2 + (node.content ?? []).reduce((size, child) => size + this.sourceNodeSize(child), 0);
		};
		this.renderHtml = (node) => {
			return getHTMLFromFragment(
				Fragment.from(schema.nodeFromJSON(node)),
				schema,
			);
		};
		const enabled = (name: string) =>
			flattenExtensions(options.extensions).find(
				(extension) => extension.name === name,
			)?.options.syntaxEnabled !== false;
		this.inlineFormats = {
			highlight: enabled("highlight"),
			subscript: enabled("subscript"),
			superscript: enabled("superscript"),
		};
		this.autoLink =
			flattenExtensions(options.extensions).find(
				(extension) => extension.name === "link",
			)?.options.autolink !== false;
		this.dollarMath =
			flattenExtensions(options.extensions).find(
				(extension) => extension.name === "inlineMath",
			)?.options.enableDollarMath !== false;
		this.literalTypes = new Set(
			flattenExtensions(options.extensions)
				.filter((extension) =>
					callOrReturn(getExtensionField(extension, "code")),
				)
				.map((extension) => extension.name),
		);
	}

	protected override parseHTMLContent(html: string, token: MarkdownToken): JSONContent {
		const parsed = parseMarkdownHTMLSource(html, this.sourceSchema);
		this.sourceParses.at(-1)?.recordHTML(token, html, parsed.text);
		return parsed.doc;
	}

	parseSource(markdown: string, boundary?: SourceBoundary): MarkdownParsedSource {
		const lexical = markdownLexicalSource(this.instance);
		const source = new MarkdownParseSource(lexical, this.sourceNodeSize);
		this.sourceParses.push(source);
		try {
			return lexical.capture(() => source.finish(markdown, this.parse(markdown, boundary)));
		} finally {
			this.sourceParses.pop();
		}
	}

	prepareOpeningSource(markdown: string): JSONContent {
		this.openingSource = this.parseSource(markdown);
		return this.openingSource.doc;
	}

	takeOpeningSource(): MarkdownParsedSource {
		const source = this.openingSource;
		if (!source) throw new Error("Markdown opening has no parsed source document.");
		this.openingSource = undefined;
		return source;
	}
	override parse(markdown: string, boundary?: SourceBoundary): JSONContent {
		const restore = (node: JSONContent): JSONContent => {
			if (node.type === "emoji" || node.type === "inlineMath") {
				const marks = node.marks ?? node.content?.[0]?.marks;
				return {
					type: node.type,
					attrs: node.attrs,
					...(marks?.length ? { marks } : {}),
				};
			}
			return node.content
				? { ...node, content: node.content.map(restore) }
				: node;
		};
		return restore(super.parse(markdown, boundary));
	}

	override serialize(document: JSONContent): string {
		const point = this.serializedPoint;
		if (point) point.depth++;
		try {
			return this.serializeDocument(document);
		} finally {
			if (point) point.depth--;
		}
	}

	private serializeDocument(document: JSONContent): string {
		// Collision-free even when users write about this serializer in their file.
		const source = JSON.stringify(document);
		let prefix = "BlablaMarkdownSlotQ";
		while (source.includes(prefix)) prefix += "Q";
		const fragments: string[] = [];
		const protect = (value: string) => `${prefix}${fragments.push(value) - 1}Q`;
		const hasDisabledFormat = (node: JSONContent) =>
			node.marks?.some((mark) =>
				Object.entries(this.inlineFormats).some(
					([name, enabled]) => !enabled && mark.type === name,
				),
			);
		const coloredEdges = (node: JSONContent): JSONContent[] => {
			const color = node.marks?.find((mark) => mark.type === "textStyle");
			if (
				hasDisabledFormat(node) ||
				node.type !== "text" ||
				!node.text ||
				!color ||
				(!serializeInlineStyles(color.attrs) &&
					!fontParents(color.attrs).length) ||
				node.marks?.some((mark) => this.literalTypes.has(mark.type))
			)
				return [node];
			const leading = node.text.match(/^\s+/)?.[0] ?? "";
			const rest = node.text.slice(leading.length);
			const trailing = rest.match(/\s+$/)?.[0] ?? "";
			const middle = rest.slice(0, rest.length - trailing.length);
			// Markdown emphasis cannot enclose edge spaces. HTML color can.
			return [
				...(leading
					? [{ type: "text", text: protect(leading), marks: [color] }]
					: []),
				...(middle ? [{ ...node, text: middle }] : []),
				...(trailing
					? [{ type: "text", text: protect(trailing), marks: [color] }]
					: []),
			];
		};
		const project = (node: JSONContent, parent?: JSONContent, inTable = false): JSONContent => {
			if (node.type === "heading" && node.attrs?.proseStyle?.heading === "wide-setext") {
				const inlineSource = this.serialize({ type: "doc", content: [{ type: "paragraph", content: node.content }] });
				node = { ...node, attrs: { ...node.attrs, proseStyle: { ...node.attrs.proseStyle, underline: stringWidth(inlineSource) } } };
			}
			// HTML formats need HTML text escaping and nested marks, not Markdown
			// delimiters inside an HTML wrapper. The installed schema owns both.
			if (hasDisabledFormat(node))
				return { type: "text", text: protect(this.renderHtml(node)) };
			if (node.type === "text" && node.marks?.some((mark) => mark.type === "code")) {
				const text = node.text ?? "";
				// GFM cannot represent an odd backslash run before a pipe inside a
				// code span. Schema HTML preserves that text without splitting cells.
				const html = inTable && text.includes("\\|");
				const code = html
					? this.renderHtml({ ...node, marks: node.marks.filter((mark) => mark.type === "code") }).replaceAll("|", "&#124;")
					: renderInlineCode(text);
				return {
					...node,
					text: protect(inTable && !html ? code.replaceAll("|", "\\|") : code),
					marks: node.marks.filter((mark) => mark.type !== "code"),
				};
			}
			const link = node.marks?.find((mark) => mark.type === "link");
			if (
				node.type === "text" &&
				link &&
				!link.attrs?.htmlLink &&
				!link.attrs?.title
			) {
				const automatic = renderAutomaticLink(
					link.attrs?.autoLinkSyntax,
					node.text ?? "",
					String(link.attrs?.href ?? ""),
				);
				if (automatic)
					return {
						...node,
						text: protect(automatic),
						marks: node.marks?.filter((mark) => mark !== link),
					};
			}
			node = protectAlertSource(node, protect);
			if (node.type === "emoji" || node.type === "inlineMath")
				return {
					type: "text",
					marks: node.marks,
					text: protect(
						node.type === "emoji"
							? `:${node.attrs?.name}:`
							: renderInlineMath(node, this.dollarMath),
					),
				};
			if (
				this.literalTypes.has(node.type ?? "") ||
				this.literalTypes.has(parent?.type ?? "") ||
				node.marks?.some((mark) => this.literalTypes.has(mark.type))
			)
				return node;
			if (node.type === "text" && !this.autoLink && !link)
				node = {
					...node,
					text: protectInactiveAutolinks(node.text ?? "", protect),
				};
			if (node.type === "text")
				return {
					...node,
					// Preserve editor-literal inline HTML before Tiptap escapes it. Bracket
					// entities keep legacy math delimiters literal across mark boundaries.
					text: protectInlineFormatLiterals(
						protectInlineHtmlLiteralSource(
							protectWordBreakSource(node.text ?? "", protect),
							protect,
						),
						this.inlineFormats,
						protect,
					)
						.replace(/[[\]$]/g, (value, index: number, text: string) => {
							if (value !== "$")
								return protect(value === "[" ? "&#91;" : "&#93;");
							const needsEscape =
								this.dollarMath ||
								text[index - 1] === "$" ||
								text[index + 1] === "$";
							return protect(needsEscape ? "\\$" : "$");
						})
						.replace(EMOJI_SHORTCODE, (raw, name: string) =>
							emojiByShortcode.has(name) ? protect(`\\${raw}`) : raw,
						),
				};
			if (!node.content) return node;
			const children: JSONContent[] = [];
			for (const child of node.content) {
				const previous = children.at(-1);
				if (
					child.type === "text" &&
					previous?.type === "text" &&
					JSON.stringify(child.marks) === JSON.stringify(previous.marks)
				)
					previous.text = (previous.text ?? "") + child.text;
				else children.push({ ...child });
			}
			return {
				...node,
				content: children
					.flatMap(coloredEdges)
					.map((child) => project(child, node, inTable || node.type === "table")),
			};
		};
		return super
			.serialize(project(document))
			.replace(
				new RegExp(`${prefix}(\\d+)Q`, "g"),
				(token, index: string, from: number) => {
					const value = fragments[Number(index)] ?? "";
					this.serializedPoint?.replace(from, token.length, value.length);
					return value;
				},
			);
	}
}

export const SourceMarkdown = Markdown.extend({
	// Tiptap 3.27's entity decoder handles only lt/gt/quot/amp. Decode the
	// standard bracket entities emitted above before they become text nodes.
	markdownTokenName: "literalBracket",
	markdownTokenizer: {
		name: "literalBracket",
		level: "inline",
		start: (source: string) => source.search(/&#(?:91|93);/),
		tokenize(source: string) {
			const match = /^&#(91|93);/.exec(source);
			return match
				? {
						type: "literalBracket",
						raw: match[0],
						text: String.fromCharCode(Number(match[1])),
					}
				: undefined;
		},
	},
	parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers) =>
		helpers.createTextNode(token.text ?? ""),
	onBeforeCreate() {
		const manager = new MarkdownSourceManager({
			...this.options,
			extensions: this.editor.extensionManager.baseExtensions,
		}, this.editor.schema);
		this.storage.manager = manager;
		this.editor.markdown = manager;
		this.editor.getMarkdown = () => manager.serialize(this.editor.getJSON());
		const { content, contentType } = this.editor.options;
		if (!contentType || assumeContentType(content, contentType) !== "markdown")
			return;
		if (typeof content !== "string")
			throw new TypeError("Markdown content must be a string");
		const parsed = manager.prepareOpeningSource(content);
		// Prepare generated anchors before the live source/history plugins mount.
		// The official onCreate path otherwise emits one markup step per heading.
		if (parsed.content?.length)
			this.editor.options.content = generateTocIds(
				parsed,
				this.editor.extensionManager.extensions,
			);
	},
});
