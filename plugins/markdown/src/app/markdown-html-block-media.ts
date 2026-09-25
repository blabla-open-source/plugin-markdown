import { bindMediaResources } from "./markdown-media-resources";
import type { MarkdownMediaSourceResolver } from "./markdown-media-source";

export function mountHtmlBlockMedia(
	root: HTMLElement,
	resolver: MarkdownMediaSourceResolver,
) {
	const cleanups = [
		...root.querySelectorAll<HTMLMediaElement>("audio, video"),
	].map((media) => {
		const notice = document.createElement("span");
		notice.className = "markdown-html-media-notice";
		notice.setAttribute("role", "status");
		media.after(notice);
		// Audio gets controls, as in desktop Markdown editors; video keeps the author's controls attribute.
		if (media instanceof HTMLAudioElement) media.controls = true;
		media.autoplay = false;
		media.preload = "metadata";
		media.muted = media.hasAttribute("muted");
		media.setAttribute(
			"controlslist",
			`${media.getAttribute("controlslist") ?? ""} nodownload`.trim(),
		);
		const cleanup = bindMediaResources(media, resolver, (message) => {
			notice.textContent = message;
			notice.hidden = !message;
		});
		return () => {
			cleanup();
			notice.remove();
		};
	});
	return () => {
		for (const cleanup of cleanups) cleanup();
	};
}
