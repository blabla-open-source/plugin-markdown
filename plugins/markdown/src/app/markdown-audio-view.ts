import type { NodeViewRenderer } from "@tiptap/core";
import { bindMediaResources } from "./markdown-media-resources";
import { audioAttributesFromSource } from "./markdown-audio-source";
import { renderHtmlBlockPreview } from "./markdown-html-block-preview";
import type { MarkdownMediaSourceResolver } from "./markdown-media-source";
import { htmlMediaNodeView } from "./markdown-media-view";

export function audioNodeView(
	resolver: MarkdownMediaSourceResolver,
): NodeViewRenderer {
	return htmlMediaNodeView({
		className: "markdown-html-audio",
		createMedia: () => document.createElement("div"),
		label: "HTML audio preview",
		parseSource: audioAttributesFromSource,
		resolver,
		sourceLabel: "HTML audio source",
		renderMedia: ({ element, node, resolver: sourceResolver, setNotice }) => {
			const audio = renderHtmlBlockPreview(
				String(node.attrs.source),
			).fragment.querySelector("audio");
			element.replaceChildren(...(audio ? [audio] : []));
			if (!audio) {
				setNotice("Audio source is invalid. HTML source is preserved.");
				return () => undefined;
			}
			audio.controls = Boolean(node.attrs.controls);
			audio.autoplay = Boolean(node.attrs.autoplay);
			audio.loop = Boolean(node.attrs.loop);
			audio.muted = Boolean(node.attrs.muted);
			audio.preload = node.attrs.preload ?? "metadata";
			for (const name of ["controlslist", "crossorigin"] as const) {
				const value = node.attrs[name];
				if (value) audio.setAttribute(name, value);
				else audio.removeAttribute(name);
			}
			audio.toggleAttribute(
				"disableremoteplayback",
				Boolean(node.attrs.disableremoteplayback),
			);
			return bindMediaResources(audio, sourceResolver, setNotice);
		},
	});
}
