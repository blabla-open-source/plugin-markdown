import {
	autoUpdate,
	computePosition,
	flip,
	offset,
	shift,
} from "@floating-ui/react";
import { DOMSerializer } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { findFootnote } from "./markdown-footnote-navigation";

export function footnotePreview(
	label: HTMLButtonElement,
	view: EditorView,
	getLabel: () => string,
) {
	let preview: HTMLDivElement | undefined;
	let cleanup: (() => void) | undefined;
	let leaveTimer: ReturnType<typeof setTimeout> | undefined;
	const id = `footnote-preview-${crypto.randomUUID()}`;
	const hide = () => {
		clearTimeout(leaveTimer);
		cleanup?.();
		cleanup = undefined;
		preview?.remove();
		preview = undefined;
		label.removeAttribute("aria-describedby");
		document.removeEventListener("keydown", onKeyDown, true);
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		hide();
	};
	const leave = () => {
		clearTimeout(leaveTimer);
		leaveTimer = setTimeout(() => {
			if (
				document.activeElement !== label &&
				!label.matches(":hover") &&
				!preview?.matches(":hover")
			)
				hide();
		}, 120);
	};
	const show = () => {
		clearTimeout(leaveTimer);
		if (preview || label.hidden) return;
		const container = view.dom.closest(".markdown-app");
		if (!container) return;
		const found = findFootnote(view.state.doc, getLabel());
		const element = document.createElement("div");
		preview = element;
		element.id = id;
		element.className = "footnote-preview";
		element.setAttribute("role", "tooltip");
		if (found) {
			element.append(
				DOMSerializer.fromSchema(view.state.schema).serializeFragment(
					found.node.content,
				),
			);
		} else {
			element.textContent = `No definition for ${getLabel()}. Ctrl/⌘ click to create it.`;
		}
		for (const child of element.querySelectorAll<HTMLElement>(
			"a, button, input, [tabindex]",
		)) {
			child.tabIndex = -1;
		}
		element.addEventListener("mousedown", (event) => event.preventDefault());
		element.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
		});
		element.addEventListener("mouseenter", () => clearTimeout(leaveTimer));
		element.addEventListener("mouseleave", leave);
		container.append(element);
		label.setAttribute("aria-describedby", id);
		document.addEventListener("keydown", onKeyDown, true);
		cleanup = autoUpdate(label, element, () => {
			void computePosition(label, element, {
				strategy: "fixed",
				placement: "bottom-start",
				middleware: [
					offset(4),
					flip({ padding: 8 }),
					shift({ padding: 8, crossAxis: true }),
				],
			}).then(({ x, y }) => {
				if (preview !== element) return;
				element.style.left = `${x}px`;
				element.style.top = `${y}px`;
			});
		});
	};
	label.addEventListener("mouseenter", show);
	label.addEventListener("mouseleave", leave);
	label.addEventListener("focus", show);
	label.addEventListener("blur", hide);
	return {
		hide,
		destroy() {
			hide();
			label.removeEventListener("mouseenter", show);
			label.removeEventListener("mouseleave", leave);
			label.removeEventListener("focus", show);
			label.removeEventListener("blur", hide);
		},
	};
}
