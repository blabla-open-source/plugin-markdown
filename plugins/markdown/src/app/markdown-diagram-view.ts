import { blockToolbar } from "./markdown-block-toolbar";
import { codeEditor } from "./markdown-code-editor";
import type { Editor, NodeViewRendererProps } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { NodeView } from "@tiptap/pm/view";
import { acquireDiagramRenderer } from "./markdown-diagram-renderer";
import { diagramEngine, diagramLabels } from "./markdown-diagram-engine";
import { codeLanguageControl } from "./markdown-code-language";
import {
	diagramImageBytes,
	type DiagramImageFormat,
} from "./markdown-diagram-image";
import type { BlablaHostBridge } from "../host/host-api";

export function exitDiagramCode(editor: Editor) {
	const { $from, $to } = editor.state.selection;
	if (!diagramEngine($from.parent.attrs.language) || !$from.sameParent($to))
		return false;
	const after = $from.after();
	if (editor.state.doc.nodeAt(after)?.type.name === "paragraph")
		return editor
			.chain()
			.focus()
			.setTextSelection(after + 1)
			.run();
	return editor.chain().focus().exitCode().run();
}

/** Preview and source share the existing code node and document history. */
export const diagramNodeView = (
	props: NodeViewRendererProps,
	host: BlablaHostBridge,
): NodeView => {
	const { node: initial, editor, getPos } = props;
	let node = initial;
	const engine = diagramEngine(node.attrs.language);
	if (!engine) throw new Error("Unknown diagram language.");
	const label = diagramLabels[engine];
	const dom = document.createElement("div");
	dom.className = `markdown-code-diagram markdown-${engine}`;
	const code = codeEditor(props, `${label} source`, () =>
		exitDiagramCode(editor),
	);
	const pre = document.createElement("div");
	pre.append(code.dom);
	const preview = document.createElement("button");
	preview.type = "button";
	preview.className = "markdown-code-diagram-preview";
	preview.contentEditable = "false";
	preview.setAttribute("aria-label", "Edit diagram");
	const picture = document.createElement("img");
	picture.alt = `${label} diagram`;
	picture.hidden = true;
	const status = document.createElement("span");
	status.setAttribute("role", "status");
	preview.append(picture, status);
	const menu = document.createElement("div");
	menu.className = "markdown-diagram-menu";
	menu.contentEditable = "false";
	menu.hidden = true;
	menu.setAttribute("role", "menu");
	menu.setAttribute("aria-label", "Diagram actions");
	const feedback = document.createElement("span");
	feedback.className = "markdown-diagram-action-status";
	feedback.contentEditable = "false";
	feedback.setAttribute("role", "status");
	const language = codeLanguageControl(props);
	const toolbar = blockToolbar(language.dom);
	const done = toolbar.done;
	dom.append(toolbar.dom, pre, preview, menu, feedback);
	const lease = acquireDiagramRenderer(editor, engine);
	let version = 0;
	let url: string | undefined;
	let invalid = false;
	let destroyed = false;
	let lastSource: string | undefined;
	let lastDark: boolean | undefined;
	let lastSequenceTheme: string | undefined;
	let renderedSvg: string | undefined;
	let actionRunning = false;
	let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
	const closeMenu = () => {
		menu.hidden = true;
	};
	const bytes = async (format: DiagramImageFormat) => {
		if (!renderedSvg) throw new Error("Diagram is not ready.");
		const request = version;
		const background =
			getComputedStyle(dom).getPropertyValue("--md-background").trim() || "#ffffff";
		const result = await diagramImageBytes(renderedSvg, format, background);
		if (destroyed || request !== version) throw new Error("Diagram changed.");
		return result;
	};
	const runAction = async (
		label: string,
		action: () => Promise<string | undefined>,
	) => {
		if (actionRunning) return;
		actionRunning = true;
		clearTimeout(feedbackTimer);
		const request = version;
		closeMenu();
		preview.focus();
		feedback.textContent = `${label}…`;
		try {
			const result = await action();
			if (!destroyed && request === version) {
				feedback.textContent = result ?? (label === "Copying" ? "Image copied." : "Image saved.");
				if (!result || result === "Save canceled.")
					feedbackTimer = setTimeout(() => { feedback.textContent = ""; }, 4000);
			}
		} catch (cause) {
			console.warn("Diagram image action failed", cause);
			if (!destroyed && request === version)
				feedback.textContent = label === "Copying"
					? "Couldn't copy image. Try again."
					: "Couldn't save image. Try again.";
		} finally {
			actionRunning = false;
		}
	};
	const addMenuItem = (label: string, action: () => void) => {
		const item = document.createElement("button");
		item.type = "button";
		item.setAttribute("role", "menuitem");
		item.textContent = label;
		item.addEventListener("click", action);
		menu.append(item);
		return item;
	};
	addMenuItem("Edit", () => {
		closeMenu();
		preview.click();
	});
	addMenuItem("Copy as image", () => {
		void runAction("Copying", async () => {
			await host.imageExports.copy({ bytes: await bytes("png") });
			return undefined;
		});
	});
	addMenuItem("Save diagram as…", () => {
		void runAction("Saving", async () => {
			const request = version;
			const formats: DiagramImageFormat[] = ["svg", "png", "jpeg"];
			const converted = await Promise.allSettled(
				formats.map(async (format) => ({ bytes: await bytes(format), format })),
			);
			if (destroyed || request !== version) throw new Error("Diagram changed.");
			const variants = converted.flatMap((result) =>
				result.status === "fulfilled" ? [result.value] : [],
			);
			const failed = converted.flatMap((result, index) => {
				if (result.status === "fulfilled") return [];
				console.warn("Diagram format conversion failed", formats[index], result.reason);
				return [formats[index]!.toUpperCase()];
			});
			if (!variants.length) throw new Error("Image export failed.");
			const result = await host.imageExports.save({
				name: `${engine}-diagram.svg`,
				variants,
			});
			if (result.canceled) return "Save canceled.";
			return failed.length
				? `Image saved. ${failed.join(" and ")} unavailable; try again to export these formats.`
				: undefined;
		});
	});
	const openMenu = (clientX: number, clientY: number) => {
		if (!renderedSvg || actionRunning) return;
		const rect = dom.getBoundingClientRect();
		menu.hidden = false;
		menu.style.left = `${Math.max(0, Math.min(clientX - rect.left, rect.width - menu.offsetWidth))}px`;
		menu.style.top = `${Math.max(0, Math.min(clientY - rect.top, rect.height - menu.offsetHeight))}px`;
		menu.querySelector<HTMLButtonElement>("button")?.focus();
	};
	const dismissMenu = (event: Event) => {
		if (!menu.contains(event.target as Node)) closeMenu();
	};
	const dismissMenuByKey = (event: KeyboardEvent) => {
		if (menu.hidden) return;
		if (event.key === "Escape") {
			event.preventDefault();
			closeMenu();
			preview.focus();
			return;
		}
		if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const items = [...menu.querySelectorAll<HTMLButtonElement>("button")];
		const current = items.indexOf(document.activeElement as HTMLButtonElement);
		const target =
			event.key === "Home"
				? 0
				: event.key === "End"
					? items.length - 1
					: (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
						items.length;
		items[target]?.focus();
	};
	const selectionChanged = () => {
		const position = getPos();
		const { from, to } = editor.state.selection;
		const editing =
			position !== undefined &&
			from > position &&
			to < position + node.nodeSize;
		pre.hidden = !editing && !invalid;
		language.dom.hidden = !editing;
		toolbar.dom.hidden = !editing || !editor.isEditable;
		preview.disabled = !editor.isEditable;
	};
	const render = () => {
		const source = node.textContent;
		const dark = document.documentElement.classList.contains("dark");
		const sequenceTheme =
			engine === "sequence" &&
			document.documentElement.dataset.sequenceTheme === "hand"
				? "hand"
				: "simple";
		if (
			source === lastSource &&
			dark === lastDark &&
			sequenceTheme === lastSequenceTheme
		)
			return;
		lastSource = source;
		lastDark = dark;
		lastSequenceTheme = sequenceTheme;
		renderedSvg = undefined;
		clearTimeout(feedbackTimer);
		feedback.textContent = "";
		const request = ++version;
		invalid = false;
		picture.hidden = !url;
		status.hidden = Boolean(url);
		preview.setAttribute("aria-busy", String(Boolean(source.trim())));
		status.textContent = source.trim()
			? "Rendering diagram…"
			: "Empty diagram — click to edit.";
		selectionChanged();
		if (!source.trim()) {
			lease.renderer.cancel(dom);
			if (url) URL.revokeObjectURL(url);
			url = undefined;
			picture.hidden = true;
			status.hidden = false;
			return;
		}
		lease.renderer.render(
			dom,
			source,
			dark,
			(result) => {
				if (destroyed || request !== version) return;
				if (url) URL.revokeObjectURL(url);
				url = undefined;
				invalid = !result.svg;
				preview.setAttribute("aria-busy", "false");
				picture.hidden = invalid;
				status.hidden = !invalid;
				if (result.svg) {
					renderedSvg = result.svg;
					url = URL.createObjectURL(
						new Blob([result.svg], { type: "image/svg+xml" }),
					);
					picture.onerror = () => {
						if (destroyed || request !== version) return;
						invalid = true;
						picture.hidden = true;
						status.hidden = false;
						status.textContent =
							"Invalid diagram — the rendered image could not be displayed.";
						selectionChanged();
					};
					picture.src = url;
					picture.hidden = false;
					status.hidden = true;
				} else {
					status.textContent = `Invalid diagram — ${result.error ?? "edit source to correct it."}`;
				}
				selectionChanged();
			},
			sequenceTheme,
		);
	};
	preview.addEventListener("click", () => {
		const position = getPos();
		if (position === undefined || !editor.isEditable) return;
		editor.view.dispatch(
			closeHistory(editor.state.tr).setSelection(
				TextSelection.create(editor.state.doc, position + 1),
			),
		);
		code.focus();
	});
	preview.addEventListener("contextmenu", (event) => {
		event.preventDefault();
		openMenu(event.clientX, event.clientY);
	});
	preview.addEventListener("keydown", (event) => {
		if (
			!(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
		)
			return;
		event.preventDefault();
		const rect = preview.getBoundingClientRect();
		openMenu(rect.left + rect.width / 2, rect.top + rect.height / 2);
	});
	document.addEventListener("pointerdown", dismissMenu, true);
	document.addEventListener("keydown", dismissMenuByKey, true);
	done.addEventListener("click", () => {
		const position = getPos();
		if (position === undefined) return;
		// Finishing source editing selects the existing diagram. Creating a
		// paragraph belongs to the explicit continue-writing command (Mod-Enter).
		editor.view.dispatch(
			closeHistory(editor.state.tr).setSelection(
				NodeSelection.create(editor.state.doc, position),
			),
		);
		preview.focus();
	});
	editor.on("selectionUpdate", selectionChanged);
	const theme = new MutationObserver(render);
	theme.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class", "data-sequence-theme"],
	});
	render();
	return {
		dom,
		setSelection: code.setSelection,
		update(next: typeof node) {
			if (
				next.type !== node.type ||
				diagramEngine(next.attrs.language) !== engine
			)
				return false;
			node = next;
			code.update(next);
			language.update(next);
			render();
			selectionChanged();
			return true;
		},
		ignoreMutation: () => true,
		stopEvent: () => true,
		destroy() {
			clearTimeout(feedbackTimer);
			destroyed = true;
			code.destroy();
			language.destroy();
			theme.disconnect();
			document.removeEventListener("pointerdown", dismissMenu, true);
			document.removeEventListener("keydown", dismissMenuByKey, true);
			editor.off("selectionUpdate", selectionChanged);
			lease.renderer.cancel(dom);
			lease.release();
			if (url) URL.revokeObjectURL(url);
		},
	};
};
