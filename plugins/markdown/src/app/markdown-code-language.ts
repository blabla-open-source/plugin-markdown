import { languageChoices } from "./markdown-language-choices";
import { languages as codeLanguages } from "@codemirror/language-data";
import type { NodeViewRendererProps } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { isMarkdownSaveShortcut } from "./markdown-save-policy";

import { createMarkdownFieldDraft } from "./markdown-field-drafts";

/** One language attribute controls both ordinary code and diagram rendering. */
export function codeLanguageControl({
	node: initial,
	editor,
	getPos,
	extension,
}: NodeViewRendererProps) {
	let node = initial;
	const dom = document.createElement("div");
	dom.className = "markdown-code-language";
	dom.contentEditable = "false";
	const input = document.createElement("input");
	input.setAttribute("aria-label", "Code language");
	input.placeholder = "Plain text";
	input.spellcheck = false;
	input.autocomplete = "off";
	input.maxLength = 128;
	const languages = new Set<string>([
		...(extension.options.diagrams
			? ["mermaid", "flow", "flowchart", "sequence"]
			: []),
		"text",
		...codeLanguages.flatMap((language) => [
			language.name.toLowerCase(),
			...language.alias,
		]),
	]);
	dom.append(input);
	const refresh = () => {
		const position = getPos();
		const { from, to } = editor.state.selection;
		dom.hidden =
			position === undefined ||
			from < position ||
			to > position + node.nodeSize;
		input.disabled = !editor.isEditable;
		if (
			document.activeElement !== input &&
			!draft.pending
		)
			input.value = node.attrs.language ?? "";
	};
	const draft = createMarkdownFieldDraft(editor, () => {
		const language = input.value.trim();
		input.setCustomValidity(
			/[\r\n`~]/.test(language)
				? "Remove backticks and tildes from the code language."
				: "",
		);
		if (!input.reportValidity()) return false;
		const position = getPos();
		if (position === undefined) return false;
		const current = editor.state.doc.nodeAt(position);
		if (current?.type !== node.type) return false;
		const focused = document.activeElement === input;
		const selection = [input.selectionStart, input.selectionEnd] as const;
		if (language !== (current.attrs.language ?? ""))
			editor.view.dispatch(
				closeHistory(editor.state.tr).setNodeMarkup(position, undefined, {
					...current.attrs,
					language: language || null,
				}),
			);
		// A language change can replace plain-code and diagram NodeViews. Background
		// preservation must keep typing in the replacement field, not the document.
		if (focused && !input.isConnected) {
			const root = editor.view.nodeDOM(position);
			const next =
				root instanceof HTMLElement
					? root.querySelector<HTMLInputElement>(
							".markdown-code-language input",
						)
					: null;
			next?.focus({ preventScroll: true });
			next?.setSelectionRange(selection[0], selection[1]);
		}
		return true;
	});
	const commit = draft.commit;
	const choices = languageChoices(input, [...languages], commit);
	dom.append(choices.dom);
	input.addEventListener("compositionstart", draft.compositionStart);
	input.addEventListener("compositionend", draft.compositionEnd);
	input.addEventListener("change", commit);
	input.addEventListener("input", () => {
		input.setCustomValidity("");
		draft.input();
	});
	input.addEventListener("keydown", (event) => {
		if (!event.isComposing && isMarkdownSaveShortcut(event)) {
			if (!commit()) {
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}
		if (event.isComposing || (event.key !== "Enter" && event.key !== "Escape"))
			return;
		event.preventDefault();
		if (event.key === "Escape") {
			input.value = node.attrs.language ?? "";
			draft.cancel();
			input.setCustomValidity("");
		} else if (!commit()) return;
		editor.view.focus();
	});
	editor.on("selectionUpdate", refresh);
	refresh();
	return {
		dom,
		update(next: ProseMirrorNode) {
			node = next;
			refresh();
		},
		destroy() {
			choices.destroy();
			draft.destroy();
			editor.off("selectionUpdate", refresh);
		},
	};
}
