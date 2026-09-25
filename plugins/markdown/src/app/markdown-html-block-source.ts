import { Lexer } from "marked";
import { hasHtmlAttribute, htmlMediaOpeningTag } from "./markdown-media-source";

const DOCTYPE_START = "<!DOCTYPE(?:\\s|>)";
const SOURCE_ONLY_TAGS = [
	"script",
	"style",
	"meta",
	"noscript",
	"input",
	"template",
	"head",
	"canvas",
	"base",
	"title",
	"link",
	"embed",
] as const;
// Only these native clipboard elements own literal source. Ordinary div/section
// wrappers must still pass their children to the rich-text schema.
export const HTML_RAW_ELEMENT_TAGS = [
	"details",
	"center",
	"left",
	"right",
	"bdo",
	"dialog",
	"form",
	"select",
	"textarea",
	"object",
	"applet",
	"menu",
	"hr",
	"picture",
	"svg",
	...SOURCE_ONLY_TAGS,
] as const;
export const HTML_CONTAINER_TAGS = [
	"div",
	"section",
	"article",
	"header",
	"footer",
	"nav",
	"main",
	"aside",
	"address",
	"figure",
] as const;
// Markdown owns authored P, H1-H6, Table, and list source. Do not add these to
// parseHTML: rich clipboard content must keep using Tiptap's native schema nodes.
const MARKDOWN_ONLY_HTML_BLOCK_PATTERNS = [
	"p",
	"h[1-6]",
	"table",
	"ul",
	"ol",
	"dl",
] as const;
const HTML_BLOCK_TAGS = [
	...HTML_RAW_ELEMENT_TAGS,
	...HTML_CONTAINER_TAGS,
	...MARKDOWN_ONLY_HTML_BLOCK_PATTERNS,
	"img",
] as const;
export const HTML_BLOCK_START = new RegExp(
	`^ {0,3}(?:<!--|${DOCTYPE_START}|<\\/?(?:${HTML_BLOCK_TAGS.join("|")})(?:[\\s/>]|$))`,
	"i",
);
export const SOURCE_ONLY_HTML_START = new RegExp(
	`^\\s*(?:${DOCTYPE_START}|<\\/?(?:${SOURCE_ONLY_TAGS.join("|")})(?:[\\s/>]|$))`,
	"i",
);

/** Keep Marked's boundaries: rawtext uses a closing tag, other HTML a blank line. */
export function readHtmlBlock(source: string) {
	if (!HTML_BLOCK_START.test(source)) return null;
	// Only authored source sets need literal HTML; ordinary images keep Image.
	if (
		/^ {0,3}<img(?:[\s/>]|$)/i.test(source) &&
		!hasHtmlAttribute(htmlMediaOpeningTag(source, "img"), "srcset")
	)
		return null;
	// Preserve authored picture layouts, source-only containers, and legacy blocks.
	// Marked does not classify them with a desktop editor's HTML block bounds.
	if (
		/^ {0,3}<(?:\/?(?:picture|left|right|bdo|select|object|applet|noscript|template|canvas)|img)(?:[\s/>]|$)/i.test(
			source,
		)
	) {
		const boundary = /\r?\n[\t ]*(?:\r?\n|$)/.exec(source);
		const raw = boundary
			? source.slice(0, boundary.index + boundary[0].length)
			: source;
		return { raw, text: raw.trimEnd(), sourceEndsAtEof: false };
	}
	const token = new Lexer({ gfm: true }).blockTokens(source)[0];
	return token?.type === "html"
		? { raw: token.raw, text: token.raw.trimEnd(), sourceEndsAtEof: "sourceEndsAtEof" in token && token.sourceEndsAtEof === true }
		: null;
}

export function isSourceOnlyHtml(source: string): boolean {
	if (SOURCE_ONLY_HTML_START.test(source)) return true;
	const trimmed = source.trim();
	if (!trimmed.startsWith("<!--")) return false;
	const end = trimmed.indexOf("-->");
	return end < 0 || end + 3 === trimmed.length;
}
