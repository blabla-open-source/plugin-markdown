import type { Node } from "@tiptap/pm/model";
import { Plugin, Selection, type SelectionBookmark } from "@tiptap/pm/state";
import type { Mappable } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";

export function attributeSelection(
	nodeName: string,
	attribute: string,
	id: string,
) {
	/** The label is a node attribute, not document text. Its caret still belongs
	 * to the document history so undo can restore the label input after unwrapping. */
	class AttributeSelection extends Selection {
		constructor(
			doc: Node,
			readonly nodePos: number,
			readonly start: number,
			readonly end = start,
		) {
			const $pos = doc.resolve(nodePos + 1);
			super($pos, $pos);
			this.visible = false;
		}

		eq(other: Selection) {
			return (
				other instanceof AttributeSelection &&
				this.nodePos === other.nodePos &&
				this.start === other.start &&
				this.end === other.end
			);
		}

		map(doc: Node, mapping: Mappable): Selection {
			return this.getBookmark().map(mapping).resolve(doc);
		}

		getBookmark(): SelectionBookmark {
			return new AttributeBookmark(this.from, this.start, this.end);
		}

		toJSON() {
			return {
				type: id,
				pos: this.nodePos,
				start: this.start,
				end: this.end,
			};
		}

		static fromJSON(
			doc: Node,
			value: { pos: number; start: number; end: number },
		) {
			return new AttributeBookmark(
				value.pos + 1,
				value.start,
				value.end,
			).resolve(doc);
		}
	}

	class AttributeBookmark implements SelectionBookmark {
		constructor(
			readonly pos: number,
			readonly start: number,
			readonly end: number,
		) {}
		map(mapping: Mappable) {
			return new AttributeBookmark(mapping.map(this.pos), this.start, this.end);
		}
		resolve(doc: Node): Selection {
			const $pos = doc.resolve(Math.min(this.pos, doc.content.size));
			if (
				$pos.parent.type.name !== nodeName ||
				$pos.parent.attrs[attribute] == null
			)
				return Selection.near($pos);
			const length = String($pos.parent.attrs[attribute]).length;
			return new AttributeSelection(
				doc,
				$pos.before(),
				Math.min(this.start, length),
				Math.min(this.end, length),
			);
		}
	}

	Selection.jsonID(id, AttributeSelection);

	// View-only subscribers: no second copy of the document or its undo history.
	const labelViews = new WeakMap<EditorView, Set<() => void>>();

	function observe(view: EditorView, sync: () => void) {
		let entries = labelViews.get(view);
		if (!entries) {
			entries = new Set();
			labelViews.set(view, entries);
		}
		entries.add(sync);
		return () => entries.delete(sync);
	}

	function plugin() {
		return new Plugin({
			view: () => ({
				update(view) {
					for (const sync of labelViews.get(view) ?? []) sync();
				},
			}),
		});
	}

	return { Selection: AttributeSelection, observe, plugin };
}
