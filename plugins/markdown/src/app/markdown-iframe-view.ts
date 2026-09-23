import type { NodeViewRenderer } from "@tiptap/core";
import type { BlablaHostBridge } from "../host/host-api";
import { mountIframePreview } from "./markdown-iframe-content";
import { iframePreview } from "./markdown-iframe-preview";
import type { MarkdownMediaSourceResolver } from "./markdown-media-source";
import { htmlMediaNodeView } from "./markdown-media-view";

export function iframeNodeView(
	resolver: MarkdownMediaSourceResolver,
	navigation: BlablaHostBridge["navigation"],
): NodeViewRenderer {
	return htmlMediaNodeView({
		className: "markdown-html-iframe",
		createMedia: () => document.createElement("div"),
		label: "HTML iframe preview",
		parseSource: (source) => ({ source }),
		resolver,
		sourceLabel: "HTML iframe source",
		renderMedia: ({ element, node, setNotice }) =>
			mountIframePreview(
				element,
				iframePreview(String(node.attrs.source ?? "")),
				resolver,
				navigation,
				setNotice,
			),
	});
}
