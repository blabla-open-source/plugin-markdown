import DOMPurify from "dompurify";
import {
	htmlAttribute,
	htmlMediaOpeningTag,
	readHtmlMediaBlock,
} from "./markdown-media-source";

export interface IframePreview {
	height: string;
	src: string | null;
	srcdoc: string | null;
	title: string;
	webUrl: string | null;
	width: string;
}

export function iframePreview(source: string): IframePreview {
	const opening =
		readHtmlMediaBlock(source, "iframe") === source
			? htmlMediaOpeningTag(source, "iframe")
			: "";
	const srcdoc = htmlAttribute(opening, "srcdoc");
	const src = htmlAttribute(opening, "src");
	const style = document.createElement("span").style;
	style.cssText = htmlAttribute(opening, "style") ?? "";
	return {
		height: dimension(
			style.height || htmlAttribute(opening, "height"),
			"300px",
		),
		src,
		srcdoc,
		title: htmlAttribute(opening, "title") || "Embedded webpage",
		webUrl: srcdoc === null ? iframeWebUrl(src) : null,
		width: dimension(style.width || htmlAttribute(opening, "width"), "100%"),
	};
}

export function iframeWebUrl(source: string | null): string | null {
	if (!source || !/^(?:https?:)?\/\//i.test(source.trim())) return null;
	try {
		const url = new URL(
			source.trim().startsWith("//") ? `https:${source.trim()}` : source.trim(),
		);
		return ["http:", "https:"].includes(url.protocol) &&
			!url.username &&
			!url.password
			? url.href
			: null;
	} catch {
		return null;
	}
}

export function isLocalIframeSource(source: string | null): source is string {
	if (!source?.trim() || source.trim().startsWith("//")) return false;
	const scheme = /^([a-z][a-z\d+.-]*):/i
		.exec(source.trim())?.[1]
		?.toLowerCase();
	return !scheme || scheme === "file" || scheme === "app-file";
}

export function staticIframeDocument(source: string): string {
	const content = DOMPurify.sanitize(source, {
		FORBID_TAGS: ["base", "meta", "form", "iframe", "object", "embed", "link"],
	});
	return `<!doctype html><html><head><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; base-uri about:; form-action 'none'"><base href="about:blank"></head><body>${content}</body></html>`;
}

function dimension(value: string | null, fallback: string): string {
	const text = value?.trim() ?? "";
	if (/^[1-9]\d{0,4}$/.test(text)) return `${text}px`;
	return /^(?:\d{1,5}(?:\.\d+)?)(?:px|%)$/.test(text) ? text : fallback;
}
