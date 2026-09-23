import type { Editor } from "@tiptap/core";
import { isAllowedUri } from "@tiptap/extension-link";
import type { Node } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { normalizeReferenceLabel } from "./markdown-grammar";
import { decodeLinkAttribute } from "./markdown-link-source";

/** Definitions own destinations. Reference uses retain only their authored identity. */
export function referenceResolution(editor: Editor) {
	return new Plugin({
		appendTransaction(transactions, _old, state) {
			const markdown = editor.markdown;
			if (!transactions.some((tr) => tr.docChanged) || !markdown) return null;
			const sources: string[] = [];
			state.doc.descendants((node) => {
				if (
					node.type.name === "linkDefinition" ||
					node.type.name === "expandedBlock"
				) {
					sources.push(
						markdown.serialize({ type: "doc", content: [node.toJSON()] }),
					);
					return false;
				}
				return true;
			});
			const instance = markdown.instance;
			const links = new instance.Lexer(instance.defaults).lex(
				sources.join("\n\n"),
			).links;
			const target = (label: string) => {
				const definition = links[normalizeReferenceLabel(label)];
				const candidate = decodeLinkAttribute(definition?.href ?? "");
				return {
					href: isAllowedUri(candidate) ? candidate : "",
					title: decodeLinkAttribute(definition?.title ?? "") || null,
				};
			};
			const tr = state.tr.setMeta("addToHistory", false);
			state.doc.descendants((node, pos, parent, index) => {
				if (["expandedBlock", "linkDefinition"].includes(node.type.name))
					return false;
				if (node.type.name === "image" && node.attrs.referenceLabel) {
					const referenceLabel =
						node.attrs.referenceSuffix === "[]"
							? normalizeReferenceLabel(String(node.attrs.alt ?? ""))
							: node.attrs.referenceLabel;
					const { href: src, title } = target(referenceLabel);
					if (
						node.attrs.src !== src ||
						node.attrs.title !== title ||
						node.attrs.referenceLabel !== referenceLabel
					)
						tr.setNodeMarkup(pos, undefined, {
							...node.attrs,
							src,
							title,
							referenceLabel,
						});
				}
				for (const mark of node.marks) {
					if (mark.type.name !== "link" || !mark.attrs.referenceLabel) continue;
					// A collapsed label can cross bold/italic text nodes; resolve the whole mark.
					const referenceLabel =
						mark.attrs.referenceSuffix === "[]" && parent
							? normalizeReferenceLabel(linkText(parent, index, mark))
							: mark.attrs.referenceLabel;
					const { href, title } = target(referenceLabel);
					if (
						mark.attrs.href !== href ||
						mark.attrs.title !== title ||
						mark.attrs.referenceLabel !== referenceLabel
					)
						tr.removeMark(pos, pos + node.nodeSize, mark).addMark(
							pos,
							pos + node.nodeSize,
							mark.type.create({ ...mark.attrs, href, title, referenceLabel }),
						);
				}
				return true;
			});
			return tr.docChanged ? tr.setStoredMarks(state.storedMarks) : null;
		},
	});
}

function linkText(parent: Node, index: number, mark: Node["marks"][number]) {
	let start = index;
	let end = index + 1;
	const matches = (at: number) =>
		parent.child(at).marks.some((candidate) => candidate.eq(mark));
	while (start > 0 && matches(start - 1)) start -= 1;
	while (end < parent.childCount && matches(end)) end += 1;
	return parent.children
		.slice(start, end)
		.map((child) => child.textContent)
		.join("");
}
