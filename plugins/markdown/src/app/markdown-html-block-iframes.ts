import type { BlablaHostBridge } from "../host/host-api";
import { mountIframePreview } from "./markdown-iframe-content";
import { type IframePreview, iframePreview } from "./markdown-iframe-preview";
import type { MarkdownMediaSourceResolver } from "./markdown-media-source";

const previews = new WeakMap<HTMLIFrameElement, IframePreview>();

/** Never attach author-controlled srcdoc or sandbox attributes to the editor. */
export function captureHtmlBlockIframe(element: Element): void {
	if (!(element instanceof HTMLIFrameElement)) return;
	previews.set(element, iframePreview(element.outerHTML));
	element.removeAttribute("src");
	element.removeAttribute("srcdoc");
	element.setAttribute("sandbox", "");
}

export function mountHtmlBlockIframes(
	root: HTMLElement,
	resolver: MarkdownMediaSourceResolver,
	navigation: BlablaHostBridge["navigation"],
) {
	const cleanups = [...root.querySelectorAll("iframe")].map((placeholder) => {
		const preview = previews.get(placeholder);
		if (!preview) return () => undefined;
		const wrapper = document.createElement("div");
		wrapper.setAttribute("aria-label", "HTML iframe preview");
		const content = document.createElement("div");
		const notice = document.createElement("div");
		notice.className = "markdown-html-media-notice";
		notice.setAttribute("role", "status");
		wrapper.append(content, notice);
		placeholder.replaceWith(wrapper);
		const cleanup = mountIframePreview(
			content,
			preview,
			resolver,
			navigation,
			(message) => {
				notice.textContent = message;
			},
		);
		return () => {
			cleanup();
			wrapper.remove();
		};
	});
	return () => {
		for (const cleanup of cleanups) cleanup();
	};
}
