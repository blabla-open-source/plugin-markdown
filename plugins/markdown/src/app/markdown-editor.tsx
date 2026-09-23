import { EmojiSuggestionPluginKey } from "@tiptap/extension-emoji";
import type { TableOfContentData } from "@tiptap/extension-table-of-contents";
import { EditorContext, useEditor } from "@tiptap/react";
import { exitSuggestion } from "@tiptap/suggestion";
import { RefreshCw, Save } from "lucide-react";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type {
	BlablaHostBridge,
	BlablaHostSettingsRecord,
	BlablaHostSourceTextDocument,
	BlablaHostSourceTextRecoveryDraft,
} from "../host/host-api";
import { MarkdownEditorToolbar } from "./markdown-editor-toolbar";
import { markdownEditorExtensions } from "./markdown-extensions";
import {
	createMarkdownFieldDraft,
	type MarkdownFieldDraft,
} from "./markdown-field-drafts";
import { useMarkdownFileReferenceInsertions } from "./markdown-file-references";
import { useMarkdownLinkNavigation } from "./markdown-link-navigation";
import { useMarkdownPreferences } from "./markdown-preferences";
import { MarkdownSaveFailureBanner } from "./markdown-save-failure-banner";
import { bindMarkdownBlurFlush } from "./markdown-save-policy";
import {
	MarkdownSlashHeadingMenu,
	useMarkdownSlashHeading,
} from "./markdown-slash-heading";
import { useMarkdownSourceController } from "./markdown-source-controller";
import { useMarkdownSyntaxReload } from "./markdown-syntax-reload";
import { MarkdownEditorSurface } from "./markdown-table-of-contents";
import {
	markdownTitleFromFileName,
	normalizeMarkdownTitle,
} from "./markdown-title";

