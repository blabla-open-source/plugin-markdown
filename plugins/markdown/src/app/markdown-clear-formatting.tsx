import { type Editor } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { prepareMarkdownCommand } from "./markdown-source-focus";

export function clearFormatting(editor: Editor) {
	prepareMarkdownCommand(editor);
	return editor
		.chain()
		.focus()
		.command(({ tr, commands }) => {
			const selection = tr.selection;
			closeHistory(tr);
			for (const { $from, $to } of selection.ranges) {
				commands.setTextSelection({
					from: $from.parent.isTextblock ? $from.start() : $from.pos,
					to: $to.parent.isTextblock ? $to.end() : $to.pos,
				});
				commands.unsetAllMarks();
			}
			tr.setSelection(selection.getBookmark().resolve(tr.doc));
			tr.setStoredMarks([]);
			return true;
		})
		.run();
}
