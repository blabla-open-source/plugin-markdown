import { useToolCopy } from "./markdown-tool-copy";
import { TextSelection } from "@tiptap/pm/state";
import { isInTable } from "@tiptap/pm/tables";
import type { Editor } from "@tiptap/react";
import { BubbleMenu, type BubbleMenuProps } from "@tiptap/react/menus";
import { useCallback } from "react";
import { LinkPopover } from "@/components/tiptap-ui/link-popover";
import { MarkButton } from "@/components/tiptap-ui/mark-button";
import { MarkdownTableMenu } from "./markdown-table-menu";

const textOptions: BubbleMenuProps["options"] = {
	placement: "top",
	offset: 8,
	flip: true,
	shift: { padding: 8 },
};
const tableOptions: BubbleMenuProps["options"] = {
	...textOptions,
	placement: "top-end",
};
const showTextTools: NonNullable<BubbleMenuProps["shouldShow"]> = ({
	editor,
	state,
	view,
	element,
}) =>
	editor.isEditable &&
	!editor.isActive("codeBlock") &&
	state.selection instanceof TextSelection &&
	!state.selection.empty &&
	(view.hasFocus() || element.contains(document.activeElement));
const showTableTools: NonNullable<BubbleMenuProps["shouldShow"]> = ({
	editor,
	state,
	view,
	element,
}) =>
	editor.isEditable &&
	isInTable(state) &&
	(state.selection.empty || !(state.selection instanceof TextSelection)) &&
	(view.hasFocus() || element.contains(document.activeElement));

export function MarkdownContextTools({
	editor,
	openEditorLink,
}: {
	editor: Editor;
	openEditorLink: (url: string) => void;
}) {
	const t = useToolCopy();
	const tableReference = useCallback(() => {
		const { $from } = editor.state.selection;
		for (let depth = $from.depth; depth > 0; depth--) {
			if ($from.node(depth).type.name !== "table") continue;
			const node = editor.view.nodeDOM($from.before(depth));
			if (node instanceof HTMLElement)
				return {
					getBoundingClientRect: () =>
						(node.querySelector("table") ?? node).getBoundingClientRect(),
				};
		}
		return null;
	}, [editor]);
	return (
		<>
			<BubbleMenu
				editor={editor}
				pluginKey="markdown-selection-tools"
				className="markdown-context-tools"
				role="toolbar"
				aria-label={t("Selected text tools")}
				options={textOptions}
				shouldShow={showTextTools}
			>
				<MarkButton
					editor={editor}
					type="bold"
					aria-label={t("Bold")}
					tooltip={t("Bold")}
				/>
				<MarkButton
					editor={editor}
					type="italic"
					aria-label={t("Italic")}
					tooltip={t("Italic")}
				/>
				<LinkPopover
					editor={editor}
					onOpenLink={openEditorLink}
					autoOpenOnLinkActive={false}
				/>
			</BubbleMenu>
			<BubbleMenu
				editor={editor}
				pluginKey="markdown-table-tools"
				getReferencedVirtualElement={tableReference}
				className="markdown-context-tools"
				role="toolbar"
				aria-label={t("Table tools")}
				options={tableOptions}
				shouldShow={showTableTools}
			>
				<span>{t("Table")}</span>
				<MarkdownTableMenu editor={editor} />
			</BubbleMenu>
		</>
	);
}
