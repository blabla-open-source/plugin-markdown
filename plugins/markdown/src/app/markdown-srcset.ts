export interface SrcsetCandidate {
	url: string;
	descriptor: string;
}

const SPACE = /[\t\n\f\r ]/;

/** Srcset contains URLs; the Host relative-file API expects decoded paths. */
export function srcsetResourceSource(source: string): string {
	if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(source)) return source;
	try {
		const path = decodeURIComponent(source.split(/[?#]/, 1)[0] ?? "");
		// Do not reinterpret an encoded colon or leading slash as a URL authority.
		return source.startsWith("/")
			? `/${path.replace(/^\/+/, "")}`
			: `./${path}`;
	} catch {
		return "";
	}
}

/** WHATWG srcset token boundaries only. The browser still validates descriptors. */
export function splitSrcset(source: string): SrcsetCandidate[] {
	const candidates: SrcsetCandidate[] = [];
	let position = 0;
	while (position < source.length) {
		while (
			position < source.length &&
			(SPACE.test(source.charAt(position)) || source[position] === ",")
		)
			position++;
		const start = position;
		while (position < source.length && !SPACE.test(source.charAt(position)))
			position++;
		const url = source.slice(start, position);
		if (!url) break;
		if (url.endsWith(",")) {
			candidates.push({ url: url.replace(/,+$/, ""), descriptor: "" });
			continue;
		}
		const descriptorStart = position;
		let inParens = false;
		while (position < source.length) {
			const character = source[position];
			if (character === "," && !inParens) break;
			if (character === "(") inParens = true;
			if (character === ")") inParens = false;
			position++;
		}
		candidates.push({
			url,
			descriptor: source
				.slice(descriptorStart, position)
				.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, ""),
		});
		position++;
	}
	return candidates;
}
