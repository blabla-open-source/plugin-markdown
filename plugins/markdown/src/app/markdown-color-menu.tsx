import { markdownMenuFinalFocus } from "@/app/markdown-menu-focus";
import { useToolCopy } from "./markdown-tool-copy";
import { type Editor, useEditorState } from "@tiptap/react";
import { useState } from "react";
import {
	Popover,
	PopoverContent,
} from "@/components/tiptap-ui-primitive/popover";
import { MarkdownStyleField } from "./markdown-style-field";

export function MarkdownColorMenu({
	editor,
	panel,
}: {
	editor: Editor | null;
	panel: { anchor: HTMLElement; close: () => void };
}) {
	const t = useToolCopy();
	const [open, updateOpen] = useState(!!panel);
	const setOpen = (next: boolean) => {
		updateOpen(next);
		if (!next) panel?.close();
	};
	const state = useEditorState({
		editor,
		selector: ({ editor: current }) => ({
			disabled:
				!current?.isEditable ||
				!current.can().setColor("red") ||
				current.isActive("code"),
			color: current?.getAttributes("textStyle").color ?? "",
			background: current?.getAttributes("textStyle").backgroundColor ?? "",
		}),
	});
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverContent
				anchor={panel?.anchor}
				className="markdown-form-panel"
				aria-label={t("Text colors")}
				align="start"
				finalFocus={(interaction) =>
					markdownMenuFinalFocus(editor, interaction)
				}
			>
				<MarkdownStyleField
					label="Text color"
					property="color"
					placeholder="red, #ff0000, rgb(255 0 0)"
					value={state?.color ?? ""}
					apply={(value) => {
						if (value) editor?.chain().focus().setColor(value).run();
						else editor?.chain().focus().unsetColor().run();
						setOpen(false);
					}}
				/>
				<MarkdownStyleField
					label="Background color"
					property="backgroundColor"
					placeholder="yellow, #ffff00, rgb(255 255 0)"
					value={state?.background ?? ""}
					apply={(value) => {
						if (value) editor?.chain().focus().setBackgroundColor(value).run();
						else editor?.chain().focus().unsetBackgroundColor().run();
						setOpen(false);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}
