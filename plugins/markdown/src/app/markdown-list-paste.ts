import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node, type Slice } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { recordMarkdownListBoundary } from "./markdown-source-operations";

const isList = (node: Node) => ["bulletList", "orderedList", "taskList"].includes(node.type.name);
function sameList(left: Node, right: Node) {
	const { proseStyle: _left, ...leftAttrs } = left.attrs;
	const { proseStyle: _right, ...rightAttrs } = right.attrs;
	return left.type === right.type && JSON.stringify(leftAttrs) === JSON.stringify(rightAttrs);
}

/** A list pasted at an item's end inserts sibling items, retaining the parsed
 * item types instead of fitting its first paragraph into the current text. */
export function pasteListAtItemEnd(view: EditorView, slice: Slice): boolean {
	const { $from, empty } = view.state.selection;
	if ($from.parent.type.spec.code || $from.marks().some(mark => mark.type.spec.code)) return false;
	if (!empty || !$from.parent.isTextblock || $from.parentOffset !== $from.parent.content.size || !slice.content.childCount) return false;
	for (const node of slice.content.content) if (!isList(node)) return false;
	const itemDepth = $from.depth - 1;
	if (itemDepth < 2) return false;
	const item = $from.node(itemDepth);
	const list = $from.node(itemDepth - 1);
	if (!["listItem", "taskItem"].includes(item.type.name) || !isList(list) || $from.index(itemDepth) !== item.childCount - 1) return false;
	const from = $from.before(itemDepth - 1);
	const itemEnd = $from.after(itemDepth) - from - 1;
	const leading = list.copy(list.content.cut(0, itemEnd));
	const trailing = list.content.cut(itemEnd);
	const tail = list.type.create(list.type.name === "orderedList" ? { ...list.attrs, start: list.attrs.start + leading.childCount } : list.attrs, trailing);
	const nodes = [leading, ...slice.content.content, ...(trailing.size ? [tail] : [])];
	let to = from + list.nodeSize;
	const next = view.state.doc.resolve(to).nodeAfter;
	const last = nodes.at(-1);
	if (next && last && isList(next) && sameList(last, next)) {
		nodes.push(next);
		to += next.nodeSize;
	}
	const groups: Node[] = [];
	for (const node of nodes) {
		const prior = groups.at(-1);
		if (prior && sameList(prior, node)) {
			const owner = prior.attrs.proseStyle ? prior : node;
			groups[groups.length - 1] = owner.copy(prior.content.append(node.content));
		} else groups.push(node);
	}
	const content = Fragment.fromArray(groups);
	const boundary = view.state.doc.resolve(from);
	if (!boundary.parent.canReplace(boundary.index(), view.state.doc.resolve(to).index(), content)) return false;
	const tr = closeHistory(view.state.tr).replaceWith(from, to, content);
	content.forEach((_node, offset) => { if (offset) recordMarkdownListBoundary(tr, from + offset); });
	const lastItem = slice.content.lastChild?.lastChild;
	let end: number | undefined;
	tr.doc.descendants((node, position) => { if (node === lastItem) end = position + node.nodeSize - 1; });
	if (end === undefined) return false;
	tr.setSelection(Selection.near(tr.doc.resolve(end), -1)).setMeta("paste", true).scrollIntoView();
	view.dispatch(tr);
	view.dispatch(closeHistory(view.state.tr));
	return true;
}
