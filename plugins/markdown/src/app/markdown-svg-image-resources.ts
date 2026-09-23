import type { MarkdownMediaSourceResolver } from "./markdown-media-source";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const sources = new WeakMap<Element, string>();

/** Author URLs stay out of the live SVG until the resource owner resolves them. */
export function captureSvgImageSource(element: Element): void {
	if (
		element.namespaceURI !== SVG_NAMESPACE ||
		element.localName.toLowerCase() !== "image"
	)
		return;
	const source =
		element.getAttribute("href") ??
		element.getAttributeNS(XLINK_NAMESPACE, "href") ??
		element.getAttribute("xlink:href") ??
		"";
	sources.set(element, source);
	element.removeAttribute("href");
	element.removeAttributeNS(XLINK_NAMESPACE, "href");
	element.removeAttribute("xlink:href");
}

export function mountHtmlBlockSvgImages(
	root: HTMLElement,
	resolver: MarkdownMediaSourceResolver,
): () => void {
	const cleanups = [...root.querySelectorAll<SVGImageElement>("svg image")].map(
		(image) => {
			const notice = document.createElement("span");
			notice.className = "markdown-svg-image-notice";
			notice.setAttribute("role", "status");
			notice.hidden = true;
			image.closest("svg")?.after(notice);
			const loaded = () => {
				notice.textContent = "";
				notice.hidden = true;
			};
			const failed = () => {
				notice.hidden = false;
				notice.textContent =
					"SVG image is unavailable. HTML source is preserved.";
			};
			image.addEventListener("load", loaded);
			image.addEventListener("error", failed);
			const unsubscribe = resolver.subscribe(sources.get(image) ?? "", (url) => {
				if (url) image.setAttribute("href", url);
				else failed();
			});
			return () => {
				unsubscribe();
				image.removeEventListener("load", loaded);
				image.removeEventListener("error", failed);
				image.removeAttribute("href");
				notice.remove();
			};
		},
	);
	return () => {
		for (const cleanup of cleanups) cleanup();
	};
}
