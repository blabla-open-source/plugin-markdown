import { joinEmptyMixedListItem } from "./markdown-mixed-list-movement";
import { MarkdownUnderline } from "./markdown-underline";
import { MarkdownTable } from "./markdown-table";
import { MarkdownBlockExpansion } from "./markdown-block-expansion";
import { MarkdownExpandedBlock } from "./markdown-block-expansion-source";
import { MarkdownLinkDefinition } from "./markdown-reference-links";
import { ProseListIndentation, withProseCreation } from "./markdown-prose-creation";
import type { ProseCreationPreferences } from "./markdown-prose-style";
import {
	defaultCodeEditorConfiguration,
	type CodeEditorConfiguration,
} from "./markdown-code-editing";
import type { JSONContent } from "@tiptap/core";
import { Code } from "@tiptap/extension-code";
import { FileHandler } from "@tiptap/extension-file-handler";
import { createMarkdownImage } from "./markdown-images";
import { BulletList, TaskItem, TaskList } from "@tiptap/extension-list";
import { Paragraph } from "@tiptap/extension-paragraph";
import { joinTextblockForward } from "@tiptap/pm/commands";
import { TableKit } from "@tiptap/extension-table";
import {
	type TableOfContentData,
	TableOfContents,
} from "@tiptap/extension-table-of-contents";
import StarterKit from "@tiptap/starter-kit";
import type { BlablaHostBridge } from "../host/host-api";
import { createMarkdownBlockquote } from "./markdown-alerts";
import { MarkdownAudio } from "./markdown-audio";
import type { CodeCreationPreferences } from "./markdown-code-creation";
import { MarkdownCodeBlock } from "./markdown-code-block";
import {
	MarkdownBackgroundColor,
	MarkdownColor,
	MarkdownTextStyle,
} from "./markdown-colors";
import { MarkdownEmoji } from "./markdown-emoji";
import {
	importAndInsertMediaFiles,
	MARKDOWN_MEDIA_MIME_TYPES,
} from "./markdown-file-references";
import { MarkdownFontFamily, MarkdownFontSize } from "./markdown-fonts";
import {
	MarkdownFootnoteDefinition,
	MarkdownFootnoteReference,
} from "./markdown-footnotes";
import {
	MarkdownDocument,
	MarkdownFrontMatter,
	MarkdownHorizontalRule,
} from "./markdown-front-matter";
import { markdownGrammar } from "./markdown-grammar";
import { createMarkdownHeading } from "./markdown-heading";
import { MarkdownHtmlAnchor } from "./markdown-html-anchor";
import { MarkdownHtmlBlock } from "./markdown-html-block";
import type { HtmlBlockOpenLink } from "./markdown-html-block-view";
import { MarkdownHtmlBreak } from "./markdown-html-break";
import { MarkdownHtmlComment } from "./markdown-html-comments";
import { MarkdownIframe } from "./markdown-iframe";
import {
	type InlineFormatPreferences,
	markdownInlineFormats,
} from "./markdown-inline-formats";
import { MarkdownInlineHtmlLiteral } from "./markdown-inline-html-literal";
import { MarkdownKeyboard } from "./markdown-keyboard";
import { createMarkdownLink } from "./markdown-links";
import { createMarkdownInlineMath, MarkdownBlockMath } from "./markdown-math";
import { MarkdownMediaSourceResolver } from "./markdown-media-source";
import {
	createMarkdownListItem,
	MarkdownOrderedList,
} from "./markdown-ordered-list";
import { MarkdownRuby } from "./markdown-ruby";
import { MarkdownSemanticPaste } from "./markdown-semantic-paste";
import { SourceMarkdown } from "./markdown-source-manager";
import type { MarkdownSourceBlockReader } from "./markdown-source-patch";
import { MarkdownTocBlock } from "./markdown-toc-block";
import { MarkdownVideo } from "./markdown-video";
import { MarkdownWordBreakLiteral } from "./markdown-word-break";

