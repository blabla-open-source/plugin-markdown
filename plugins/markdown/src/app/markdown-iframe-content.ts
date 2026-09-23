import type { BlablaHostBridge } from "../host/host-api";
import {
	type IframePreview,
	isLocalIframeSource,
	staticIframeDocument,
} from "./markdown-iframe-preview";
import type { MarkdownMediaSourceResolver } from "./markdown-media-source";

/** Shared preview policy for standalone frames and frames inside literal HTML. */
export function mountIframePreview(
	element: HTMLElement,
	preview: IframePreview,
	resolver: MarkdownMediaSourceResolver,
	navigation: BlablaHostBridge["navigation"],
	setNotice: (message: string) => void,
) {
	const frame = document.createElement("iframe");
	frame.title = preview.title;
	frame.referrerPolicy = "no-referrer";
	frame.setAttribute("sandbox", preview.webUrl ? "allow-scripts" : "");
	frame.allow =
		"camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; fullscreen 'none'";
	element.style.width = preview.width;
	frame.style.width = "100%";
	frame.style.height = preview.height;
	frame.hidden = true;
	const open = document.createElement("button");
	open.type = "button";
	open.className = "markdown-iframe-open";
	open.setAttribute("aria-label", "Open in Blabla");
	open.title = "Open webpage in Blabla";
	open.hidden = !preview.webUrl;
	let disposed = false;
	const openPage = async (event: MouseEvent) => {
		event.stopPropagation();
		if (disposed || !preview.webUrl) return;
		open.disabled = true;
		delete open.dataset.openFailed;
		setNotice("");
		try {
			await navigation.openWebPage({ url: preview.webUrl });
		} catch {
			if (!disposed) {
				open.dataset.openFailed = "true";
				setNotice("Could not open webpage in Blabla. Try again.");
			}
		} finally {
			if (!disposed) open.disabled = false;
		}
	};
	open.addEventListener("click", openPage);
	element.classList.add("markdown-iframe-content");
	element.replaceChildren(open, frame);
	setNotice("");
	let unsubscribe: () => void = () => undefined;
	if (preview.srcdoc !== null) {
		frame.srcdoc = staticIframeDocument(preview.srcdoc);
		frame.hidden = false;
	} else if (preview.webUrl) {
		frame.src = preview.webUrl;
		frame.hidden = false;
	} else if (isLocalIframeSource(preview.src)) {
		setNotice("Resolving embedded HTML…");
		unsubscribe = resolver.subscribe(preview.src, (url) => {
			if (disposed) return;
			if (url?.startsWith("app-file://")) {
				frame.src = url;
				frame.hidden = false;
				setNotice("");
			} else
				setNotice("Iframe source is unavailable. HTML source is preserved.");
		});
	} else setNotice("Iframe source is invalid. HTML source is preserved.");
	return () => {
		disposed = true;
		unsubscribe();
		open.removeEventListener("click", openPage);
		frame.remove();
	};
}
