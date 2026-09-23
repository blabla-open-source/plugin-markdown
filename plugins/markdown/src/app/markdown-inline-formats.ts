import { type Mark, type MarkdownTokenizer, markInputRule } from "@tiptap/core";
import { Highlight } from "@tiptap/extension-highlight";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";

export type InlineFormatPreferences = {
	highlight: boolean;
	subscript: boolean;
	superscript: boolean;
};

function scriptTokenizer(
	name: string,
	delimiter: "~" | "^",
): MarkdownTokenizer {
	const pattern =
		delimiter === "~"
			? /^~(?![\s~])([^~\n]+?)(?<!\s)~(?!~)/
			: /^\^(?![\s^])([^^\n]+?)(?<!\s)\^(?!\^)/;
	return {
		name,
		level: "inline",
		start: (source) => source.indexOf(delimiter),
		tokenize(source, _tokens, helpers) {
			const match = pattern.exec(source);
			return match
				? {
						type: name,
						raw: match[0],
						text: match[1],
						tokens: helpers.inlineTokens(match[1] ?? ""),
					}
				: undefined;
		},
	};
}

function optionalFormat(
	extension: Mark,
	enabled: boolean,
	delimiter: string,
	tokenizer?: MarkdownTokenizer,
) {
	return extension.extend({
		addOptions() {
			return { ...this.parent?.(), syntaxEnabled: enabled };
		},
		markdownTokenizer: enabled
			? tokenizer
			: {
					name: extension.name,
					level: "inline",
					// Marked GFM also accepts single tildes as strike. A disabled
					// subscript delimiter remains text; double tildes still reach GFM.
					start: (source) =>
						delimiter === "~" ? source.search(/(?<!~)~(?!~)/) : -1,
					tokenize: (source) =>
						delimiter === "~" && /^~(?!~)/.test(source)
							? { type: extension.name, raw: "~", text: "~" }
							: undefined,
				},
		parseMarkdown: (token, helpers) =>
			!enabled
				? helpers.createTextNode(token.raw ?? "")
				: helpers.applyMark(
						extension.name,
						helpers.parseInline(token.tokens ?? []),
					),
		renderMarkdown: (node, helpers) => {
			const content = helpers.renderChildren(node);
			// Disabled formats are projected to semantic HTML by MarkdownSourceManager.
			return `${delimiter}${content}${delimiter}`;
		},
		addInputRules() {
			if (!enabled) return [];
			if (!tokenizer) return this.parent?.() ?? [];
			return [
				markInputRule({
					type: this.type,
					find: (text) => {
						const pattern =
							delimiter === "~"
								? /~(?![\s~])([^~\n]+?)(?<!\s)~$/
								: /\^(?![\s^])([^^\n]+?)(?<!\s)\^$/;
						const match = pattern.exec(text);
						if (!match) return null;
						const before = text.slice(0, match.index);
						if (
							before.endsWith(delimiter) ||
							(before.match(/\\+$/)?.[0].length ?? 0) % 2
						)
							return null;
						return {
							index: match.index,
							text: match[0],
							replaceWith: match[1],
						};
					},
				}),
			];
		},
		addPasteRules() {
			return enabled ? (this.parent?.() ?? []) : [];
		},
	});
}

export function markdownInlineFormats(preferences?: InlineFormatPreferences) {
	return [
		optionalFormat(Highlight, preferences?.highlight !== false, "=="),
		optionalFormat(
			Subscript,
			preferences?.subscript !== false,
			"~",
			scriptTokenizer("subscript", "~"),
		),
		optionalFormat(
			Superscript,
			preferences?.superscript !== false,
			"^",
			scriptTokenizer("superscript", "^"),
		),
	];
}

/** Plain text must remain literal after an edited block is saved and reopened. */
export function protectInlineFormatLiterals(
	text: string,
	preferences: InlineFormatPreferences,
	protect: (text: string) => string,
): string {
	return text.replace(/[~^]|==/g, (value, index: number) => {
		const needsEscape =
			value === "=="
				? preferences.highlight
				: value === "^"
					? preferences.superscript
					: preferences.subscript ||
						text[index - 1] === "~" ||
						text[index + 1] === "~";
		return protect(
			needsEscape ? [...value].map((char) => `\\${char}`).join("") : value,
		);
	});
}
