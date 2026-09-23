import { type Editor, useEditorState } from "@tiptap/react";
import { useState } from "react";
import {
	List,
	ListOrdered,
	ListTodo,
	Quote,
	MessageSquareWarning,
	SquareCode,
	Table2,
	Baseline,
	Type,
} from "lucide-react";
import { MarkButton } from "@/components/tiptap-ui/mark-button";
import {
	canToggleMark,
	toggleMark,
	markIcons,
	MARK_SHORTCUT_KEYS,
	type Mark,
} from "@/components/tiptap-ui/mark-button/use-mark";
import {
	canToggle as canHeading,
	toggleHeading,
	type Level,
} from "@/components/tiptap-ui/heading-button/use-heading";
import {
	canToggleList,
	toggleList,
	type ListType,
} from "@/components/tiptap-ui/list-button/use-list";
import {
	canToggleBlockquote,
	toggleBlockquote,
} from "@/components/tiptap-ui/blockquote-button/use-blockquote";
import {
	canToggle as canCode,
	toggleCodeBlock,
} from "@/components/tiptap-ui/code-block-button/use-code-block";
import { LinkPopover } from "@/components/tiptap-ui/link-popover";
import {
	MarkdownNativeMenu,
	type MarkdownMenuEntry,
} from "./markdown-native-menu";
import { MarkdownColorMenu } from "./markdown-color-menu";
import { MarkdownFontMenu } from "./markdown-font-menu";
import { MarkdownTableMenu } from "./markdown-table-menu";
import { clearFormatting } from "./markdown-clear-formatting";
import { prepareMarkdownCommand } from "./markdown-source-focus";
import {
	ALERT_TYPES,
	ALERT_ICON_PATHS,
	alertLabel,
} from "./markdown-alert-types";
import { useToolCopy, type ToolText } from "./markdown-tool-copy";
const markNames: Record<Mark, ToolText> = {
	bold: "Bold",
	italic: "Italic",
	strike: "Strike",
	code: "Code",
	underline: "Underline",
	highlight: "Highlight",
	subscript: "Subscript",
	superscript: "Superscript",
};
export function MarkdownCommandMenus({
	editor,
	alerts,
	openEditorLink,
}: {
	editor: Editor | null;
	alerts: boolean;
	openEditorLink: (url: string) => void;
}) {
	const t = useToolCopy();
	const heading = useEditorState({
		editor,
		selector: ({ editor: e }) =>
			e?.isActive("heading") ? Number(e.getAttributes("heading").level) : 0,
	});
	const [panel, setPanel] = useState<{
		kind: "color" | "font" | "table";
		anchor: HTMLElement;
	} | null>(null);
	const close = () => setPanel(null);
	const mark = (type: Mark): MarkdownMenuEntry => {
		const Icon = markIcons[type];
		return {
			type: "item",
			id: type,
			label: t(markNames[type]),
			icon: <Icon />,
			checked: !!editor?.isActive(type),
			disabled: !canToggleMark(editor, type),
			accelerator: MARK_SHORTCUT_KEYS[type].replace(
				/mod/gi,
				"CommandOrControl",
			),
			run: () => {
				toggleMark(editor, type);
			},
		};
	};
	const lists = (): MarkdownMenuEntry[] =>
		(["bulletList", "orderedList", "taskList"] as ListType[]).map((type) => {
			const Icon =
				type === "bulletList"
					? List
					: type === "orderedList"
						? ListOrdered
						: ListTodo;
			return {
				type: "item",
				id: type,
				label: t(
					type === "bulletList"
						? "Bullet list"
						: type === "orderedList"
							? "Ordered list"
							: "Task list",
				),
				icon: <Icon />,
				checked: !!editor?.isActive(type),
				disabled: !canToggleList(editor, type),
				run: () => {
					toggleList(editor, type);
				},
			};
		});
	const headings = (): MarkdownMenuEntry[] => [
		{
			type: "item",
			id: "body",
			label: t("Body"),
			checked: !!editor?.isActive("paragraph"),
			disabled: !editor?.isEditable || !editor.can().setParagraph(),
			run: () => {
				if (editor) {
					prepareMarkdownCommand(editor);
					editor.chain().focus().setParagraph().run();
				}
			},
		},
		...([1, 2, 3, 4, 5, 6] as Level[]).map(
			(level): MarkdownMenuEntry => ({
				type: "item",
				id: `heading-${level}`,
				label: t(`Heading ${level}`),
				checked: !!editor?.isActive("heading", { level }),
				disabled: !canHeading(editor, level),
				run: () => {
					toggleHeading(editor, level);
				},
			}),
		),
	];
	const insert = (): MarkdownMenuEntry[] => [
		{
			type: "item",
			id: "quote",
			label: t("Blockquote"),
			icon: <Quote />,
			checked: !!editor?.isActive("blockquote"),
			disabled: !canToggleBlockquote(editor),
			run: () => {
				toggleBlockquote(editor);
			},
		},
		...(alerts
			? [
					{
						type: "submenu" as const,
						label: t("Insert alert"),
						icon: <MessageSquareWarning />,
						items: ALERT_TYPES.map(
							(type): MarkdownMenuEntry => ({
								type: "item",
								id: `alert-${type}`,
								label: t(alertLabel(type) as ToolText),
								icon: (
									<svg
										aria-hidden="true"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.8"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<path d={ALERT_ICON_PATHS[type]} />
									</svg>
								),
								disabled: !editor?.isEditable || editor.isActive("codeBlock"),
								run: () => {
									editor
										?.chain()
										.insertContent({
											type: "blockquote",
											attrs: {
												alert: type,
												alertMarker: `[!${type.toUpperCase()}]`,
												alertBlock: true,
											},
											content: [{ type: "paragraph" }],
										})
										.run();
									editor?.view.focus();
								},
							}),
						),
					},
				]
			: []),
		{
			type: "item",
			id: "codeBlock",
			label: t("Code block"),
			icon: <SquareCode />,
			checked: !!editor?.isActive("codeBlock"),
			disabled: !canCode(editor),
			run: () => {
				toggleCodeBlock(editor);
			},
		},
		{
			type: "item",
			id: "table",
			label: t("Table"),
			icon: <Table2 />,
			disabled: !editor?.isEditable || editor.isActive("codeBlock"),
			run: (anchor) => setPanel({ kind: "table", anchor }),
		},
	];
	const more = (): MarkdownMenuEntry[] => [
		...(["strike", "code", "underline", "highlight"] as Mark[]).map(mark),
		{ type: "separator" },
		{
			type: "item",
			id: "color",
			label: t("Text colors"),
			icon: <Baseline />,
			disabled:
				!editor?.isEditable ||
				!editor.can().setColor("red") ||
				editor.isActive("code"),
			run: (anchor) => setPanel({ kind: "color", anchor }),
		},
		{
			type: "item",
			id: "font",
			label: t("Text font"),
			icon: <Type />,
			disabled:
				!editor?.isEditable ||
				!editor.can().setFontFamily("serif") ||
				editor.isActive("code"),
			run: (anchor) => setPanel({ kind: "font", anchor }),
		},
		mark("subscript"),
		mark("superscript"),
		{ type: "separator" },
		{
			type: "item",
			id: "clear",
			label: t("Clear formatting"),
			disabled: !editor?.isEditable,
			run: () => {
				if (editor) clearFormatting(editor);
			},
		},
	];
	return (
		<>
			<MarkdownNativeMenu
				editor={editor}
				label={t("Text style")}
				title={heading ? t(`Heading ${heading}` as ToolText) : t("Body")}
				entries={headings}
			/>
			<MarkdownNativeMenu editor={editor} label={t("Lists")} entries={lists} />
			{(["bold", "italic"] as const).map((type) => (
				<MarkButton
					key={type}
					editor={editor ?? undefined}
					type={type}
					aria-label={t(markNames[type])}
					tooltip={t(markNames[type])}
				/>
			))}
			<LinkPopover
				editor={editor ?? undefined}
				onOpenLink={openEditorLink}
				autoOpenOnLinkActive={false}
			/>
			<MarkdownNativeMenu
				editor={editor}
				label={t("Insert")}
				entries={insert}
			/>
			<MarkdownNativeMenu editor={editor} label={t("More")} entries={more} />
			{panel?.kind === "color" && (
				<MarkdownColorMenu
					editor={editor}
					panel={{ anchor: panel.anchor, close }}
				/>
			)}
			{panel?.kind === "font" && (
				<MarkdownFontMenu
					editor={editor}
					panel={{ anchor: panel.anchor, close }}
				/>
			)}
			{panel?.kind === "table" && (
				<MarkdownTableMenu
					editor={editor}
					panel={{ anchor: panel.anchor, close }}
				/>
			)}
		</>
	);
}
