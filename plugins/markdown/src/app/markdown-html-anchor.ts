import { Node } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { htmlAnchorNodeView } from "./markdown-html-anchor-view";
import { readHtmlLink } from "./markdown-link-source";
import { HTML_RAW_ELEMENT_TAGS } from "./markdown-html-block-source";

/** A named anchor has one authority: its editable HTML source. */
export const MarkdownHtmlAnchor = Node.create({
	name: "htmlAnchor",
	priority: 1001,
	inline: true,
	group: "inline",
	atom: true,
	code: true,
	selectable: true,
	addAttributes() {
		return { source: { default: '<a id="anchor"></a>', rendered: false } };
	},
	transformPastedHTML(html) {
		const template = document.createElement("template");
		template.innerHTML = html;
		for (const element of template.content.querySelectorAll("a[id], a[name]")) {
			if (element.closest(HTML_RAW_ELEMENT_TAGS.join(","))) continue;
			if (element.textContent || element.childElementCount) continue;
			const anchor = document.createElement("a");
			for (const attribute of ["id", "name"] as const) {
				const value = element.getAttribute(attribute);
				if (value) anchor.setAttribute(attribute, value);
			}
			if (!anchor.hasAttributes()) continue;
			const source = document.createElement("span");
			source.dataset.markdownHtmlAnchor = "";
			source.textContent = anchor.outerHTML;
			element.replaceWith(source);
		}
		return template.innerHTML;
	},
	parseHTML() {
		return [
			{
				tag: "span[data-markdown-html-anchor]",
				getAttrs: (element) => ({ source: element.textContent ?? "" }),
			},
			{
				tag: "a[id]:empty, a[name]:empty",
				getAttrs: (element) => ({
					source: (element as HTMLElement).outerHTML,
				}),
				getContent: () => Fragment.empty,
			},
		];
	},
	renderHTML: ({ node }) => [
		"span",
		{ "data-markdown-html-anchor": "" },
		node.attrs.source,
	],
	parseMarkdown: (token, helpers) =>
		helpers.createNode("htmlAnchor", { source: token.text ?? token.raw ?? "" }),
	renderMarkdown: (node) => String(node.attrs?.source ?? ""),
	addNodeView: () => htmlAnchorNodeView,
});

export function namedAnchorTarget(source: string): string | null {
	const anchor = readHtmlLink(source);
	if (!(anchor && !anchor.text.trim() && anchor.raw.length === source.length))
		return null;
	return anchor.id || anchor.name || null;
}
