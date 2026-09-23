import { InputRule } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

export type CodeCreationPreferences = {
	codeDefaultLanguage: string;
	codeDefaultFor: "fences" | "commands" | "both";
};

export function suggestedCodeLanguage(
	preferences: CodeCreationPreferences,
	origin: "fences" | "commands",
	lastLanguage: string,
): string {
	if (
		preferences.codeDefaultFor !== "both" &&
		preferences.codeDefaultFor !== origin
	)
		return "";
	const language =
		preferences.codeDefaultLanguage === "__LAST"
			? lastLanguage
			: preferences.codeDefaultLanguage;
	return /[\r\n`~]/.test(language) ? "" : language.trim();
}

/** Suggest text only at a newly typed fence; imported nodes keep their attributes. */
export function codeLanguageSuggestion(getLanguage: () => string) {
	return new InputRule({
		find: /^(?:`{3}|~{3})$/,
		handler: ({ state, range, match }) => {
			if (state.selection.$from.parent.type.name !== "paragraph") return null;
			const language = getLanguage();
			if (!language) return null;
			const tr = state.tr.insertText(match[0] + language, range.from, range.to);
			const start = range.from + match[0].length;
			tr.setSelection(
				TextSelection.create(tr.doc, start, start + language.length),
			);
			return undefined;
		},
	});
}
