import { decodeHtmlEntities } from "@tiptap/core";
import { Lexer } from "marked";

/** Markdown's lexer leaves entities in attributes; decode before URI checks. */
export function decodeLinkAttribute(value: string) {
	if (!value.includes("&")) return value;
	// Match upstream's text-only behavior when no browser DOM is available.
	if (typeof DOMParser === "undefined") return decodeHtmlEntities(value);
	const escaped = value
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
	return (
		new DOMParser()
			.parseFromString(`<a title="${escaped}"></a>`, "text/html")
			.body.firstElementChild?.getAttribute("title") ?? ""
	);
}

/** Marked distinguishes real tags from escaped tags and code spans. */
export function readHtmlLink(source: string) {
	if (!/^<a(?:\s|>)/i.test(source) || typeof DOMParser === "undefined")
		return null;
	let opening = "";
	let offset = 0;
	for (const token of new Lexer({ gfm: true }).inlineTokens(source)) {
		if (!offset) opening = token.raw;
		else if (token.type === "html" && /^<a(?:\s|>)/i.test(token.raw))
			return null; // Nested anchors are invalid HTML, not nested marks.
		offset += token.raw.length;
		if (token.type !== "html" || !/^<\/a\s*>$/i.test(token.raw)) continue;
		const element = new DOMParser().parseFromString(
			`${opening}</a>`,
			"text/html",
		).body.firstElementChild;
		if (!element) return null;
		return {
			raw: source.slice(0, offset),
			textFrom: opening.length,
			text: source.slice(opening.length, offset - token.raw.length),
			href: element.getAttribute("href"),
			id: element.getAttribute("id"),
			name: element.getAttribute("name"),
			title: element.getAttribute("title"),
			target: element.getAttribute("target"),
		};
	}
	return null;
}

export function escapeLinkAttribute(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
