import { normalizeNativeTaskLists } from "./markdown-task-clipboard";
import { pasteListAtItemEnd } from "./markdown-list-paste";
import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { restoreNativeDiagramClipboard } from "./markdown-diagram-clipboard";
import { diagramEngine } from "./markdown-diagram-engine";
import { readMarkdownFrontMatter } from "./markdown-front-matter-source";
import { readMathBlock } from "./markdown-math-source";


function nativeTocItems(html: string): boolean {
	if (!html.includes("md-toc-item")) return false;
	const template = document.createElement("template");
	template.innerHTML = html;
	for (const child of Array.from(template.content.children))
		if (child.matches("meta[charset]")) child.remove();
	const items = Array.from(template.content.childNodes).filter(
		(node) => node.nodeType !== 3 || node.textContent?.trim(),
	);
	return (
		items.length > 0 &&
		items.every(
			(node) =>
				node instanceof HTMLElement &&
				node.matches('span.md-toc-item[role="listitem"][data-ref]') &&
				node.querySelector(":scope > a.md-toc-inner"),
		)
	);
}

/** Clipboard adapters preserve Markdown semantics before the normal parsers. */
export const MarkdownSemanticPaste = Extension.create({
	name: "markdownSemanticPaste",
	priority: 1101,
	transformPastedHTML(html) {
		if (!html.includes("md-")) return html;
		const template = document.createElement("template");
		template.innerHTML = html;
		// A native rendered fragment can carry transport charset metadata. Remove
		// that envelope before the literal-HTML classifier sees a leading <meta>.
		if (
			!template.content.querySelector(
				'li.md-task-list-item[mdtype="list_item"], .md-end-block[mdtype], .md-heading[mdtype="heading"], sup.md-footnote[md-inline="footnote"], span.md-emoji[md-inline="emoji"]',
			)
		)
			return html;
		normalizeNativeTaskLists(template.content);
		for (const child of Array.from(template.content.children)) {
			if (child.matches("meta[charset]")) child.remove();
		}
		for (const heading of template.content.querySelectorAll<HTMLElement>(
			':is(h1,h2,h3,h4,h5,h6).md-heading[mdtype="heading"]',
		)) {
			// Native heading weight is theme styling; authored strong children remain.
			heading.style.removeProperty("font-weight");
		}
		for (const native of template.content.querySelectorAll(
			'div.md-math-block[mdtype="math_block"]',
		)) {
			const source = native.cloneNode(true) as HTMLElement;
			for (const br of source.querySelectorAll("br")) br.replaceWith("\n");
			const raw = source.textContent ?? "";
			const math = readMathBlock(raw);
			if (!math || math.raw !== raw) continue;
			const block = document.createElement("div");
			block.dataset.type = "block-math";
			block.dataset.latex = math.latex;
			block.dataset.mathOpening = math.opening;
			block.dataset.mathClosing = math.closing;
			block.dataset.mathCompact = String(math.compact);
			// WebKit separates this native rendered block from the next block.
			const separator = native.nextSibling;
			if (
				separator instanceof HTMLBRElement &&
				separator.attributes.length === 0 &&
				separator.nextSibling instanceof Element &&
				separator.nextSibling.matches(".md-end-block[mdtype]")
			)
				separator.remove();
			native.replaceWith(block);
		}
		for (const native of template.content.querySelectorAll(
			'pre.md-fences[mdtype="fences"]',
		)) {
			// CodeMirror's rendered spaces and blank-line placeholders are not code.
			for (const text of native.querySelectorAll("[cm-text]")) {
				text.replaceWith(
					document.createTextNode(text.getAttribute("cm-text") ?? ""),
				);
			}
			for (const br of native.querySelectorAll("br")) br.replaceWith("\n");
			const pre = document.createElement("pre");
			const code = document.createElement("code");
			const language = native.getAttribute("lang");
			if (language) code.className = `language-${language}`;
			code.textContent = native.textContent;
			pre.append(code);
			native.replaceWith(pre);
		}
		return template.innerHTML;
	},
	addProseMirrorPlugins() {
		const parser = ProseMirrorDOMParser.fromSchema(this.editor.schema);
		// Native paragraph soft wraps are text newlines, not hard-break nodes.
		const clipboardParser = new ProseMirrorDOMParser(
			this.editor.schema,
			parser.rules.flatMap((rule) =>
				"tag" in rule && rule.tag === "p" && rule.node === "paragraph"
					? [
							{
								...rule,
								tag: 'p.md-p[mdtype="paragraph"]',
								preserveWhitespace: "full" as const,
							},
							rule,
						]
					: [rule],
			),
		);
		return [
			new Plugin({
				props: {
					clipboardParser,
					handlePaste: (view, event, slice) => {
						if (pasteListAtItemEnd(view, slice)) return true;
						const text = event.clipboardData?.getData("text/plain");
						const html = event.clipboardData?.getData("text/html");
						if (!text || view.state.selection.$from.parent.type.spec.code ||
							view.state.selection.$from.marks().some((mark) => mark.type.spec.code) ||
							readMarkdownFrontMatter(text)) return false;
						let restored = html ? restoreNativeDiagramClipboard(html, text, this.editor) : null;
						if (restored) {
							view.someProp("transformPastedHTML", (transform) => {
								restored = transform(restored ?? "", view);
							});
							const container = document.createElement("div");
							container.innerHTML = restored;
							const slice = clipboardParser.parseSlice(container, { preserveWhitespace: true });
							view.dispatch(closeHistory(view.state.tr).replaceSelection(slice)
								.setMeta("paste", true).scrollIntoView());
							view.dispatch(closeHistory(view.state.tr));
							return true;
						}
						if (html && !nativeTocItems(html)) return false;
						const parsed = this.editor.markdown?.parse(text);
						if (!parsed) return false;
						let hasSemanticNode = false;
						let hasTocBlock = false;
						this.editor.schema.nodeFromJSON(parsed).descendants((node) => {
							if (node.type.name === "tableOfContentsBlock") hasTocBlock = true;
							if (
								node.marks.some(
									(mark) =>
										mark.type.name === "textStyle" ||
										mark.type.name === "htmlComment" ||
										mark.type.name === "link",
								) ||
								node.type.name === "footnoteReference" ||
								node.type.name === "htmlAnchor" ||
								node.type.name === "keyboard" ||
								node.type.name === "ruby" ||
								node.type.name === "htmlBlock" ||
								node.type.name === "audio" ||
								node.type.name === "video" ||
								node.type.name === "iframe" ||
								node.type.name === "emoji" ||
								node.type.name === "inlineMath" ||
								node.type.name === "blockMath" ||
								(node.type.name === "codeBlock" &&
									diagramEngine(node.attrs.language)) ||
								node.type.name === "tableOfContentsBlock" ||
								node.type.name === "footnoteDefinition" ||
								(node.type.name === "blockquote" && node.attrs.alert)
							)
								hasSemanticNode = true;
						});
						if (!hasSemanticNode || (html && !hasTocBlock)) return false;
						const first = parsed.content?.[0];
						const content = parsed.content?.length === 1 && first?.type === "paragraph" ? first.content ?? [] : parsed.content ?? [];
						const inserted = this.editor
							.chain()
							.command(({ tr }) => {
								// Markdown is already parsed. Reapplying paste rules would
								// interpret literal delimiters inside comments and code again.
								closeHistory(tr).setMeta("paste", true);
								return true;
							})
							.insertContent(content)
							.run();
						// Pasting is one undo step, separate from typing on either side.
						if (inserted) view.dispatch(closeHistory(view.state.tr));
						return inserted;
					},
				},
			}),
		];
	},
});
