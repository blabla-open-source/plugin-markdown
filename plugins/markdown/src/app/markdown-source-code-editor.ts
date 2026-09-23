import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState } from "@codemirror/state";
import {
	EditorView,
	type KeyBinding,
	keymap,
	type ViewUpdate,
} from "@codemirror/view";
import type { NodeViewRendererProps } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
	type CodeEditorConfiguration,
	codeEditingExtensions,
} from "./markdown-code-editing";
import type { SourceCodeBinding } from "./markdown-source-code-binding";

function configurationKey(value: CodeEditorConfiguration, editable: boolean) {
	return JSON.stringify([
		value.codeIndentSize, value.codePairing, value.codeLineNumbers,
		value.codeLineWrapping, value.codeSmartIndent, value.dark, editable,
	]);
}

/** One embedded editing runtime; each node binds changes to its existing schema data. */
export function sourceCodeEditor(
	props: NodeViewRendererProps,
	input: {
		label: string;
		binding: SourceCodeBinding;
		preferences: () => CodeEditorConfiguration;
		language: (node: ProseMirrorNode) => string;
		keys: KeyBinding[];
	},
) {
	const { editor, getPos } = props;
	let node = props.node;
	let updating = false;
	let destroyed = false;
	let languageName: string | undefined;
	const initialPreferences = input.preferences();
	let preferencesKey = configurationKey(initialPreferences, editor.isEditable);
	const preferences = new Compartment();
	const language = new Compartment();
	const editable = new Compartment();
	const forward = (update: ViewUpdate) => {
		if (updating || destroyed || (!update.docChanged && !update.selectionSet))
			return;
		if (!update.view.hasFocus && !update.docChanged) return;
		const position = getPos();
		if (position === undefined) return;
		const tr = editor.state.tr;
		if (update.docChanged) input.binding.write(tr, update, position, node);
		const { anchor, head } = update.state.selection.main;
		input.binding.select(tr, position, anchor, head);
		if (
			(update.docChanged && !update.startState.selection.main.empty) ||
			update.transactions.some(
				(t) => t.isUserEvent("input.indent") || t.isUserEvent("indent"),
			)
		)
			closeHistory(tr);
		updating = true;
		try {
			editor.view.dispatch(tr);
		} finally {
			updating = false;
		}
	};
	const documentHistory = (redo: boolean) => {
		const result = redo ? editor.commands.redo() : editor.commands.undo();
		if (result) {
			const position = getPos();
			if (
				!destroyed &&
				position !== undefined &&
				input.binding.selection(editor.state, position, node)
			)
				cm.focus();
			else editor.view.focus();
		}
		return result;
	};
	const cm = new EditorView({
		doc: input.binding.read(node),
		extensions: [
			keymap.of([
				{
					key: "Mod-z",
					run: () => editor.isEditable && documentHistory(false),
				},
				{
					key: "Mod-Shift-z",
					run: () => editor.isEditable && documentHistory(true),
				},
				{ key: "Mod-y", run: () => editor.isEditable && documentHistory(true) },
			]),
			keymap.of(
				input.keys.map((binding) => ({
					...binding,
					run: (view: EditorView) =>
						editor.isEditable && (binding.run?.(view) ?? false),
				})),
			),
			preferences.of(codeEditingExtensions(initialPreferences, initialPreferences.dark)),
			editable.of([
				EditorView.editable.of(editor.isEditable),
				EditorState.readOnly.of(!editor.isEditable),
			]),
			EditorView.editorAttributes.of({ class: "markdown-code-editor" }),
			language.of([]),
			EditorView.contentAttributes.of({
				"aria-label": input.label,
				"aria-multiline": "true",
				spellcheck: "false",
			}),
			EditorView.updateListener.of(forward),
		],
	});
	const configure = () => {
		if (destroyed) return;
		const value = input.preferences();
		const key = configurationKey(value, editor.isEditable);
		if (key !== preferencesKey) {
			preferencesKey = key;
			cm.dispatch({
				effects: [
					preferences.reconfigure(codeEditingExtensions(value, value.dark)),
					editable.reconfigure([
						EditorView.editable.of(editor.isEditable),
						EditorState.readOnly.of(!editor.isEditable),
					]),
				],
			});
		}
		const name = input.language(node);
		if (name === languageName) return;
		if (languageName !== undefined)
			cm.dispatch({ effects: language.reconfigure([]) });
		languageName = name;
		const description = LanguageDescription.matchLanguageName(
			languages,
			name,
			false,
		);
		if (description)
			void description
				.load()
				.then((support) => {
					if (!destroyed && languageName === name)
						cm.dispatch({ effects: language.reconfigure(support) });
				})
				.catch(() => {
					// Text editing remains available when optional highlighting cannot load.
				});
	};
	const setSelection = (anchor: number, head: number) => {
		if (destroyed) return;
		updating = true;
		try {
			cm.focus();
			if (
				cm.state.selection.main.anchor !== anchor ||
				cm.state.selection.main.head !== head
			)
				cm.dispatch({ selection: { anchor, head }, scrollIntoView: true });
		} finally {
			updating = false;
		}
	};
	const update = (next: ProseMirrorNode) => {
		node = next;
		if (!updating) {
			const text = input.binding.read(node);
			const current = cm.state.doc.toString();
			if (text !== current) {
				let start = 0,
					oldEnd = current.length,
					newEnd = text.length;
				while (
					start < oldEnd &&
					start < newEnd &&
					current[start] === text[start]
				)
					start++;
				while (
					oldEnd > start &&
					newEnd > start &&
					current[oldEnd - 1] === text[newEnd - 1]
				) {
					oldEnd--;
					newEnd--;
				}
				updating = true;
				try {
					cm.dispatch({
						changes: {
							from: start,
							to: oldEnd,
							insert: text.slice(start, newEnd),
						},
					});
				} finally {
					updating = false;
				}
			}
		}
		configure();
	};
	const onTransaction = () => {
		configure();
		if (updating || !cm.hasFocus) return;
		const position = getPos();
		if (position === undefined) return;
		const range = input.binding.selection(editor.state, position, node);
		if (range && range !== true) setSelection(range.anchor, range.head);
	};
	editor.on("transaction", onTransaction);
	configure();
	return {
		dom: cm.dom,
		update,
		setSelection,
		view: cm,
		focus: () => {
			const position = getPos();
			const range =
				position === undefined
					? null
					: input.binding.selection(editor.state, position, node);
			if (range && range !== true) setSelection(range.anchor, range.head);
			else cm.focus();
		},
		destroy: () => {
			destroyed = true;
			editor.off("transaction", onTransaction);
			cm.destroy();
		},
	};
}
