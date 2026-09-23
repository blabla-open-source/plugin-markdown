import { recordMarkdownListBoundary } from "./markdown-source-operations";
import { getNodeType, type CommandProps } from "@tiptap/core";
import { Fragment, type Node, type NodeType } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";

const isList = (node: Node | null | undefined) =>
	!!node && ["bulletList", "taskList"].includes(node.type.name);

/** Reconnect the bullet/task groups produced by the official mixed-list parser. */
export function moveMixedListItems(
	direction: "sink" | "lift",
	type: string | NodeType,
	{ state, tr, dispatch }: Pick<CommandProps, "state" | "tr" | "dispatch">,
): boolean {
	const { selection } = state;
	if (!(selection instanceof TextSelection)) return false;
	const itemType = getNodeType(type, state.schema);
	const { $from, $to } = selection;
	const range = $from.blockRange(
		$to,
		(node) => isList(node) && node.firstChild?.type === itemType,
	);
	if (!range || range.depth < 1) return false;
	const list = range.parent;
	const listStart = $from.before(range.depth);
	const before = list.content.cut(0, range.start - listStart - 1);
	let moved = list.content.cut(
		range.start - listStart - 1,
		range.end - listStart - 1,
	);
	const after = list.content.cut(range.end - listStart - 1);
	let start: number;
	let end: number;
	let replacement: Fragment;
	let movedStart: number;
	if (direction === "sink") {
		if (range.startIndex !== 0) return false;
		const previous = state.doc.resolve(listStart).nodeBefore;
		if (!isList(previous) || !previous || previous.type === list.type)
			return false;
		const parentItem = previous.lastChild;
		if (!parentItem) return false;
		const nested = parentItem.lastChild;
		const joins = !!nested?.sameMarkup(list);
		const prefix = parentItem.content.cut(
			0,
			parentItem.content.size - (joins ? nested!.nodeSize : 0),
		);
		const inner = joins
			? nested!.copy(nested!.content.append(moved))
			: list.copy(moved);
		const content = prefix.append(Fragment.from(inner));
		if (!parentItem.type.validContent(content)) return false;
		const precedingItems = previous.content.cut(
			0,
			previous.content.size - parentItem.nodeSize,
		);
		const updated = previous.copy(
			precedingItems.append(Fragment.from(parentItem.copy(content))),
		);
		start = listStart - previous.nodeSize;
		end = listStart + list.nodeSize;
		movedStart =
			start +
			3 +
			precedingItems.size +
			prefix.size +
			(joins ? nested!.content.size : 0);
		replacement = Fragment.from(updated).append(
			after.size ? Fragment.from(list.copy(after)) : Fragment.empty,
		);
		const next = state.doc.resolve(end).nodeAfter;
		if (!after.size && next?.sameMarkup(previous)) {
			replacement = Fragment.from(
				updated.copy(updated.content.append(next.content)),
			);
			end += next.nodeSize;
		}
	} else {
		if (range.depth < 3) return false;
		const parentItem = $from.node(range.depth - 1);
		const outer = $from.node(range.depth - 2);
		if (!isList(outer) || parentItem.type === itemType) return false;
		const itemStart = $from.before(range.depth - 1);
		const itemPrefix = parentItem.content.cut(0, listStart - itemStart - 1);
		const leftContent = itemPrefix.append(
			before.size ? Fragment.from(list.copy(before)) : Fragment.empty,
		);
		if (!parentItem.type.validContent(leftContent)) return false;
		const tail = (
			after.size ? Fragment.from(list.copy(after)) : Fragment.empty
		).append(parentItem.content.cut(listStart + list.nodeSize - itemStart - 1));
		const last = moved.lastChild!;
		if (!last.type.validContent(last.content.append(tail))) return false;
		moved = moved
			.cut(0, moved.size - last.nodeSize)
			.append(Fragment.from(last.copy(last.content.append(tail))));
		start = $from.before(range.depth - 2);
		end = start + outer.nodeSize;
		const left = outer.copy(
			outer.content
				.cut(0, itemStart - start - 1)
				.append(Fragment.from(parentItem.copy(leftContent))),
		);
		const right = outer.content.cut(
			itemStart + parentItem.nodeSize - start - 1,
		);
		const next = state.doc.resolve(end).nodeAfter;
		if (!right.size && next?.sameMarkup(list)) {
			moved = moved.append(next.content);
			end += next.nodeSize;
		}
		replacement = Fragment.fromArray([left, list.copy(moved)]).append(
			right.size ? Fragment.from(outer.copy(right)) : Fragment.empty,
		);
		movedStart = start + left.nodeSize + 1;
	}
	const $start = state.doc.resolve(start);
	const $end = state.doc.resolve(end);
	if (!$start.parent.canReplace($start.index(), $end.index(), replacement))
		return false;
	if (dispatch) {
		const delta = movedStart - range.start;
		tr.replaceWith(start, end, replacement);
    replacement.forEach((_node, offset) => {
      if (offset > 0) recordMarkdownListBoundary(tr, start + offset);
    });
		tr.setSelection(
			TextSelection.create(
				tr.doc,
				selection.anchor + delta,
				selection.head + delta,
			),
		);
		tr.scrollIntoView();
	}
	return true;
}

/** Backspace on an empty first item rejoins the preceding logical mixed item. */
export function joinEmptyMixedListItem({ state, tr, dispatch }: Pick<CommandProps, "state" | "tr" | "dispatch">): boolean {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.content.size || $from.depth < 3) return false;
  const itemDepth = $from.depth - 1;
  const listDepth = itemDepth - 1;
  const item = $from.node(itemDepth);
  const list = $from.node(listDepth);
  if (!isList(list) || item.childCount !== 1 || $from.index(listDepth) !== 0) return false;
  const listStart = $from.before(listDepth);
  const previous = state.doc.resolve(listStart).nodeBefore;
  if (!isList(previous) || !previous || previous.type === list.type || !previous.lastChild) return false;
  const parent = previous.lastChild;
  const content = parent.content.append(item.content);
  if (!parent.type.validContent(content)) return false;
  if (!dispatch) return true;
  const preceding = previous.content.cut(0, previous.content.size - parent.nodeSize);
  const updated = previous.copy(preceding.append(Fragment.from(parent.copy(content))));
  const remaining = list.content.cut(item.nodeSize);
  const from = listStart - previous.nodeSize;
  const replacement = Fragment.from(updated).append(remaining.size ? Fragment.from(list.copy(remaining)) : Fragment.empty);
  closeHistory(tr);
  tr.replaceWith(from, listStart + list.nodeSize, replacement);
  if (remaining.size) recordMarkdownListBoundary(tr, from + updated.nodeSize, 2);
  tr.setSelection(TextSelection.create(tr.doc, from + 3 + preceding.size + parent.content.size));
  return true;
}
