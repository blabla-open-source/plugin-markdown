import { blockToolbar } from "./markdown-block-toolbar";
import type { NodeViewRenderer } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { MarkdownMediaSourceResolver } from "./markdown-media-source";

interface HtmlMediaNodeViewOptions {
	className: string;
	createMedia: () => HTMLElement;
	label: string;
	parseSource: (source: string) => object;
	renderMedia: (input: {
		element: HTMLElement;
		node: ProseMirrorNode;
		resolver: MarkdownMediaSourceResolver;
		setNotice: (message: string) => void;
	}) => () => void;
	resolver: MarkdownMediaSourceResolver;
	sourceLabel: string;
}

export function htmlMediaNodeView(
	options: HtmlMediaNodeViewOptions,
): NodeViewRenderer {
	return ({ node: initial, editor, getPos }) => {
		let node = initial;
		let cleanupMedia: () => void = () => undefined;
		const dom = document.createElement("div");
		dom.className = `markdown-html-media ${options.className}`;
		dom.contentEditable = "false";
		dom.setAttribute("aria-label", options.label);
		const media = options.createMedia();
		const notice = document.createElement("div");
		notice.className = "markdown-html-media-notice";
		notice.setAttribute("role", "status");
		const edit = document.createElement("button");
		edit.type = "button";
		edit.className = "markdown-html-action markdown-html-edit";
		edit.textContent = "HTML </>";
		edit.setAttribute("aria-label", "Edit HTML");
		edit.title = "Edit HTML";
		const source = document.createElement("textarea");
		source.setAttribute("aria-label", options.sourceLabel);
		source.autocomplete = "off";
		source.spellcheck = false;
		const toolbar = blockToolbar("HTML");
		const done = toolbar.done;
		const preview = document.createElement("div");
		preview.append(media);
		dom.append(toolbar.dom, source, preview, notice, edit);

		const leave = () => {
			const position = getPos();
			if (position === undefined) return;
			editor.view.dispatch(
				closeHistory(editor.state.tr).setSelection(
					TextSelection.near(
						editor.state.doc.resolve(position + node.nodeSize),
						1,
					),
				),
			);
			editor.view.focus();
		};
		const select = () => {
			const position = getPos();
			if (position === undefined || !editor.isEditable) return;
			editor.view.dispatch(
				// Source edits must not undo the preceding paste or prose edit.
				closeHistory(editor.state.tr).setSelection(
					NodeSelection.create(editor.state.doc, position),
				),
			);
			queueMicrotask(() => source.focus());
		};
		const selectionChanged = () => {
			const position = getPos();
			const editing =
				position !== undefined &&
				editor.state.selection instanceof NodeSelection &&
				editor.state.selection.from === position;
			preview.hidden = editing;
			source.hidden = !editing;
			toolbar.dom.hidden = !editing;
			edit.hidden = editing || !editor.isEditable;
		};
		const render = () => {
			cleanupMedia();
			const rawSource = String(node.attrs.source ?? "");
			if (source.value !== rawSource) source.value = rawSource;
			cleanupMedia = options.renderMedia({
				element: media,
				node,
				resolver: options.resolver,
				setNotice: (message) => {
					notice.textContent = message;
				},
			});
		};

		edit.addEventListener("click", select);
		done.addEventListener("click", leave);
		source.addEventListener("input", () => {
			const position = getPos();
			if (position === undefined || source.value === node.attrs.source) return;
			const transaction = editor.state.tr.setNodeMarkup(
				position,
				undefined,
				options.parseSource(source.value) as Record<string, unknown>,
			);
			transaction.setSelection(NodeSelection.create(transaction.doc, position));
			editor.view.dispatch(transaction);
		});
		source.addEventListener("keydown", (event) => {
			if (event.isComposing) return;
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
				event.preventDefault();
				if (event.shiftKey) editor.commands.redo();
				else editor.commands.undo();
				return;
			}
			if (
				event.key === "Escape" ||
				(event.key === "Enter" && (event.metaKey || event.ctrlKey))
			) {
				event.preventDefault();
				leave();
			}
		});
		editor.on("selectionUpdate", selectionChanged);
		selectionChanged();
		render();
		return {
			dom,
			update(next) {
				if (next.type !== node.type) return false;
				const changed = !next.eq(node);
				node = next;
				selectionChanged();
				if (changed) render();
				return true;
			},
			selectNode: () => queueMicrotask(() => source.focus()),
			stopEvent: (event) => dom.contains(event.target as globalThis.Node),
			ignoreMutation: () => true,
			destroy: () => {
				cleanupMedia();
				editor.off("selectionUpdate", selectionChanged);
			},
		};
	};
}
