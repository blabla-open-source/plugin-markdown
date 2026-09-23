import type { MarkdownMediaSourceResolver } from "./markdown-media-source";
import { splitSrcset, srcsetResourceSource } from "./markdown-srcset";

const sources = new WeakMap<HTMLImageElement, string>();
const sourceSets = new WeakMap<HTMLImageElement, string>();
const IMAGE_DATA_URL =
	/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|svg\+xml)[;,]/i;

/** Author URLs stay out of the live DOM until the resource owner resolves them. */
export function captureImageSources(element: Element): void {
	if (!(element instanceof HTMLImageElement)) return;
	sourceSets.set(element, element.getAttribute("srcset") ?? "");
	element.removeAttribute("srcset");
	sources.set(element, element.getAttribute("src") ?? "");
	element.removeAttribute("src");
}

export function bindImageResources(
	image: HTMLImageElement,
	resolver: MarkdownMediaSourceResolver,
	failed: () => void,
) {
	const candidates = splitSrcset(sourceSets.get(image) ?? "");
	const original = sources.get(image)?.trim() ?? "";
	const candidateSources = new Set(
		candidates.map((candidate) => candidate.url),
	);
	const urls = new Map<string, string | null | undefined>([
		[original, undefined],
		...[...candidateSources].map((url) => [url, undefined] as const),
	]);
	let disposed = false;
	let subscribing = true;
	const render = () => {
		if (disposed || subscribing || [...urls.values()].includes(undefined))
			return;
		// Apply the image's complete source set together. Never load src while
		// a local srcset candidate is still being resolved by the Host.
		const srcset = candidates
			.flatMap((candidate) => {
				const url = urls.get(candidate.url);
				if (!url) return [];
				const encoded = url.replace(/[\t\n\f\r ]/g, encodeURIComponent);
				return [
					candidate.descriptor ? `${encoded} ${candidate.descriptor}` : encoded,
				];
			})
			.join(", ");
		if (srcset) image.setAttribute("srcset", srcset);
		else image.removeAttribute("srcset");
		const src = urls.get(original);
		if (src) image.src = src;
		else image.removeAttribute("src");
		if (!src && !srcset) failed();
	};
	const cleanups = [...urls.keys()].map((source) => {
		const resolved = (url: string | null) => {
			if (disposed) return;
			urls.set(source, url);
			render();
		};
		if (IMAGE_DATA_URL.test(source)) {
			resolved(source);
			return () => undefined;
		}
		return resolver.subscribe(
			candidateSources.has(source) ? srcsetResourceSource(source) : source,
			resolved,
		);
	});
	subscribing = false;
	render();
	return () => {
		disposed = true;
		for (const cleanup of cleanups) cleanup();
		image.removeAttribute("srcset");
		image.removeAttribute("src");
	};
}
