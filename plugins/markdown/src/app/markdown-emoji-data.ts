import { emojis } from "@tiptap/extension-emoji";

// Native Unicode only. Do not request third-party fallback images.
export const markdownEmojis = emojis.map(
	({ fallbackImage: _image, ...item }) => item,
);
export const emojiByShortcode = new Map(
	markdownEmojis.flatMap((item) =>
		[...new Set([item.name, ...item.shortcodes])].map(
			(name) => [name, item] as const,
		),
	),
);
export const EMOJI_SHORTCODE = /:([a-zA-Z0-9_+-]+):/g;

export interface EmojiCandidate {
	name: string;
	emoji: string;
}

export function findEmojiCandidates(query: string): EmojiCandidate[] {
	const search = query.toLowerCase();
	return [...emojiByShortcode]
		.filter(
			([name, item]) =>
				name.includes(search) ||
				item.tags.some((tag) => tag.startsWith(search)),
		)
		.sort(
			([a], [b]) =>
				Number(b === search) - Number(a === search) ||
				Number(b.startsWith(search)) - Number(a.startsWith(search)) ||
				a.localeCompare(b),
		)
		.slice(0, 20)
		.map(([name, item]) => ({ name, emoji: item.emoji ?? "" }));
}

export function hasEscapedEmojiPrefix(text: string): boolean {
	return (text.match(/\\+$/)?.[0].length ?? 0) % 2 === 1;
}
