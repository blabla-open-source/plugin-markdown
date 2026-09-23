import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
	defaultKeymap,
	indentMore,
	indentLess,
	indentSelection,
} from "@codemirror/commands";
import {
	indentUnit,
	syntaxHighlighting,
	defaultHighlightStyle,
} from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import {
	EditorView,
	keymap,
	lineNumbers,
	drawSelection,
	highlightActiveLine,
} from "@codemirror/view";

export type CodeEditingPreferences = {
	codeIndentSize: number;
	codePairing: boolean;
	codeLineNumbers: boolean;
	codeLineWrapping: boolean;
	codeSmartIndent: boolean;
};
export const defaultCodeEditing: CodeEditingPreferences = {
	codeIndentSize: 4,
	codePairing: true,
	codeLineNumbers: false,
	codeLineWrapping: true,
	codeSmartIndent: false,
};

export type CodeEditorConfiguration = CodeEditingPreferences & { dark: boolean };
export const defaultCodeEditorConfiguration: CodeEditorConfiguration = {
	...defaultCodeEditing,
	dark: false,
};

// Theme extensions own stylesheet identities. Reuse them across code views
// so creating another block does not install another copy of the same rules.
const lightTheme = EditorView.theme({}, { dark: false });
const darkTheme = EditorView.theme({}, { dark: true });

export function codeEditingExtensions(
	value: CodeEditingPreferences,
	dark = false,
): Extension {
	return [
		EditorState.tabSize.of(value.codeIndentSize),
		indentUnit.of(" ".repeat(value.codeIndentSize)),
		value.codeLineNumbers ? lineNumbers() : [],
		value.codeLineWrapping ? EditorView.lineWrapping : [],
		value.codePairing ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : [],
		keymap.of([
			{
				key: "Tab",
				run: (view) => {
					if (view.state.readOnly) return false;
					if (!view.state.selection.main.empty) return indentMore(view);
					view.dispatch(view.state.replaceSelection("\t"));
					return true;
				},
			},
			{
				key: "Shift-Tab",
				run: value.codeSmartIndent ? indentSelection : indentLess,
			},
			...defaultKeymap,
		]),
		drawSelection(),
		highlightActiveLine(),
		dark ? darkTheme : lightTheme,
		syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle),
	];
}
