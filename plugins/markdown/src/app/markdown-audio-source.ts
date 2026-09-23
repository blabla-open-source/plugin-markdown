import {
	hasHtmlAttribute,
	htmlAttribute,
	htmlMediaOpeningTag,
	readHtmlMediaBlock,
	serializeHtmlMediaElement,
} from "./markdown-media-source";

export const HTML_AUDIO_BLOCK_START = /^ {0,3}<audio(?:\s|>)/i;

export interface MarkdownAudioAttributes {
	autoplay: boolean;
	controls: boolean;
	controlslist: string | null;
	crossorigin: "" | "anonymous" | "use-credentials" | null;
	disableremoteplayback: boolean;
	loop: boolean;
	muted: boolean;
	preload: "auto" | "metadata" | "none" | null;
	source: string;
	src: string | null;
}

export interface MarkdownAudioCommandOptions {
	autoplay?: boolean;
	controls?: boolean;
	controlslist?: string;
	crossorigin?: "" | "anonymous" | "use-credentials";
	disableremoteplayback?: boolean;
	loop?: boolean;
	muted?: boolean;
	preload?: "auto" | "metadata" | "none" | null;
	src: string;
}

export function readHtmlAudioBlock(source: string): string | null {
	return readHtmlMediaBlock(source, "audio");
}

export function audioAttributesFromSource(
	source: string,
): MarkdownAudioAttributes {
	const opening = htmlMediaOpeningTag(source, "audio");
	const preload = htmlAttribute(opening, "preload");
	const crossorigin = htmlAttribute(opening, "crossorigin");
	return {
		autoplay: hasHtmlAttribute(opening, "autoplay"),
		controls: true,
		controlslist: htmlAttribute(opening, "controlslist"),
		crossorigin:
			crossorigin === "" ||
			crossorigin === "anonymous" ||
			crossorigin === "use-credentials"
				? crossorigin
				: null,
		disableremoteplayback: hasHtmlAttribute(opening, "disableremoteplayback"),
		loop: hasHtmlAttribute(opening, "loop"),
		muted: hasHtmlAttribute(opening, "muted"),
		preload:
			preload === "auto" || preload === "none" || preload === "metadata"
				? preload
				: "metadata",
		source,
		src: htmlAttribute(opening, "src"),
	};
}

export function audioSourceForUrl(url: string): string {
	return audioSourceFromAttributes({ src: url }) ?? '<audio src=""></audio>';
}

export function audioSourceFromAttributes(
	attributes: MarkdownAudioCommandOptions,
): string | null {
	return serializeHtmlMediaElement("audio", [
		["src", attributes.src.trim()],
		["controls", attributes.controls],
		["autoplay", attributes.autoplay],
		["loop", attributes.loop],
		["muted", attributes.muted],
		["disableremoteplayback", attributes.disableremoteplayback],
		["preload", attributes.preload],
		["controlslist", attributes.controlslist],
		["crossorigin", attributes.crossorigin],
	]);
}
