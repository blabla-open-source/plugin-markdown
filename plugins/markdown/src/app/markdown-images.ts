import { InputRule } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { decodeLinkAttribute } from "./markdown-link-source";
import type { MarkdownMediaSourceResolver } from "./markdown-media-source";

/** Official Image owns schema and commands; Host resolves all document-relative sources. */
export function createMarkdownImage(resolver: MarkdownMediaSourceResolver) {
	return Image.extend({
		addAttributes() {
			return {
				...this.parent?.(),
				referenceLabel: {
					default: null,
					parseHTML: (element) => element.getAttribute("data-reference-label"),
					renderHTML: (attrs) =>
						attrs.referenceLabel
							? { "data-reference-label": attrs.referenceLabel }
							: {},
				},
				referenceSuffix: {
					default: null,
					parseHTML: (element) => element.getAttribute("data-reference-suffix"),
					renderHTML: (attrs) =>
						attrs.referenceSuffix !== null
							? { "data-reference-suffix": attrs.referenceSuffix }
							: {},
				},
			};
		},
		parseMarkdown(token, helpers) {
			return helpers.createNode("image", {
				src: decodeLinkAttribute(String(token.href ?? "")),
				alt: decodeLinkAttribute(String(token.text ?? "")),
				title: decodeLinkAttribute(String(token.title ?? "")) || null,
				referenceLabel: token.referenceLabel ?? null,
				referenceSuffix: token.referenceSuffix ?? null,
			});
		},
		renderMarkdown(node, helpers, context) {
			if (node.attrs?.referenceLabel)
				return `![${String(node.attrs.alt ?? "").replace(/[\\[\]]/g, "\\$&")}]${node.attrs.referenceSuffix ?? `[${node.attrs.referenceLabel}]`}`;
			return (
				Image.config.renderMarkdown?.call(this, node, helpers, context) ?? ""
			);
		},
		addInputRules() {
			const editor = this.editor;
			return [
				...(this.parent?.() ?? []),
				new InputRule({
					find(text) {
						if (!text.endsWith("]")) return null;
						const instance = editor.markdown?.instance;
						const token =
							instance &&
							new instance.Lexer(instance.defaults).inlineTokens(text).at(-1);
						return token?.type === "image" && "referenceLabel" in token
							? { index: text.length - token.raw.length, text: token.raw }
							: null;
					},
					handler({ state, range, match }) {
						const node = editor.markdown?.parse(match[0]).content?.[0];
						if (node?.type !== "image") return null;
						state.tr.replaceRangeWith(
							range.from,
							range.to,
							editor.schema.nodeFromJSON(node),
						);
						return undefined;
					},
				}),
			];
		},
		addNodeView() {
			return ({ node }) => {
				let current = node;
				let dispose = () => {};
				const dom = document.createElement("div");
				dom.className = "markdown-image";
				const image = document.createElement("img");
				image.loading = "lazy";
				const literal = document.createElement("span");
				dom.append(image, literal);
				const render = () => {
					dispose();
					image.removeAttribute("src");
					image.alt = current.attrs.alt ?? "";
					image.title = current.attrs.title ?? "";
					for (const attribute of ["width", "height"] as const) {
						const value = current.attrs[attribute];
						if (value === null || value === undefined)
							image.removeAttribute(attribute);
						else image.setAttribute(attribute, String(value));
					}
					const missing = Boolean(
						current.attrs.referenceLabel && !current.attrs.src,
					);
					literal.textContent = missing
						? `![${image.alt}]${current.attrs.referenceSuffix ?? `[${current.attrs.referenceLabel}]`}`
						: "";
					literal.hidden = !missing;
					image.hidden = missing;
					dispose = resolver.subscribe(
						String(current.attrs.src ?? ""),
						(url) => {
							if (url) image.src = url;
							else image.removeAttribute("src");
						},
					);
				};
				render();
				return {
					dom,
					update(next) {
						if (next.type !== current.type) return false;
						if (!next.sameMarkup(current)) {
							current = next;
							render();
						}
						return true;
					},
					ignoreMutation: () => true,
					destroy: () => dispose(),
				};
			};
		},
	});
}