export const MARKDOWN_HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

export function markdownEditorExtensions(input: {
	host: BlablaHostBridge;
	readSourceBlock?: MarkdownSourceBlockReader;
	openLink: HtmlBlockOpenLink;
	onTableOfContentsUpdate: (items: TableOfContentData) => void;
	scrollParent: () => HTMLElement | Window;
	isEmojiAutoCompleteEnabled?: () => boolean;
 isBlockExpansionEnabled?: () => boolean;
	inlineMath?: boolean;
	autoLink?: boolean;
	strictMode?: boolean;
	alerts?: boolean;
	diagrams?: boolean;
	getProseCreationPreferences?: () => ProseCreationPreferences;
	getCodeEditorConfiguration?: () => CodeEditorConfiguration;
	getCodeCreationPreferences?: () => CodeCreationPreferences;
	inlineFormats?: InlineFormatPreferences;
}) {
	const mediaResolver = new MarkdownMediaSourceResolver(input.host);
	return [
 MarkdownExpandedBlock,
 MarkdownLinkDefinition,
 MarkdownBlockExpansion(input.isBlockExpansionEnabled ?? (() => false), input.readSourceBlock),
		StarterKit.configure({
			blockquote: false,
			paragraph: false,
			code: false,
			codeBlock: false,
			document: false,
			horizontalRule: false,
			// These blocks have a keyboard exit; do not pre-append a second blank.
			trailingNode: {
				notAfter: [
					"paragraph",
					"footnoteDefinition",
 "linkDefinition",
 "expandedBlock",
					"blockquote",
					"htmlBlock",
				],
			},
			heading: false,
			orderedList: false,
			bulletList: false,
			listItem: false,
			link: false,
			underline: false,
		}),
		MarkdownUnderline,
		withProseCreation(createMarkdownHeading(input.strictMode !== false), input.getProseCreationPreferences).configure({
			levels: [...MARKDOWN_HEADING_LEVELS],
		}),
		withProseCreation(MarkdownOrderedList, input.getProseCreationPreferences),
		withProseCreation(BulletList, input.getProseCreationPreferences),
		createMarkdownListItem(input.strictMode !== false),
		ProseListIndentation,
		MarkdownDocument,
		// DOM edits must preserve soft newlines as text. External HTML still uses
		// ordinary paragraph whitespace; native clipboard rules opt in separately.
		Paragraph.extend({
			priority: 110,
			whitespace: "pre",
			parseHTML: () => [{ tag: "p", preserveWhitespace: false }],
			addKeyboardShortcuts() {
				return {
					...this.parent?.(),
					Delete: () => this.editor.isActive("paragraph") && joinTextblockForward(
						this.editor.state, tr => this.editor.view.dispatch(tr), this.editor.view,
					),
					"Shift-Enter": () => this.editor.isActive("paragraph") && this.editor.commands.command(({ tr }) => {
            for (let depth = tr.selection.$from.depth; depth > 0; depth--)
              if (tr.selection.$from.node(depth).type.spec.tableRole) return false;
						tr.insertText("\n");
						return true;
					}),
				};
			},
		}),
		// GFM permits inline code inside links and emphasis. Preserve both marks
		// when a DOM edit reparses the paragraph, not just during initial import.
		Code.extend({
			excludes: "",
			parseMarkdown: (token, helpers) => helpers.applyMark("code", [helpers.createTokenText(token)]),
			addCommands() {
				return {
					...this.parent?.(),
					toggleCode: () => ({ commands }) =>
						commands.toggleMark(this.name, {}, { extendEmptyMarkRange: true }),
				};
			},
		}),
		withProseCreation(createMarkdownBlockquote(input.alerts !== false), input.getProseCreationPreferences),
		MarkdownHtmlBlock(input.openLink, mediaResolver, input.host.navigation).configure({ getCodeEditorConfiguration: input.getCodeEditorConfiguration ?? (() => defaultCodeEditorConfiguration) }),
		MarkdownHtmlComment,
		MarkdownAudio(mediaResolver),
		MarkdownVideo(mediaResolver),
		MarkdownIframe(mediaResolver, input.host.navigation),
		MarkdownTextStyle.configure({ readSourceBlock: input.readSourceBlock }),
		MarkdownKeyboard,
		MarkdownRuby(input.openLink, mediaResolver),
		MarkdownColor,
		MarkdownBackgroundColor,
		MarkdownFontFamily,
		MarkdownFontSize,
		MarkdownHtmlAnchor,
		createMarkdownLink(input.autoLink !== false),
		MarkdownTocBlock,
		MarkdownSemanticPaste,
		MarkdownEmoji.configure({
			isAutoCompleteEnabled: input.isEmojiAutoCompleteEnabled ?? (() => true),
		}),
		MarkdownFrontMatter,
		MarkdownHorizontalRule,
		MarkdownFootnoteReference,
		MarkdownFootnoteDefinition,
		MarkdownHtmlBreak,
		MarkdownInlineHtmlLiteral,
		MarkdownWordBreakLiteral,
		SourceMarkdown.configure({
			marked: markdownGrammar(input.strictMode !== false),
			indentation: {
				size: 2,
				style: "space",
			},
		}),
		MarkdownCodeBlock(input.host).configure({
			diagrams: input.diagrams !== false,
			getCodeEditorConfiguration:
				input.getCodeEditorConfiguration ?? (() => defaultCodeEditorConfiguration),
			getCodeCreationPreferences:
				input.getCodeCreationPreferences ??
				(() => ({ codeDefaultLanguage: "", codeDefaultFor: "fences" })),
		}),
		withProseCreation(TaskList, input.getProseCreationPreferences),
		TaskItem.extend({
      addKeyboardShortcuts() {
        const parent = this.parent?.() ?? {};
        return { ...parent, Backspace: () => this.editor.commands.command(joinEmptyMixedListItem) || (parent.Backspace?.({ editor: this.editor }) ?? false) };
      },
			renderMarkdown: createMarkdownListItem(input.strictMode !== false).config.renderMarkdown,
			parseHTML() {
				return [
					// TaskItem's exported checkbox label is UI, not document content.
					{ tag: 'li[data-type="taskItem"] > label', ignore: true },
					...(this.parent?.() ?? []),
				];
			},
		}).configure({
			nested: true,
		}),
		createMarkdownImage(mediaResolver).configure({
			allowBase64: false,
			HTMLAttributes: {
				loading: "lazy",
			},
		}),
		FileHandler.configure({
			allowedMimeTypes: MARKDOWN_MEDIA_MIME_TYPES,
			onDrop: (editor, files, position) => {
				void importAndInsertMediaFiles({
					editor,
					files,
					host: input.host,
					position,
				}).catch(reportMediaImportFailure);
			},
			onPaste: (editor, files) => {
				void importAndInsertMediaFiles({
					editor,
					files,
					host: input.host,
				}).catch(reportMediaImportFailure);
			},
		}),
		TableKit.configure({
			table: false,
		}),
		MarkdownTable.configure({ resizable: true }),
		MarkdownBlockMath.configure({ getCodeEditorConfiguration: input.getCodeEditorConfiguration ?? (() => defaultCodeEditorConfiguration) }),
		createMarkdownInlineMath(input.inlineMath !== false),
		...markdownInlineFormats(input.inlineFormats),
		MarkdownTableOfContents(input),
	];
}

function reportMediaImportFailure(error: unknown): void {
	console.error("Markdown media import failed.", error);
}

function MarkdownTableOfContents(input: {
	onTableOfContentsUpdate: (items: TableOfContentData) => void;
	scrollParent: () => HTMLElement | Window;
}) {
	return TableOfContents.configure({
		anchorTypes: ["heading"],
		onUpdate: input.onTableOfContentsUpdate,
		scrollParent: input.scrollParent,
	});
}

export type MarkdownDocumentContent = JSONContent;
