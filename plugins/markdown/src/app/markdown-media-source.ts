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
	// The element owns only its bytes; the lexer handles following same-line content.
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

/** Intrinsic size the Host recorded for a library file, when it knows one. */
export type MarkdownMediaSize = { height: number; width: number };
type MarkdownMediaListener = (
	url: string | null,
	size?: MarkdownMediaSize,
) => void;

export class MarkdownMediaSourceResolver {
	private readonly cache = new Map<
		string,
		{ size?: MarkdownMediaSize; url: string }
	>();
	private readonly listeners = new Map<string, Set<MarkdownMediaListener>>();
	private readonly pending = new Set<string>();
	private scheduled = false;
	// Library files whose size the Host is still preparing, by reference id.
	private readonly awaitingSize = new Map<string, Set<string>>();
	private sizeWatch: { dispose(): void } | null = null;

	constructor(private readonly host: BlablaHostBridge) {}

	subscribe(source: string, listener: MarkdownMediaListener): () => void {
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
		const cached = this.cache.get(source);
		if (cached) listener(cached.url, cached.size);
		// A prior unsubscribe may have stopped the watch before preparation finished.
		if (!cached?.size) this.queue(source);
		return () => {
			subscriptions?.delete(listener);
			if (subscriptions?.size === 0) {
				this.listeners.delete(source);
				this.stopAwaitingSize(source);
			}
		};
	}

	// A freshly imported file resolves before its size is known; deliver the
	// size when the Host finishes preparing it, then stop listening.
	private awaitSize(file: string, referenceId: string): void {
		const files = this.awaitingSize.get(referenceId) ?? new Set();
		files.add(file);
		this.awaitingSize.set(referenceId, files);
		this.sizeWatch ??= this.host.fileReferences.onChanged((event) => {
			for (const reference of event.references) {
				const waiting = this.awaitingSize.get(reference.id);
				if (!(waiting && reference.width && reference.height)) continue;
				const size = { height: reference.height, width: reference.width };
				this.awaitingSize.delete(reference.id);
				for (const source of waiting) {
					const cached = this.cache.get(source);
					if (!cached) continue;
					cached.size = size;
					for (const listener of this.listeners.get(source) ?? [])
						listener(cached.url, size);
				}
			}
			this.releaseSizeWatch();
		});
	}

	private stopAwaitingSize(file: string): void {
		for (const [referenceId, files] of this.awaitingSize) {
			files.delete(file);
			if (files.size === 0) this.awaitingSize.delete(referenceId);
		}
		this.releaseSizeWatch();
	}

	private releaseSizeWatch(): void {
		if (this.awaitingSize.size > 0) return;
		this.sizeWatch?.dispose();
		this.sizeWatch = null;
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
		let resolved = new Map<
			string,
			{ referenceId: string; size?: MarkdownMediaSize; url: string | null }
		>();
		try {
			resolved = new Map(
				(await this.host.fileReferences.resolveDocumentFiles({ files })).map(
					({ file, reference }) => [
						file,
						{
							referenceId: reference.id,
							size:
								reference.width && reference.height
									? { height: reference.height, width: reference.width }
									: undefined,
							url: reference.sourceUrl,
						},
					],
				),
			);
		} catch {
			// An unavailable local source is UI state, not a document mutation.
		}
		for (const file of files) {
			const { referenceId, size, url = null } = resolved.get(file) ?? {};
			// A missing file may become available before the next preview subscribes.
			if (url) this.cache.set(file, { size, url });
			if (url && referenceId && !size && this.listeners.has(file))
				this.awaitSize(file, referenceId);
			for (const listener of this.listeners.get(file) ?? [])
				listener(url, size);
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
