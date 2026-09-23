import { InputRule } from "@tiptap/core";
import {
	Emoji,
	type EmojiOptions,
	EmojiSuggestionPluginKey,
	inputRegex,
} from "@tiptap/extension-emoji";
import { findSuggestionMatch, Suggestion } from "@tiptap/suggestion";
import {
	type EmojiCandidate,
	emojiByShortcode,
	findEmojiCandidates,
	hasEscapedEmojiPrefix,
	markdownEmojis,
} from "./markdown-emoji-data";
import { renderEmojiCandidates } from "./markdown-emoji-view";

export const MarkdownEmoji = Emoji.extend<
	EmojiOptions & { isAutoCompleteEnabled?: () => boolean }
>({
	markdownTokenizer: {
		name: "emoji",
		level: "inline",
		start: (source) => source.indexOf(":"),
		tokenize(source) {
			const match = /^:([a-zA-Z0-9_+-]+):/.exec(source);
			return match?.[1] && emojiByShortcode.has(match[1])
				? { type: "emoji", raw: match[0], name: match[1] }
				: undefined;
		},
	},
	// The pinned Markdown parser applies marks only to text. The source manager
	// restores this temporary carrier to an official Emoji node after parsing.
	parseMarkdown: (token, helpers) =>
		helpers.createNode("emoji", { name: token.name }, [
			helpers.createTextNode(token.raw ?? ""),
		]),
	parseHTML: () => [
		{
			tag: 'span.md-emoji[md-inline="emoji"]',
			getAttrs: (element) => {
				const name = element.dataset.content;
				return name && emojiByShortcode.has(name) ? { name } : false;
			},
		},
		{
			tag: 'span[data-type="emoji"]',
			getAttrs: (element) =>
				emojiByShortcode.has(element.dataset.name ?? "") ? null : false,
		},
	],
	addInputRules() {
		return [
			new InputRule({
				find: inputRegex,
				handler: ({ state, range, match }) => {
					if (
						!match[1] ||
						!emojiByShortcode.has(match[1]) ||
						hasEscapedEmojiPrefix(
							state.doc.textBetween(state.selection.$from.start(), range.from),
						)
					)
						return null;
					const marks = state.storedMarks ?? state.selection.$from.marks();
					state.tr
						.replaceWith(
							range.from,
							range.to,
							this.type.create({ name: match[1] }, null, marks),
						)
						.setStoredMarks(marks);
					return undefined;
				},
			}),
		];
	},
	// Plain Markdown uses the shared semantic-paste route. Rich HTML keeps nodes.
	addPasteRules: () => [],
	addProseMirrorPlugins() {
		// Do not install the parent's Unicode-to-shortcode appendTransaction.
		return [
			Suggestion<EmojiCandidate, EmojiCandidate>({
				editor: this.editor,
				pluginKey: EmojiSuggestionPluginKey,
				char: ":",
				allowedPrefixes: null,
				container: ".markdown-app",
				findSuggestionMatch: (config) => {
					const match = findSuggestionMatch(config);
					if (!match || !/^[a-zA-Z0-9_+-]+$/.test(match.query)) return null;
					const before = config.$position.parent.textBetween(
						0,
						match.range.from - config.$position.start(),
					);
					return hasEscapedEmojiPrefix(before) ? null : match;
				},
				allow: ({ state, range }) => {
					if (this.options.isAutoCompleteEnabled?.() === false) return false;
					const position = state.doc.resolve(range.from);
					return (
						!position.parent.type.spec.code &&
						!position
							.marks()
							.some(
								(mark) => mark.type.spec.code || mark.type.name === "link",
							) &&
						Boolean(position.parent.type.contentMatch.matchType(this.type))
					);
				},
				items: ({ query }) => findEmojiCandidates(query),
				command: ({ editor, range, props }) => {
					const marks =
						editor.state.storedMarks ??
						editor.state.doc.resolve(range.from).marks();
					editor.view.dispatch(
						editor.state.tr
							.replaceWith(
								range.from,
								range.to,
								this.type.create({ name: props.name }, null, marks),
							)
							.setStoredMarks(marks),
					);
					editor.view.focus();
				},
				render: renderEmojiCandidates,
			}),
		];
	},
}).configure({ emojis: markdownEmojis, enableEmoticons: false });
