import type { Node } from "@tiptap/pm/model";
import { NodeSelection, Plugin, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

export function findFootnote(doc: Node, label: string) {
	let found: { node: Node; pos: number } | undefined;
	doc.descendants((node, pos) => {
		if (
			!found &&
			node.type.name === "footnoteDefinition" &&
			node.attrs.label === label
		)
			found = { node, pos };
	});
	return found;
}

export function focusFootnote(view: EditorView, label?: string): boolean {
	const { selection, doc, schema } = view.state;
	const reference = selection instanceof NodeSelection ? selection.node : null;
	const target =
		label ??
		(reference?.type.name === "footnoteReference"
			? reference.attrs.label
			: undefined);
	const definitionType = schema.nodes.footnoteDefinition;
	if (!target || !view.editable || !definitionType) return false;
	const found = findFootnote(doc, target);
	const tr = view.state.tr;
	const pos = found?.pos ?? doc.content.size;
	if (!found) tr.insert(pos, definitionType.create({ label: target }));
	tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView();
	view.dispatch(tr);
	view.focus();
	return true;
}

function footnoteDecorations(doc: Node): DecorationSet {
	const references = new Map<string, number[]>();
	const definitions: { node: Node; pos: number }[] = [];
	doc.descendants((node, pos) => {
		if (node.type.name === "footnoteReference") {
			const entries = references.get(node.attrs.label) ?? [];
			entries.push(pos);
			references.set(node.attrs.label, entries);
		}
		if (node.type.name === "footnoteDefinition")
			definitions.push({ node, pos });
	});
	const decorations = definitions.flatMap(({ node, pos }) =>
		(references.get(node.attrs.label) ?? []).map((referencePos, index) =>
			Decoration.widget(
				pos + node.nodeSize - 1,
				(view) => {
					const button = document.createElement("button");
					button.type = "button";
					button.className = "footnote-backlink";
					button.textContent = "↩";
					button.setAttribute(
						"aria-label",
						`Back to ${node.attrs.label}, reference ${index + 1}`,
					);
					button.addEventListener("click", (event) => {
						event.preventDefault();
						view.dispatch(
							view.state.tr
								.setSelection(
									NodeSelection.create(view.state.doc, referencePos),
								)
								.scrollIntoView(),
						);
						view.focus();
					});
					return button;
				},
				{ side: 1, stopEvent: () => true, ignoreSelection: true },
			),
		),
	);
	return DecorationSet.create(doc, decorations);
}

export function footnoteNavigationPlugin() {
	return new Plugin<DecorationSet>({
		state: {
			init: (_config, state) => footnoteDecorations(state.doc),
			apply: (tr, previous) =>
				tr.docChanged ? footnoteDecorations(tr.doc) : previous,
		},
		props: {
			decorations(state) {
				return this.getState(state);
			},
		},
	});
}
