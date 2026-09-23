import { Blockquote } from "@tiptap/extension-blockquote";

/** Joining prose into a quote keeps the caret at the join, before the moved text. */
export const SourceBlockquote = Blockquote.extend({
	addKeyboardShortcuts() {
		const parent = this.parent?.();
		return {
			...parent,
			Backspace: () => {
				const { $from } = this.editor.state.selection;
				const previous = $from.depth > 0
					? $from.node(-1).maybeChild($from.index(-1) - 1)
					: null;
				return previous?.type === this.type && previous.lastChild?.isTextblock
					? this.editor.commands.joinTextblockBackward()
					: (parent?.Backspace?.({ editor: this.editor }) ?? false);
			},
		};
	},
});
