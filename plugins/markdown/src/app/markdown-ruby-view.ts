import type { NodeViewRenderer } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import createDOMPurify from "dompurify";
import { mountHtmlBlockImages } from "./markdown-html-block-images";
import { mountHtmlBlockMedia } from "./markdown-html-block-media";
import { filterHtmlBlockStyles } from "./markdown-html-block-style";
import type { HtmlBlockOpenLink } from "./markdown-html-block-view";
import { readInlineHtml } from "./markdown-inline-html";
import { captureImageSources } from "./markdown-image-resources";
import { captureMediaSource } from "./markdown-media-resources";
import type { MarkdownMediaSourceResolver } from "./markdown-media-source";

let purifier: ReturnType<typeof createDOMPurify> | undefined;

function createRubyPurifier() {
	const instance = createDOMPurify();
	instance.addHook("beforeSanitizeAttributes", captureImageSources);
	instance.addHook("beforeSanitizeAttributes", captureMediaSource);
	return instance;
}

/** Clean preview and clipboard markup; navigation still belongs to the Host. */
export function rubyPreview(source: string): DocumentFragment {
	const fragment = document.createDocumentFragment();
	if (source.length > 50_000) {
		fragment.append("Ruby preview is limited to 50,000 characters.");
		return fragment;
	}
	const ruby = readInlineHtml(source.trim(), "ruby");
	if (!ruby || ruby.raw !== source.trim()) {
		fragment.append(source || "Empty ruby");
		return fragment;
	}
	purifier ??= createRubyPurifier();
	const safe = purifier.sanitize(source, {
		ALLOWED_TAGS: [
			"a",
			"ruby",
			"rb",
			"rt",
			"rp",
			"rtc",
			"span",
			"b",
			"strong",
			"i",
			"em",
			"u",
			"s",
			"sub",
			"sup",
			"br",
			"img",
			"audio",
			"video",
		],
		ALLOWED_ATTR: [
			"lang",
			"dir",
			"style",
			"href",
			"title",
			"alt",
			"width",
			"height",
			"sizes",
			"controls",
			"controlslist",
			"loop",
			"muted",
			"playsinline",
			"crossorigin",
			"disableremoteplayback",
			"disablepictureinpicture",
		],
		ALLOW_DATA_ATTR: false,
		ALLOW_ARIA_ATTR: false,
		RETURN_DOM_FRAGMENT: true,
	});
	filterHtmlBlockStyles(safe);
	if (safe.textContent || safe.querySelector("img, audio, video"))
		fragment.append(safe);
	else fragment.append("Empty ruby");
	return fragment;
}

export const rubyNodeView =
	(
		openLink: HtmlBlockOpenLink,
		resolver: MarkdownMediaSourceResolver,
	): NodeViewRenderer =>
	({ node: initial, editor, getPos }) => {
		let node = initial;
		let renderedSource: string | undefined;
		let releaseResources = () => {};
		const dom = document.createElement("span");
		dom.className = "markdown-ruby";
		dom.contentEditable = "false";
		// Links remain real focusable links, not interactive children of a button.
		const preview = document.createElement("span");
		preview.setAttribute("role", "group");
		preview.tabIndex = 0;
		preview.className = "markdown-ruby-preview";
		preview.setAttribute("aria-label", "Edit ruby");
		const source = document.createElement("textarea");
		source.setAttribute("aria-label", "Ruby source");
		source.spellcheck = false;
		source.rows = 2;
		source.hidden = true;
		dom.append(preview, source);
		const render = () => {
			const raw = String(node.attrs.source ?? "");
			if (source.value !== raw) source.value = raw;
			if (renderedSource === raw) return;
			renderedSource = raw;
			releaseResources();
			preview.replaceChildren(rubyPreview(raw));
			const images = mountHtmlBlockImages(preview, resolver);
			const media = mountHtmlBlockMedia(preview, resolver);
			releaseResources = () => {
				images();
				media();
			};
		};
		const leave = (direction = 1, remove = false) => {
			const position = getPos();
			if (position === undefined) return;
			const tr = closeHistory(editor.state.tr);
			if (remove) tr.delete(position, position + node.nodeSize);
			const target =
				remove || direction < 0 ? position : position + node.nodeSize;
			tr.setSelection(TextSelection.near(tr.doc.resolve(target), direction));
			editor.view.dispatch(tr);
			editor.view.focus();
		};
		const select = () => {
			const position = getPos();
			if (position === undefined || !editor.isEditable) return;
			editor.view.dispatch(
				closeHistory(editor.state.tr).setSelection(
					NodeSelection.create(editor.state.doc, position),
				),
			);
			source.focus();
		};
		preview.addEventListener("click", (event) => {
			if (
				event.target instanceof Element &&
				event.target.closest("audio, video[controls]")
			)
				return;
			const link =
				event.target instanceof Element && event.target.closest("a[href]");
			event.preventDefault();
			if (link) {
				openLink(link.getAttribute("href") ?? "", editor.view);
				return;
			}
			select();
		});
		preview.addEventListener("keydown", (event) => {
			if (
				event.target === preview &&
				(event.key === "Enter" || event.key === " ")
			) {
				event.preventDefault();
				select();
			}
		});
		preview.addEventListener("auxclick", (event) => event.preventDefault());
		source.addEventListener("input", () => {
			const position = getPos();
			if (position === undefined || source.value === node.attrs.source) return;
			const tr = editor.state.tr.setNodeMarkup(position, undefined, {
				source: source.value,
			});
			tr.setSelection(NodeSelection.create(tr.doc, position));
			editor.view.dispatch(tr);
		});
		source.addEventListener("keydown", (event) => {
			if (event.isComposing) return;
			const modified = event.metaKey || event.ctrlKey;
			if (modified && event.key.toLowerCase() === "z") {
				event.preventDefault();
				if (event.shiftKey) editor.commands.redo();
				else editor.commands.undo();
				return;
			}
			if (
				event.key === "Escape" ||
				(event.key === "Enter" && !event.shiftKey)
			) {
				event.preventDefault();
				leave();
			}
			if (event.key === "Backspace" && source.value === "") {
				event.preventDefault();
				leave(1, true);
			}
			if (
				modified ||
				event.shiftKey ||
				source.selectionStart !== source.selectionEnd
			)
				return;
			if (event.key === "ArrowLeft" && source.selectionStart === 0) {
				event.preventDefault();
				leave(-1);
			}
			if (
				event.key === "ArrowRight" &&
				source.selectionEnd === source.value.length
			) {
				event.preventDefault();
				leave();
			}
		});
		render();
		return {
			dom,
			update(next) {
				if (next.type !== node.type) return false;
				node = next;
				render();
				return true;
			},
			selectNode() {
				if (!editor.isEditable) return;
				source.hidden = false;
				queueMicrotask(() => {
					if (
						dom.isConnected &&
						editor.state.selection instanceof NodeSelection &&
						editor.state.selection.from === getPos()
					)
						source.focus();
				});
			},
			deselectNode() {
				source.hidden = true;
			},
			stopEvent: (event) => dom.contains(event.target as globalThis.Node),
			ignoreMutation: () => true,
			destroy: () => releaseResources(),
		};
	};