export function MarkdownEditor({
	document,
	host,
	recovery,
	settings,
	dark,
}: {
	document: BlablaHostSourceTextDocument;
	host: BlablaHostBridge;
	recovery: BlablaHostSourceTextRecoveryDraft | null;
	settings: BlablaHostSettingsRecord;
	dark: boolean;
}) {
	const [title, setTitle] = useState(() =>
		markdownTitleFromFileName(document.title),
	);
	const [tableOfContentsItems, setTableOfContentsItems] =
		useState<TableOfContentData>([]);
	const titleDraftRef = useRef<MarkdownFieldDraft | null>(null);
	const [titleFailed, setTitleFailed] = useState(false);
	const titleValueRef = useRef(title);
	titleValueRef.current = title;
	const committedTitleRef = useRef(markdownTitleFromFileName(document.title));
	const slashHeadingCommandRef = useRef<(() => boolean) | null>(null);
	const appRootRef = useRef<HTMLElement | null>(null);
	const editorShellRef = useRef<HTMLElement | null>(null);
	const linkNavigation = useMarkdownLinkNavigation(host);
	const preferences = useMarkdownPreferences(host, settings);
	const codeCreation = useRef({ ...preferences, dark });
	codeCreation.current = { ...preferences, dark };
	const [syntax] = useState(() => ({
		inlineMath: preferences.inlineMath,
		autoLink: preferences.autoLink,
		strictMode: preferences.strictMode,
		alerts: preferences.alerts,
		diagrams: preferences.diagrams,
		highlight: preferences.highlight,
		subscript: preferences.subscript,
		superscript: preferences.superscript,
	}));
	const emojiAutoComplete = useRef(preferences.emojiAutoComplete);
	emojiAutoComplete.current = preferences.emojiAutoComplete;
	const {
		conflict,
		handleEditorUpdate,
		initializeEditorContent,
		readSourceBlock,
		reloadDisk,
		saveDraft,
		saveFailure,
		setEditor: setSourceEditor,
	} = useMarkdownSourceController({
		committedTitleRef,
		document,
		host,
		recovery,
		setTitle,
	});

	const editor = useEditor({
		content: recovery?.content ?? document.content,
		contentType: "markdown",
		shouldRerenderOnTransaction: false,
		editorProps: {
			handleClick: (view, pos, event): boolean =>
				linkNavigation.handleClick(view, pos, event, editor),
			handleKeyDown: (_view, event) => {
				if (event.key !== "Enter") {
					return false;
				}
				const handled = slashHeadingCommandRef.current?.() ?? false;
				if (handled) {
					event.preventDefault();
				}
				return handled;
			},
			attributes: {
				"aria-label": "Markdown document",
				autocomplete: "off",
				autocapitalize: "off",
				autocorrect: "off",
				class: "simple-editor markdown-prosemirror",
				spellcheck: "false",
			},
		},
		extensions: [
			...markdownEditorExtensions({
				host,
				readSourceBlock,
				inlineMath: syntax.inlineMath,
				autoLink: syntax.autoLink,
				strictMode: syntax.strictMode,
				alerts: syntax.alerts,
				diagrams: syntax.diagrams,
				getProseCreationPreferences: () => codeCreation.current,
				getCodeCreationPreferences: () => codeCreation.current,
				getCodeEditorConfiguration: () => codeCreation.current,
				inlineFormats: syntax,
				isEmojiAutoCompleteEnabled: () => emojiAutoComplete.current,
				isBlockExpansionEnabled: () => codeCreation.current.expandSimpleBlock,
				openLink: linkNavigation.openLink,
				onTableOfContentsUpdate: setTableOfContentsItems,
				scrollParent: () => editorShellRef.current ?? window,
			}),
		],
		onMount: ({ editor: activeEditor }) =>
			initializeEditorContent(activeEditor),
		onTransaction: ({
			editor: activeEditor,
			transaction,
			appendedTransactions,
		}) => {
			const batch = [transaction, ...appendedTransactions];
			if (batch.some((entry) => entry.docChanged))
				handleEditorUpdate(activeEditor, batch);
		},
	});
	const slashHeading = useMarkdownSlashHeading(editor);
	useEffect(() => {
		if (editor && !editor.isDestroyed)
			editor.view.dispatch(editor.state.tr.setMeta("codePreferences", true));
	}, [
		editor,
		dark,
		preferences.codeIndentSize,
		preferences.codePairing,
		preferences.codeLineNumbers,
		preferences.codeLineWrapping,
		preferences.codeSmartIndent,
		preferences.expandSimpleBlock,
	]);

	useEffect(() => {
		if (editor && !preferences.emojiAutoComplete)
			exitSuggestion(editor.view, EmojiSuggestionPluginKey);
	}, [editor, preferences.emojiAutoComplete]);

	useEffect(() => {
		setSourceEditor(editor);
	}, [editor, setSourceEditor]);

	useEffect(() => {
		if (!editor) {
			return;
		}
		const editorElement = editor.view.dom;
		return bindMarkdownBlurFlush(editorElement, () => {
			void saveDraft();
		});
	}, [editor, saveDraft]);

	useEffect(() => {
		if (!editor) {
			return;
		}
		const subscription = host.events.on("surface.command", (event) => {
			if (event.command === "undo") {
				editor.commands.undo();
			} else {
				editor.commands.redo();
			}
		});
		return () => subscription.dispose();
	}, [editor, host]);

	useMarkdownFileReferenceInsertions({ editor, host });

	useEffect(() => {
		slashHeadingCommandRef.current = slashHeading.apply;
		return () => {
			if (slashHeadingCommandRef.current === slashHeading.apply) {
				slashHeadingCommandRef.current = null;
			}
		};
	}, [slashHeading.apply]);

	useEffect(() => {
		if (!editor) return;
		const draft = createMarkdownFieldDraft(editor, async () => {
			const captured = titleValueRef.current;
			const nextTitle = normalizeMarkdownTitle(captured);
			if (nextTitle !== committedTitleRef.current) {
				try {
					await host.document.rename({ title: nextTitle });
				} catch (error) {
					setTitleFailed(true);
					throw error;
				}
				committedTitleRef.current = nextTitle;
			}
			setTitleFailed(false);
			if (titleValueRef.current === captured) {
				titleValueRef.current = nextTitle;
				setTitle(nextTitle);
			}
			return true;
		});
		titleDraftRef.current = draft;
		return () => {
			draft.destroy();
			titleDraftRef.current = null;
		};
	}, [editor, host]);
	const commitTitle = useCallback(async () => {
		if ((await titleDraftRef.current?.commit()) === false)
			throw new Error("Markdown title could not be committed.");
	}, []);
	const openEditorLink = useCallback(
		(url: string) => linkNavigation.openLink(url, editor?.view),
		[editor, linkNavigation.openLink],
	);

	const syntaxReload = useMarkdownSyntaxReload(
		appRootRef,
		commitTitle,
		saveDraft,
	);

	return (
		<main ref={appRootRef} className="markdown-app">
			<EditorContext.Provider value={{ editor }}>
				<header className="markdown-chrome">
					<input
						aria-label="Document title"
						aria-invalid={titleFailed}
						aria-describedby={titleFailed ? "markdown-title-error" : undefined}
						className="title-input"
						onBlur={() => void commitTitle().catch(() => undefined)}
						onChange={(event) => {
							titleValueRef.current = event.target.value;
							setTitle(event.target.value);
							titleDraftRef.current?.input();
						}}
						onCompositionStart={() => titleDraftRef.current?.compositionStart()}
						onCompositionEnd={() => titleDraftRef.current?.compositionEnd()}
						disabled={!editor}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.nativeEvent.isComposing) {
								event.currentTarget.blur();
							}
						}}
						spellCheck={false}
						value={title}
					/>

					{titleFailed && (
						<span id="markdown-title-error" role="alert">
							Could not save title. Try saving again.
						</span>
					)}
					<MarkdownEditorToolbar
						editor={editor}
						syntax={syntax}
						preferences={preferences}
						syntaxReload={syntaxReload}
						openEditorLink={openEditorLink}
					/>
				</header>

				{linkNavigation.error && <p role="alert">{linkNavigation.error}</p>}
				{conflict ? (
					<section
						className="conflict-bar"
						data-testid="markdown-conflict-banner"
					>
						<span>Disk version changed</span>
						<button onClick={reloadDisk} type="button">
							<RefreshCw />
							Reload
						</button>
						<button
							onClick={() => void saveDraft({ overwrite: true })}
							type="button"
						>
							<Save />
							Overwrite
						</button>
					</section>
				) : null}

				{!conflict && saveFailure ? (
					<MarkdownSaveFailureBanner
						failure={saveFailure}
						onRetry={() => void saveDraft()}
					/>
				) : null}

				<MarkdownSlashHeadingMenu
					active={slashHeading.active}
					onSelect={slashHeading.apply}
				/>

				<MarkdownEditorSurface
					editor={editor}
					items={tableOfContentsItems}
					shellRef={editorShellRef}
				/>
			</EditorContext.Provider>
		</main>
	);
}
