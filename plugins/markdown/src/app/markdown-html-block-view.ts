import { blockToolbar } from "./markdown-block-toolbar";
import type { Editor, NodeViewRenderer } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { BlablaHostBridge } from "../host/host-api";
import { codeEditor } from "./markdown-code-editor";
import { mountHtmlBlockIframes } from "./markdown-html-block-iframes";
import { mountHtmlBlockImages } from "./markdown-html-block-images";
import { mountHtmlBlockMedia } from "./markdown-html-block-media";
import { renderHtmlBlockPreview } from "./markdown-html-block-preview";
import { isSourceOnlyHtml } from "./markdown-html-block-source";
import type { MarkdownMediaSourceResolver } from "./markdown-media-source";
import { mountHtmlBlockSvgImages } from "./markdown-svg-image-resources";

export function exitHtmlBlock(editor: Editor) {
	const { $from } = editor.state.selection;
	if ($from.parent.type.name !== "htmlBlock") return false;
	if (!editor.state.doc.nodeAt($from.after()))
		return editor.chain().focus().exitCode().run();
	const result = editor.commands.command(({ tr }) => {
		tr.setSelection(TextSelection.near(tr.doc.resolve($from.after()), 1));
		return true;
	});
	editor.view.focus();
	return result;
}

export type HtmlBlockOpenLink = (address: string, view: EditorView) => void;

export const htmlBlockNodeView =
	(
		openLink: HtmlBlockOpenLink,
		resolver: MarkdownMediaSourceResolver,
		navigation: BlablaHostBridge["navigation"],
	): NodeViewRenderer =>
	(props) => {
		const { node: initial, editor, getPos } = props;
		let node = initial;
		let lastSource: string | undefined;
		let cleanupResources: () => void = () => undefined;
		const dom = document.createElement("div");
		dom.className = "markdown-html-block";
		const code = codeEditor(props, "HTML source", () => exitHtmlBlock(editor));
		const source = document.createElement("div");
		source.append(code.dom);
		source.contentEditable = "false";
		const edit = document.createElement("button");
		edit.type = "button";
		edit.className = "markdown-html-action markdown-html-edit";
		edit.textContent = "HTML </>";
		edit.setAttribute("aria-label", "Edit HTML");
		edit.title = "Edit HTML";
		edit.contentEditable = "false";
		const toolbar = blockToolbar("HTML");
		const done = toolbar.done;
		const preview = document.createElement("div");
		preview.className = "markdown-html-block-preview";
		preview.contentEditable = "false";
		preview.setAttribute("aria-label", "HTML preview");
		const notice = document.createElement("div");
		notice.className = "markdown-html-block-notice";
		notice.contentEditable = "false";
		notice.setAttribute("role", "status");
		dom.append(toolbar.dom, source, edit, preview, notice);
		const select = () => {
			const position = getPos();
			if (position === undefined || !editor.isEditable) return;
			editor.view.dispatch(
				closeHistory(editor.state.tr).setSelection(
					TextSelection.create(editor.state.doc, position + 1),
				),
			);
			code.focus();
		};
		edit.addEventListener("click", select);
		preview.addEventListener("click", (event) => {
			if (
				!event.metaKey &&
				!event.ctrlKey &&
				event.target instanceof Element &&
				event.target.closest("input, textarea")
			)
				return;
			if (
				!event.metaKey &&
				!event.ctrlKey &&
				event.target instanceof Element &&
				event.target.closest("audio, video[controls]")
			)
				return;
			const link =
				event.target instanceof Element &&
				event.target.closest("a[href], area[href]");
			if (link) {
				event.preventDefault();
				openLink(link.getAttribute("href") ?? "", editor.view);
				return;
			}
			if (
				event.metaKey ||
				event.ctrlKey ||
				(event.target instanceof Element && !event.target.closest("summary"))
			) {
				event.preventDefault();
				select();
			}
		});
		preview.addEventListener("submit", (event) => event.preventDefault());
		// Never let middle-click bypass Host navigation into a native popup.
		preview.addEventListener("auxclick", (event) => event.preventDefault());
		done.addEventListener("click", () => exitHtmlBlock(editor));
		const selectionChanged = () => {
			const position = getPos();
			const { from, to } = editor.state.selection;
			const editing =
				position !== undefined &&
				from >= position &&
				to <= position + node.nodeSize;
			const sourceOnly = isSourceOnlyHtml(node.textContent);
			source.hidden = !editing && !sourceOnly;
			toolbar.dom.hidden = !editing || !editor.isEditable;
			edit.hidden = editing || !editor.isEditable || sourceOnly;
			preview.hidden = editing || sourceOnly;
			notice.hidden = sourceOnly;
		};
		const render = () => {
			selectionChanged();
			if (lastSource === node.textContent) return;
			lastSource = node.textContent;
			cleanupResources();
			if (isSourceOnlyHtml(lastSource)) {
				preview.replaceChildren();
				notice.textContent = "";
				return;
			}
			if (lastSource.length > 50_000) {
				preview.replaceChildren();
				notice.textContent =
					"HTML preview is limited to 50,000 characters. Source is preserved.";
				return;
			}
			const { fragment, filtered } = renderHtmlBlockPreview(lastSource);
			preview.replaceChildren(fragment);
			const images = mountHtmlBlockImages(preview, resolver);
			const media = mountHtmlBlockMedia(preview, resolver);
			const iframes = mountHtmlBlockIframes(preview, resolver, navigation);
			const svgImages = mountHtmlBlockSvgImages(preview, resolver);
			cleanupResources = () => {
				images();
				media();
				iframes();
				svgImages();
			};
			// A standalone closing tag has no DOM. Keep it visible as escaped text.
			if (!preview.hasChildNodes()) preview.textContent = lastSource;
			notice.textContent = filtered
				? "Preview omits unsupported elements, attributes and styles, including other media. HTML source is preserved."
				: lastSource.trim()
					? ""
					: "Empty HTML — edit source to add content.";
		};
		editor.on("selectionUpdate", selectionChanged);
		render();
		return {
			dom,
			setSelection: code.setSelection,
			update(next) {
				if (next.type !== node.type) return false;
				node = next;
				code.update(next);
				render();
				return true;
			},
			ignoreMutation: () => true,
			stopEvent: (event) =>
				event.target instanceof globalThis.Node && dom.contains(event.target),
			destroy: () => {
				cleanupResources();
				code.destroy();
				editor.off("selectionUpdate", selectionChanged);
			},
		};
	};
