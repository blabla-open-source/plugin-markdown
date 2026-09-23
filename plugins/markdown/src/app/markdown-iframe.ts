import { markdownBlockStart } from "./markdown-grammar";
import { type MarkdownToken, Node } from "@tiptap/core";
import type { BlablaHostBridge } from "../host/host-api";
import { iframeNodeView } from "./markdown-iframe-view";
import {
	type MarkdownMediaSourceResolver,
	readHtmlMediaBlock,
} from "./markdown-media-source";

export function MarkdownIframe(
	resolver: MarkdownMediaSourceResolver,
	navigation: BlablaHostBridge["navigation"],
) {
	return Node.create({
		name: "iframe",
		group: "block",
		atom: true,
		code: true,
		draggable: true,
		addAttributes: () => ({
			source: { default: "<iframe></iframe>", rendered: false },
		}),
		parseHTML: () => [
			{ tag: "iframe", getAttrs: (element) => ({ source: element.outerHTML }) },
			{
				tag: "div[data-blabla-iframe-source]",
				getAttrs: (element) => ({
					source: element.getAttribute("data-blabla-iframe-source"),
				}),
			},
		],
		// Clipboard HTML transports source as data, never as an executable frame.
		renderHTML: ({ node }) => [
			"div",
			{ "data-blabla-iframe-source": node.attrs.source },
			"Embedded webpage",
		],
		markdownTokenizer: {
			name: "iframe",
			level: "block",
			start: (source) => markdownBlockStart(source, /^ {0,3}<iframe(?:\s|>)/im),
			tokenize: (source) => {
				const raw = readHtmlMediaBlock(source, "iframe");
				return raw ? { type: "iframe", raw, text: raw } : undefined;
			},
		},
		parseMarkdown: (token: MarkdownToken, helpers) =>
			helpers.createNode("iframe", {
				source: String(token.raw ?? token.text ?? ""),
			}),
		renderMarkdown: (node) => String(node.attrs?.source ?? ""),
		addNodeView: () => iframeNodeView(resolver, navigation),
	});
}
