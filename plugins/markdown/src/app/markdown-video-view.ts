import type { NodeViewRenderer } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { renderHtmlBlockPreview } from "./markdown-html-block-preview";
import { bindMediaResources } from "./markdown-media-resources";
import type { MarkdownMediaSourceResolver } from "./markdown-media-source";
import { htmlMediaNodeView } from "./markdown-media-view";
import { videoAttributesFromSource } from "./markdown-video-source";

export function videoNodeView(
	resolver: MarkdownMediaSourceResolver,
): NodeViewRenderer {
	return htmlMediaNodeView({
		className: "markdown-html-video",
		createMedia: () => document.createElement("div"),
		label: "HTML video preview",
		parseSource: videoAttributesFromSource,
		resolver,
		sourceLabel: "HTML video source",
		renderMedia: ({ element, node, resolver: sourceResolver, setNotice }) =>
			renderVideo(element, node, sourceResolver, setNotice),
	});
}

function renderVideo(
	element: HTMLElement,
	node: ProseMirrorNode,
	resolver: MarkdownMediaSourceResolver,
	setNotice: (message: string) => void,
): () => void {
	const video = renderHtmlBlockPreview(
		String(node.attrs.source),
	).fragment.querySelector("video");
	element.replaceChildren(...(video ? [video] : []));
	if (!video) {
		setNotice("Video source is invalid. HTML source is preserved.");
		return () => undefined;
	}
	video.controls = Boolean(node.attrs.controls);
	video.autoplay = Boolean(node.attrs.autoplay);
	video.loop = Boolean(node.attrs.loop);
	video.muted = Boolean(node.attrs.muted);
	video.playsInline = Boolean(node.attrs.playsinline);
	video.preload = node.attrs.preload ?? "metadata";
	for (const name of ["controlslist", "crossorigin"] as const) {
		const value = node.attrs[name];
		if (value) video.setAttribute(name, value);
		else video.removeAttribute(name);
	}
	for (const name of [
		"disablepictureinpicture",
		"disableremoteplayback",
	] as const) {
		video.toggleAttribute(name, Boolean(node.attrs[name]));
	}
	setVideoDimension(video, "width", node.attrs.width);
	setVideoDimension(video, "height", node.attrs.height);
	return bindMediaResources(video, resolver, setNotice);
}

function setVideoDimension(
	video: HTMLVideoElement,
	name: "height" | "width",
	value: unknown,
): void {
	const dimension = typeof value === "string" ? value.trim() : "";
	if (/^[1-9]\d{0,4}$/.test(dimension)) video.setAttribute(name, dimension);
	else video.removeAttribute(name);
}
