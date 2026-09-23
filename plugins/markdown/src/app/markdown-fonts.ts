import { FontFamily, FontSize } from "@tiptap/extension-text-style";
import { clearParentFont } from "./markdown-font-commands";
import {
	inlineStyleAttribute,
	readInlineStyles,
} from "./markdown-inline-style";

// Use official TextStyle attributes and transactions; share safe Markdown styles.
export const MarkdownFontFamily = FontFamily.extend({
	addGlobalAttributes() {
		return [
			{
				types: this.options.types,
				attributes: { fontFamily: inlineStyleAttribute("fontFamily") },
			},
		];
	},
	addCommands() {
		return {
			setFontFamily:
				(fontFamily) =>
				({ chain }) =>
					chain()
						.command(clearParentFont("fontFamily"))
						.setMark("textStyle", { fontFamily })
						.run(),
			unsetFontFamily:
				() =>
				({ chain }) =>
					chain()
						.command(clearParentFont("fontFamily"))
						.setMark("textStyle", { fontFamily: null })
						.removeEmptyTextStyle()
						.run(),
		};
	},
});

export const MarkdownFontSize = FontSize.extend({
	addGlobalAttributes() {
		return [
			{
				types: this.options.types,
				attributes: {
					fontSize: inlineStyleAttribute("fontSize"),
					fontParents: {
						default: null,
						rendered: false,
						parseHTML: (element: HTMLElement) =>
							readInlineStyles(element, true).fontParents,
					},
				},
			},
		];
	},
	addCommands() {
		// An explicit size replaces the whole inherited size, not just its leaf.
		return {
			setFontSize:
				(fontSize) =>
				({ chain }) =>
					chain()
						.command(clearParentFont("fontSize"))
						.setMark("textStyle", { fontSize })
						.run(),
			unsetFontSize:
				() =>
				({ chain }) =>
					chain()
						.command(clearParentFont("fontSize"))
						.setMark("textStyle", { fontSize: null })
						.removeEmptyTextStyle()
						.run(),
		};
	},
});
