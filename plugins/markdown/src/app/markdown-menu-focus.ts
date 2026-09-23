import type { Editor } from "@tiptap/core";

/** Restore command focus after a popup or source projection is removed, while
 * respecting a pointer click that deliberately focused another control. */
export function markdownMenuFinalFocus(
	editor: Editor | null | undefined,
	interaction: string,
) {
	const document = editor?.view.dom.ownerDocument;
	const active = document?.activeElement;
	if (
		interaction === "keyboard" ||
		active === document?.body ||
		active?.closest('[role="menu"], .tiptap-popover')
	) {
		// ProseMirror restores the DOM selection before focusing contenteditable.
		// Native element.focus() can instead move the caret to the document start.
		editor?.view.focus();
	}
	return false;
}
