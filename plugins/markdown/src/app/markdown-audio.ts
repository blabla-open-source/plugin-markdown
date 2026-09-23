import { markdownBlockStart } from "./markdown-grammar";
import { Audio } from "@tiptap/extension-audio";
import type { MarkdownToken } from "@tiptap/core";
import { mediaSourceOutput } from "./markdown-media-output";
import {
	audioAttributesFromSource,
	audioSourceFromAttributes,
	type MarkdownAudioCommandOptions,
	readHtmlAudioBlock,
} from "./markdown-audio-source";
import { audioNodeView } from "./markdown-audio-view";
import {
	isSafeMediaSource,
	type MarkdownMediaSourceResolver,
} from "./markdown-media-source";

export function MarkdownAudio(resolver: MarkdownMediaSourceResolver) {
	return Audio.extend({
		code: true,
		addAttributes() {
			return {
				...this.parent?.(),
				source: { default: '<audio src=""></audio>', rendered: false },
			};
		},
		addCommands() {
			return {
				setAudio:
					(options: MarkdownAudioCommandOptions) =>
					({ commands }) => {
						const source = audioSourceFromAttributes(options);
						if (!source) return false;
						return commands.insertContent({
							attrs: audioAttributesFromSource(source),
							type: this.name,
						});
					},
			};
		},
		parseHTML() {
			return [
				{
					tag: "audio",
					getAttrs: (element) =>
						audioAttributesFromSource((element as HTMLElement).outerHTML),
				},
			];
		},
		renderHTML({ node }) {
			const { source: _source, src, ...attributes } = node.attrs;
			return [
				"audio",
				Object.fromEntries(
					Object.entries({
						...attributes,
						src: typeof src === "string" && isSafeMediaSource(src) ? src : null,
					} as Record<string, unknown>).filter(
						([, value]) => value !== null && value !== false,
					),
				),
				...mediaSourceOutput(String(_source), "audio"),
			];
		},
		markdownTokenizer: {
			name: "audio",
			level: "block",
			start: (source) => {
				return markdownBlockStart(source, /^ {0,3}<audio(?:\s|>)/im);
			},
			tokenize: (source) => {
				const raw = readHtmlAudioBlock(source);
				return raw ? { type: "audio", raw, text: raw } : undefined;
			},
		},
		parseMarkdown: (token: MarkdownToken, helpers) => {
			const source = String(token.raw ?? token.text ?? "");
			return helpers.createNode("audio", audioAttributesFromSource(source));
		},
		renderMarkdown: (node) => String(node.attrs?.source ?? ""),
		addNodeView: () => audioNodeView(resolver),
	}).configure({ addPasteHandler: false, allowBase64: false });
}
