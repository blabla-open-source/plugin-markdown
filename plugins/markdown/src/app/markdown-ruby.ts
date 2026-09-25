import { Node } from "@tiptap/core";
import type { HtmlBlockOpenLink } from "./markdown-html-block-view";
import { readInlineHtml } from "./markdown-inline-html";
import { inlineTagInputRule } from "./markdown-inline-tag-input";
import type { MarkdownMediaSourceResolver } from "./markdown-media-source";
import { rubyNodeView, rubyPreview } from "./markdown-ruby-view";

/** Ruby groups and fallback text share one literal HTML source, as in desktop Markdown editors. */
export const MarkdownRuby = (
	openLink: HtmlBlockOpenLink,
	resolver: MarkdownMediaSourceResolver,
) =>
	Node.create({
		name: "ruby",
		group: "inline",
		inline: true,
		atom: true,
		addAttributes: () => ({
			source: { default: "<ruby></ruby>", rendered: false },
		}),
		parseHTML: () => [
			{
				tag: "span[data-blabla-ruby-source]",
				getAttrs: (element) => ({
					source: element.getAttribute("data-blabla-ruby-source"),
				}),
			},
			{ tag: "ruby", getAttrs: (element) => ({ source: element.outerHTML }) },
		],
		renderHTML: ({ node }) => {
			const dom = document.createElement("span");
			dom.dataset.blablaRubySource = node.attrs.source;
			dom.append(rubyPreview(node.attrs.source));
			return dom;
		},
		renderText: ({ node }) => String(node.attrs.source),
		markdownTokenizer: {
			name: "ruby",
			level: "inline",
			start: (source) => source.search(/<\/?ruby\b/i),
			tokenize(source) {
				const ruby = readInlineHtml(source, "ruby");
				if (ruby) return { type: "ruby", raw: ruby.raw };
				if (/^<ruby(?:\s|>)/i.test(source))
					return { type: "ruby", raw: source, literal: true };
				const raw = /^<\/?ruby\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/i.exec(
					source,
				)?.[0];
				return raw ? { type: "ruby", raw, literal: true } : undefined;
			},
		},
		parseMarkdown: (token, helpers) =>
			token.literal
				? helpers.createTextNode(token.raw ?? "")
				: helpers.createNode("ruby", { source: token.raw }),
		renderMarkdown: (node) => String(node.attrs?.source ?? ""),
		addInputRules() {
			return [inlineTagInputRule(this.editor, null, "ruby")];
		},
		addNodeView: () => rubyNodeView(openLink, resolver),
	});
