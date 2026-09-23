import type { BlablaHostBridge } from "../host/host-api";

export type HtmlMediaTag = "audio" | "video" | "iframe";
export type HtmlMediaAttributeValue = boolean | null | string | undefined;

export const HTML_MEDIA_BLOCK_START =
	/^ {0,3}<(?:audio|video|iframe)(?:\s|>|$)/i;

export function htmlMediaTagAtStart(source: string): HtmlMediaTag | null {
	const tag = /^ {0,3}<(audio|video|iframe)(?:\s|>|$)/i
		.exec(source)?.[1]
		?.toLowerCase();
	return tag === "audio" || tag === "video" || tag === "iframe" ? tag : null;
}

export function readHtmlMediaBlock(
	source: string,
	tag: HtmlMediaTag,
): string | null {
	if (htmlMediaTagAtStart(source) !== tag) return null;
	const openingEnd = htmlTagEnd(
		source,
		source.search(new RegExp(`<${tag}`, "i")),
	);
	if (openingEnd < 0) return null;
	const opening = source.slice(0, openingEnd + 1);
	if (/\/\s*>$/.test(opening)) return source.slice(0, openingEnd + 1);
	const closing = new RegExp(`</${tag}\\s*>`, "i").exec(
		source.slice(openingEnd + 1),
	);
	if (!closing) return null;
	const end = openingEnd + 1 + closing.index + closing[0].length;
	if (source[end] && source[end] !== "\n" && source[end] !== "\r") return null;
	return source.slice(0, end);
}

export function htmlMediaOpeningTag(
	source: string,
	tag: HtmlMediaTag | "img",
): string {
	const start = source.search(new RegExp(`<${tag}(?:\\s|>)`, "i"));
	const end = start < 0 ? -1 : htmlTagEnd(source, start);
	return end < 0 ? "" : source.slice(start, end + 1);
}

export function hasHtmlAttribute(source: string, name: string): boolean {
	return htmlAttribute(source, name) !== null;
}

export function htmlAttribute(source: string, name: string): string | null {
	// Consume complete quoted values: srcdoc text is not an outer attribute.
	const attributes = source.matchAll(
		/\s+([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
	);
	for (const match of attributes) {
		if (match[1]?.toLowerCase() === name.toLowerCase())
			return decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? "");
	}
	return null;
}

export function isSafeMediaSource(source: string): boolean {
	if (!source.trim()) return false;
	const scheme = /^([a-z][a-z\d+.-]*):/i.exec(source)?.[1]?.toLowerCase();
	return !scheme || ["app-file", "file", "http", "https"].includes(scheme);
}

export function serializeHtmlMediaElement(
	tag: HtmlMediaTag,
	attributes: [string, HtmlMediaAttributeValue][],
): string | null {
	const src = attributes.find(([name]) => name === "src")?.[1];
	if (typeof src !== "string" || !isSafeMediaSource(src)) return null;
	const serialized = attributes.flatMap(([name, value]) => {
		if (value === true) return [name];
		if (typeof value === "string")
			return [`${name}="${encodeHtmlAttribute(value)}"`];
		return [];
	});
	return `<${tag} ${serialized.join(" ")}></${tag}>`;
}

export class MarkdownMediaSourceResolver {
	private readonly cache = new Map<string, string>();
	private readonly listeners = new Map<
		string,
		Set<(url: string | null) => void>
	>();
	private readonly pending = new Set<string>();
	private scheduled = false;

	constructor(private readonly host: BlablaHostBridge) {}

	subscribe(
		source: string,
		listener: (url: string | null) => void,
	): () => void {
		const direct = directMediaUrl(source);
		if (direct !== undefined) {
			listener(direct);
			return () => undefined;
		}
		let subscriptions = this.listeners.get(source);
		if (!subscriptions) {
			subscriptions = new Set();
			this.listeners.set(source, subscriptions);
		}
		subscriptions.add(listener);
		if (this.cache.has(source)) listener(this.cache.get(source) ?? null);
		else this.queue(source);
		return () => {
			subscriptions?.delete(listener);
			if (subscriptions?.size === 0) this.listeners.delete(source);
		};
	}

	private queue(source: string): void {
		this.pending.add(source);
		if (this.scheduled) return;
		this.scheduled = true;
		queueMicrotask(() => void this.flush());
	}

	private async flush(): Promise<void> {
		this.scheduled = false;
		const files = [...this.pending];
		this.pending.clear();
		if (files.length === 0) return;
		let resolved = new Map<string, string | null>();
		try {
			resolved = new Map(
				(await this.host.fileReferences.resolveDocumentFiles({ files })).map(
					({ file, reference }) => [file, reference.sourceUrl],
				),
			);
		} catch {
			// An unavailable local source is UI state, not a document mutation.
		}
		for (const file of files) {
			const url = resolved.get(file) ?? null;
			// A missing file may become available before the next preview subscribes.
			if (url) this.cache.set(file, url);
			for (const listener of this.listeners.get(file) ?? []) listener(url);
		}
	}
}

function directMediaUrl(source: string): string | null | undefined {
	const value = source.trim();
	if (!value) return null;
	if (/^app-file:\/\//i.test(value) || /^https?:\/\//i.test(value))
		return value;
	if (value.startsWith("//")) return `https:${value}`;
	if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^file:/i.test(value)) return null;
	return undefined;
}

function encodeHtmlAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function htmlTagEnd(source: string, start: number): number {
	let quote = "";
	for (let index = start; index < source.length; index += 1) {
		const character = source[index] ?? "";
		if (quote) {
			if (character === quote) quote = "";
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === ">") return index;
	}
	return -1;
}

function decodeHtmlAttribute(value: string): string {
	return value.replace(
		/&(?:#(\d+)|#x([\da-f]+)|amp|quot|apos|lt|gt);/gi,
		(entity, decimal: string | undefined, hexadecimal: string | undefined) => {
			if (decimal || hexadecimal) {
				const point = decimal
					? Number(decimal)
					: Number.parseInt(hexadecimal ?? "", 16);
				return Number.isInteger(point) &&
					point > 0 &&
					point <= 0x10ffff &&
					!(point >= 0xd800 && point <= 0xdfff)
					? String.fromCodePoint(point)
					: "\uFFFD";
			}
			return (
				{
					"&amp;": "&",
					"&apos;": "'",
					"&gt;": ">",
					"&lt;": "<",
					"&quot;": '"',
				}[entity.toLowerCase()] ?? entity
			);
		},
	);
}
