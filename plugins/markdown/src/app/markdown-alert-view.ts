import type { NodeViewRenderer } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { alertMarkerEditor } from "./markdown-alert-marker";
import {
	ALERT_TYPES,
	alertIcon,
	alertLabel,
	readAlertType,
} from "./markdown-alert-types";

export const alertNodeView: NodeViewRenderer = ({
	node: initial,
	editor,
	getPos,
	HTMLAttributes,
}) => {
	let node = initial;
	const dom = document.createElement("blockquote");
	for (const [key, value] of Object.entries(HTMLAttributes))
		dom.setAttribute(key, String(value));
	const type = readAlertType(node.attrs.alert);
	if ((!type && node.attrs.alertMarker === null) || node.attrs.alertSource)
		return {
			dom,
			contentDOM: dom,
			update: (next) => {
				if (
					next.type !== node.type ||
					((next.attrs.alert || next.attrs.alertMarker !== null) &&
						!next.attrs.alertSource)
				)
					return false;
				if (readAlertType(next.attrs.alert))
					dom.dataset.alert = next.attrs.alert;
				else dom.removeAttribute("data-alert");
				node = next;
				return true;
			},
		};
	const header = document.createElement("div");
	header.dataset.alertTitle = "";
	header.contentEditable = "false";
	const icon = document.createElement("span");
	icon.className = "markdown-alert-icon";
	icon.setAttribute("aria-hidden", "true");
	const markerButton = document.createElement("button");
	markerButton.type = "button";
	markerButton.textContent = "Edit";
	markerButton.title = "Edit source marker";
	const input = document.createElement("input");
	input.setAttribute("aria-label", "Alert marker");
	input.hidden = true;
	input.spellcheck = false;
	const markerEditor = alertMarkerEditor(editor.view, getPos, input);
	markerButton.addEventListener("click", () => markerEditor.open());
	const select = document.createElement("select");
	select.setAttribute("aria-label", "Alert type");
	for (const variant of ALERT_TYPES)
		select.add(new Option(alertLabel(variant), variant));
	select.add(new Option("Blockquote", ""));
	select.addEventListener("keydown", (event) => {
		if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
		event.preventDefault();
		if (event.shiftKey) editor.commands.redo();
		else editor.commands.undo();
	});
	const body = document.createElement("div");
	body.dataset.alertBody = "";
	header.append(icon, select, markerButton, input);
	dom.append(header, body);
	const refresh = () => {
		const variant = readAlertType(node.attrs.alert);
		if (node.attrs.alertBlock) dom.dataset.alertBlock = "true";
		else dom.removeAttribute("data-alert-block");
		if (variant) dom.dataset.alert = variant;
		else dom.removeAttribute("data-alert");
		markerButton.hidden = !variant;
		icon.hidden = !variant;
		select.hidden = !variant;
		markerButton.setAttribute(
			"aria-label",
			`Edit ${variant ? alertLabel(variant) : "alert"} marker`,
		);
		select.value = node.attrs.alert;
		if (variant) icon.replaceChildren(alertIcon(variant));
	};
	select.addEventListener("change", () => {
		const pos = getPos();
		if (pos === undefined) return;
		editor.view.dispatch(
			closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, {
				...node.attrs,
				alert: readAlertType(select.value),
				alertMarker: select.value ? `[!${select.value.toUpperCase()}]` : null,
			}),
		);
		if (!select.value) editor.commands.focus();
	});
	refresh();
	return {
		dom,
		contentDOM: body,
		update(next) {
			if (
				next.type !== node.type ||
				(!readAlertType(next.attrs.alert) && next.attrs.alertMarker === null) ||
				next.attrs.alertSource
			)
				return false;
			node = next;
			refresh();
			return true;
		},
		stopEvent: (event) => header.contains(event.target as globalThis.Node),
		ignoreMutation: (mutation) =>
			mutation.type !== "selection" && !body.contains(mutation.target),
		destroy: markerEditor.destroy,
	};
};
