import type { MarkdownMediaSourceResolver } from "./markdown-media-source";
import { bindImageResources } from "./markdown-image-resources";

export function mountHtmlBlockImages(
	root: HTMLElement,
	resolver: MarkdownMediaSourceResolver,
): () => void {
	const cleanups = [...root.querySelectorAll("img")].map((image) => {
		const notice = document.createElement("span");
		notice.className = "markdown-html-image-notice";
		notice.setAttribute("role", "status");
		notice.hidden = true;
		image.after(notice);
		image.referrerPolicy = "no-referrer";
		image.decoding = "async";
		const loaded = () => {
			notice.textContent = "";
			notice.hidden = true;
		};
		const failed = () => {
			notice.hidden = false;
			notice.textContent = `Image unavailable: ${image.alt || "image"}. HTML source is preserved.`;
		};
		image.addEventListener("load", loaded);
		image.addEventListener("error", failed);
		const cleanup = bindImageResources(image, resolver, failed);
		return () => {
			image.removeEventListener("load", loaded);
			image.removeEventListener("error", failed);
			cleanup();
			notice.remove();
		};
	});
	return () => {
		for (const cleanup of cleanups) cleanup();
	};
}
