import type { JSONContent, MarkdownParseHelpers } from "@tiptap/core";
import { isAllowedUri, Link } from "@tiptap/extension-link";
import { automaticLinkKind, markdownLinkInputRule } from "./markdown-autolinks";
import { inlineTagInputRule } from "./markdown-inline-tag-input";
import {
	decodeLinkAttribute,
	escapeLinkAttribute,
	readHtmlLink,
} from "./markdown-link-source";

/** The explicit outer link owns its destination, including URL-looking text. */
function withoutInnerLinks(node: JSONContent, helpers: MarkdownParseHelpers): JSONContent {
	const result = helpers.applyNodeMarks(node, node.marks?.filter((mark) => mark.type !== "link"));
	if (node.content) result.content = node.content.map(child => withoutInnerLinks(child, helpers));
	return result;
}

/** Official Link owns commands, paste, autolinking and schema validation. */
export function createMarkdownLink(autoLink = true) {
	return Link.extend({
		addAttributes() {
			return {
				...this.parent?.(),
				target: { default: null },
 referenceLabel: { default: null, parseHTML: element => element.getAttribute("data-reference-label"), renderHTML: attrs => attrs.referenceLabel ? {"data-reference-label": attrs.referenceLabel} : {} },
 referenceSuffix: { default: null, parseHTML: element => element.getAttribute("data-reference-suffix"), renderHTML: attrs => attrs.referenceSuffix !== null ? {"data-reference-suffix": attrs.referenceSuffix} : {} },
				autoLinkSyntax: {
					default: "bare",
					parseHTML: () => null,
					rendered: false,
				},
				htmlLink: {
					default: false,
					parseHTML: () => true,
					rendered: false,
				},
			};
		},
		markdownTokenizer: {
			name: "link",
			level: "inline",
			start: (source) => source.search(/<\/?a(?:\s|>)/i),
			tokenize(source, _tokens, helpers) {
				const link = readHtmlLink(source);
				if (link && !link.text.trim() && (link.id || link.name))
					return {
						raw: link.raw,
						text: link.raw,
						type: "htmlAnchor",
					};
				if (link?.href && link.text && isAllowedUri(link.href))
					return {
						...link,
						type: "link",
						htmlLink: true,
						tokens: helpers.inlineTokens(link.text, { from: link.textFrom, to: link.textFrom + link.text.length }),
					};
				const raw =
					link?.raw ??
					/^<\/?a\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/i.exec(source)?.[0];
				return raw
					? { type: "link", raw, text: raw, literal: true }
					: undefined;
			},
		},
		parseMarkdown(token, helpers) {
			if (token.literal) return helpers.createTextNode(token.text ?? "");
			const automatic = automaticLinkKind(token);
			if (!autoLink && automatic)
				return helpers.createTextNode(decodeLinkAttribute(token.raw ?? ""));
			const children = helpers
				.parseInline(token.tokens ?? [])
				.map(node => withoutInnerLinks(node, helpers));
			const decode = token.htmlLink
				? (value: string) => value
				: decodeLinkAttribute;
			const href = decode(typeof token.href === "string" ? token.href : "");
			const title = decode(typeof token.title === "string" ? token.title : "");
			return token.referenceLabel || href && isAllowedUri(href)
				? helpers.applyMark("link", children, {
						href: isAllowedUri(href) ? href : "",
 referenceLabel: token.referenceLabel ?? null, referenceSuffix: token.referenceSuffix ?? null,
						title: title || null,
						target: token.target || null,
						htmlLink: token.htmlLink === true,
						autoLinkSyntax: automatic,
					})
				: children;
		},
		renderMarkdown(node, helpers) {
			const href = String(node.attrs?.href ?? "");
			const title = String(node.attrs?.title ?? "");
			const text = helpers.renderChildren(node);
			if (node.attrs?.referenceLabel) {
 const suffix = String(node.attrs.referenceSuffix ?? "");
 return `[${text}]${suffix || (text.toLowerCase() === node.attrs.referenceLabel ? "" : `[${node.attrs.referenceLabel}]`)}`;
 }
 if (!href || !isAllowedUri(href)) return text;
			if (node.attrs?.htmlLink || /[\s<>]/.test(href)) {
				const attributes = Object.entries({
					href,
					title,
					target: node.attrs?.target,
				})
					.filter(([, value]) => value)
					.map(
						([name, value]) =>
							` ${name}="${escapeLinkAttribute(String(value))}"`,
					)
					.join("");
				return `<a${attributes}>${text}</a>`;
			}
			const destination = href
				.replace(/&/g, "&amp;")
				.replace(/[\\()]/g, "\\$&");
			const tooltip = title.replace(/&/g, "&amp;").replace(/[\\"]/g, "\\$&");
			return `[${text}](${destination}${title ? ` "${tooltip}"` : ""})`;
		},
		renderHTML({ HTMLAttributes }) {
			// Source target is retained for saving, not allowed to navigate the editor.
			return [
				"a",
				{
					...HTMLAttributes,
					href: isAllowedUri(HTMLAttributes.href) ? HTMLAttributes.href : "",
					target: "_blank",
					rel: "noopener noreferrer nofollow",
				},
				0,
			];
		},
		addInputRules() {
			return [
				markdownLinkInputRule(this.editor),
				inlineTagInputRule(this.editor, this.type, "a"),
			];
		},
		addPasteRules() {
			return autoLink ? (this.parent?.() ?? []) : [];
		},

		addCommands() {
			const parent = this.parent?.();
			const setLink = parent?.setLink;
			const toggleLink = parent?.toggleLink;
			if (!setLink || !toggleLink) return parent ?? {};
			return {
				...parent,
				setLink: (attributes) => {
					const explicit = { ...attributes, autoLinkSyntax: null, referenceLabel: null, referenceSuffix: null };
					return setLink(explicit);
				},
				toggleLink: (attributes) => {
					const explicit = {
						...attributes,
						href: attributes?.href ?? "",
 referenceLabel: null, referenceSuffix: null,
						autoLinkSyntax: null,
					};
					return toggleLink(explicit);
				},
			};
		},
	}).configure({
		enableClickSelection: true,
		openOnClick: false,
		autolink: autoLink,
		linkOnPaste: autoLink,
	});
}
export const MarkdownLink = createMarkdownLink();
