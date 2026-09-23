import { useToolCopy } from "./markdown-tool-copy";
import { MarkdownCommandMenus } from "./markdown-command-menus";
import type { Editor } from "@tiptap/react";
import { UndoRedoButton } from "@/components/tiptap-ui/undo-redo-button";
import {
	Toolbar,
	ToolbarGroup,
} from "@/components/tiptap-ui-primitive/toolbar";
import { MarkdownContextTools } from "./markdown-context-tools";
import type { useMarkdownPreferences } from "./markdown-preferences";
import { MarkdownPreferencesMenu } from "./markdown-preferences-menu";
import type { useMarkdownSyntaxReload } from "./markdown-syntax-reload";

type Preferences = ReturnType<typeof useMarkdownPreferences>;
type Syntax = Pick<
	Preferences,
	| "inlineMath"
	| "autoLink"
	| "strictMode"
	| "alerts"
	| "diagrams"
	| "highlight"
	| "subscript"
	| "superscript"
>;
export function MarkdownEditorToolbar({
	editor,
	syntax,
	preferences,
	syntaxReload,
	openEditorLink,
}: {
	editor: Editor | null;
	syntax: Syntax;
	preferences: Preferences;
	syntaxReload: ReturnType<typeof useMarkdownSyntaxReload>;
	openEditorLink: (url: string) => void;
}) {
	const t = useToolCopy();
	return (
		<>
			<Toolbar
				className="markdown-toolbar"
				data-plain="true"
				variant="floating"
			>
				<ToolbarGroup>
					<UndoRedoButton
						aria-label={t("Undo")}
						tooltip={t("Undo")}
						action="undo"
						editor={editor ?? undefined}
					/>
					<UndoRedoButton
						aria-label={t("Redo")}
						tooltip={t("Redo")}
						action="redo"
						editor={editor ?? undefined}
					/>
				</ToolbarGroup>

				<MarkdownCommandMenus
					editor={editor}
					alerts={syntax.alerts}
					openEditorLink={openEditorLink}
				/>
				<MarkdownPreferencesMenu
					expandSimpleBlock={preferences.expandSimpleBlock}
					codeCreation={preferences}
					proseCreation={preferences}
					error={syntaxReload.error ?? preferences.error}
					onChange={(next) => preferences.save(next)}
					saving={preferences.saving || syntaxReload.applying}
					inlineMath={preferences.inlineMath}
					autoLink={preferences.autoLink}
					strictMode={preferences.strictMode}
					alerts={preferences.alerts}
					diagrams={preferences.diagrams}
					highlight={preferences.highlight}
					subscript={preferences.subscript}
					superscript={preferences.superscript}
					needsReload={Object.entries(syntax).some(
						([key, value]) => preferences[key as keyof typeof syntax] !== value,
					)}
					onApply={(beforeReload) => syntaxReload.apply(beforeReload)}
					sequenceTheme={preferences.sequenceTheme}
					emojiAutoComplete={preferences.emojiAutoComplete}
				/>
			</Toolbar>
			{editor && (
				<MarkdownContextTools editor={editor} openEditorLink={openEditorLink} />
			)}
		</>
	);
}
