import { markdownBlockStart } from "./markdown-grammar";
import { type MarkdownToken, Node } from "@tiptap/core";
import { mediaSourceOutput } from "./markdown-media-output";
import {
	isSafeMediaSource,
	type MarkdownMediaSourceResolver,
} from "./markdown-media-source";
import {
	readHtmlVideoBlock,
	videoAttributesFromSource,
	type MarkdownVideoCommandOptions,
	videoSourceFromAttributes,
} from "./markdown-video-source";
import { videoNodeView } from "./markdown-video-view";

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		video: {
			setVideo: (options: MarkdownVideoCommandOptions) => ReturnType;
		};
	}
}

export function MarkdownVideo(resolver: MarkdownMediaSourceResolver) {
	return Node.create({
		name: "video",
		group: "block",
		atom: true,
		code: true,
		draggable: true,
		addAttributes() {
			return {
				autoplay: { default: false },
				controls: { default: false },
				controlslist: { default: null },
				crossorigin: { default: null },
				disablepictureinpicture: { default: false },
				disableremoteplayback: { default: false },
				height: { default: null },
				loop: { default: false },
				muted: { default: false },
				playsinline: { default: false },
				poster: { default: null },
				preload: { default: "metadata" },
				source: { default: '<video src=""></video>', rendered: false },
				src: { default: null },
				width: { default: null },
			};
		},
		addCommands() {
			return {
				setVideo:
					(options: MarkdownVideoCommandOptions) =>
					({ commands }) => {
						const source = videoSourceFromAttributes(options);
						if (!source) return false;
						return commands.insertContent({
							attrs: videoAttributesFromSource(source),
							type: this.name,
						});
					},
			};
		},
		parseHTML() {
			return [
				{
					tag: "video",
					getAttrs: (element) =>
						videoAttributesFromSource((element as HTMLElement).outerHTML),
				},
			];
		},
		renderHTML({ node }) {
			const { poster, source: _source, src, ...attributes } = node.attrs;
			return [
				"video",
				Object.fromEntries(
					Object.entries({
						...attributes,
						poster:
							typeof poster === "string" && isSafeMediaSource(poster)
								? poster
								: null,
						src: typeof src === "string" && isSafeMediaSource(src) ? src : null,
					} as Record<string, unknown>).filter(
						([, value]) => value !== null && value !== false,
					),
				),
				...mediaSourceOutput(String(_source), "video"),
			];
		},
		markdownTokenizer: {
			name: "video",
			level: "block",
			start: (source) => {
				return markdownBlockStart(source, /^ {0,3}<video(?:\s|>)/im);
			},
			tokenize: (source) => {
				const raw = readHtmlVideoBlock(source);
				return raw ? { type: "video", raw, text: raw } : undefined;
			},
		},
		parseMarkdown: (token: MarkdownToken, helpers) => {
			const source = String(token.raw ?? token.text ?? "");
			return helpers.createNode("video", videoAttributesFromSource(source));
		},
		renderMarkdown: (node) => String(node.attrs?.source ?? ""),
		addNodeView: () => videoNodeView(resolver),
	});
}
