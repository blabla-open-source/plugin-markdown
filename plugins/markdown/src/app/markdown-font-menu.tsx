import { markdownMenuFinalFocus } from "@/app/markdown-menu-focus";
import { useToolCopy } from "./markdown-tool-copy";
import { type Editor, useEditorState } from "@tiptap/react";
import { useState } from "react";
import {
	Popover,
	PopoverContent,
} from "@/components/tiptap-ui-primitive/popover";
import {
	fontParents,
	fontPropertyValue,
	inlineStyleDeclarations,
} from "./markdown-inline-style";
import { MarkdownStyleField } from "./markdown-style-field";

export function MarkdownFontMenu({
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
				!current.can().setFontFamily("serif") ||
				current.isActive("code"),
			family: fontPropertyValue(
				current?.getAttributes("textStyle") ?? {},
				"fontFamily",
			),
			size: fontPropertyValue(
				current?.getAttributes("textStyle") ?? {},
				"fontSize",
			),
			context: fontParents(current?.getAttributes("textStyle"))
				.map((font) => inlineStyleDeclarations(font))
				.join(" → "),
		}),
	});
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverContent
				anchor={panel?.anchor}
				className="markdown-form-panel"
				aria-label={t("Text font")}
				align="start"
				finalFocus={(interaction) =>
					markdownMenuFinalFocus(editor, interaction)
				}
			>
				{state?.context && (
					<p className="markdown-panel-description">
						{t("Font context")}: {state.context}
					</p>
				)}
				<MarkdownStyleField
					label="Font family"
					property="fontFamily"
					placeholder={'Georgia, "Times New Roman", serif'}
					value={state?.family ?? ""}
					apply={(value) => {
						if (value) editor?.chain().focus().setFontFamily(value).run();
						else editor?.chain().focus().unsetFontFamily().run();
						setOpen(false);
					}}
				/>
				<MarkdownStyleField
					label="Font size"
					property="fontSize"
					placeholder="24px, 2rem, 150%"
					value={state?.size ?? ""}
					apply={(value) => {
						if (value) editor?.chain().focus().setFontSize(value).run();
						else editor?.chain().focus().unsetFontSize().run();
						setOpen(false);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}
