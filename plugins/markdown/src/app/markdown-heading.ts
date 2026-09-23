import { InputRule } from "@tiptap/core";
import { Heading } from "@tiptap/extension-heading";

export function createMarkdownHeading(strictMode = true) {
	return Heading.extend({
		addInputRules() {
			const standard = this.parent?.() ?? [];
			if (strictMode) return standard;
			return [
				...standard,
				new InputRule({
					find: /^(#{1,6})([^#\s])$/,
					handler: ({ state, range, match }) => {
						state.tr
							.insertText(match[2] ?? "", range.from, range.to)
							.setBlockType(range.from, range.from, this.type, {
								level: match[1]?.length ?? 1,
							});
					},
				}),
			];
		},
	});
}
