import {
	hasHtmlAttribute,
	htmlAttribute,
	htmlMediaOpeningTag,
	isSafeMediaSource,
	readHtmlMediaBlock,
	serializeHtmlMediaElement,
} from "./markdown-media-source";

export const HTML_VIDEO_BLOCK_START = /^ {0,3}<video(?:\s|>)/i;

export interface MarkdownVideoAttributes {
	autoplay: boolean;
	controls: boolean;
	controlslist: string | null;
	crossorigin: "" | "anonymous" | "use-credentials" | null;
	disablepictureinpicture: boolean;
	disableremoteplayback: boolean;
	height: string | null;
	loop: boolean;
	muted: boolean;
	playsinline: boolean;
	poster: string | null;
	preload: "auto" | "metadata" | "none" | null;
	source: string;
	src: string | null;
	width: string | null;
}

export interface MarkdownVideoCommandOptions {
	autoplay?: boolean;
	controls?: boolean;
	controlslist?: string;
	crossorigin?: "" | "anonymous" | "use-credentials";
	disablepictureinpicture?: boolean;
	disableremoteplayback?: boolean;
	height?: string;
	loop?: boolean;
	muted?: boolean;
	playsinline?: boolean;
	poster?: string;
	preload?: "auto" | "metadata" | "none" | null;
	src: string;
	width?: string;
}

export function readHtmlVideoBlock(source: string): string | null {
	return readHtmlMediaBlock(source, "video");
}

export function videoAttributesFromSource(
	source: string,
): MarkdownVideoAttributes {
	const opening = htmlMediaOpeningTag(source, "video");
	const preload = htmlAttribute(opening, "preload");
	const crossorigin = htmlAttribute(opening, "crossorigin");
	return {
		autoplay: hasHtmlAttribute(opening, "autoplay"),
		controls: hasHtmlAttribute(opening, "controls"),
		controlslist: htmlAttribute(opening, "controlslist"),
		crossorigin:
			crossorigin === "" ||
			crossorigin === "anonymous" ||
			crossorigin === "use-credentials"
				? crossorigin
				: null,
		disablepictureinpicture: hasHtmlAttribute(
			opening,
			"disablepictureinpicture",
		),
		disableremoteplayback: hasHtmlAttribute(opening, "disableremoteplayback"),
		height: htmlAttribute(opening, "height"),
		loop: hasHtmlAttribute(opening, "loop"),
		muted: hasHtmlAttribute(opening, "muted"),
		playsinline: hasHtmlAttribute(opening, "playsinline"),
		poster: htmlAttribute(opening, "poster"),
		preload:
			preload === "auto" || preload === "none" || preload === "metadata"
				? preload
				: "metadata",
		source,
		src: htmlAttribute(opening, "src"),
		width: htmlAttribute(opening, "width"),
	};
}

export function videoSourceForUrl(url: string): string {
	return (
		videoSourceFromAttributes({ controls: true, src: url }) ??
		'<video src="" controls></video>'
	);
}

export function videoSourceFromAttributes(
	attributes: MarkdownVideoCommandOptions,
): string | null {
	const src = attributes.src.trim();
	const poster = attributes.poster?.trim();
	if (poster && !isSafeMediaSource(poster)) return null;
	return serializeHtmlMediaElement("video", [
		["src", src],
		["controls", attributes.controls ?? true],
		["autoplay", attributes.autoplay],
		["loop", attributes.loop],
		["muted", attributes.muted],
		["playsinline", attributes.playsinline],
		["disablepictureinpicture", attributes.disablepictureinpicture],
		["disableremoteplayback", attributes.disableremoteplayback],
		["preload", attributes.preload],
		["controlslist", attributes.controlslist],
		["crossorigin", attributes.crossorigin],
		["poster", poster],
		["width", attributes.width],
		["height", attributes.height],
	]);
}
