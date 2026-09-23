import { Table } from "@tiptap/extension-table";
import { TextSelection, Selection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { isInTable, selectedRect, TableMap, addRowAfter, deleteRow, addColumnAfter, deleteColumn } from "@tiptap/pm/tables";
import { type Editor } from "@tiptap/core";

/** Table structure stays in the official schema; only Markdown editing behavior differs. */
export const MarkdownTable = Table.extend({
  renderMarkdown(node, helpers, context) {
    return (Table.config.renderMarkdown?.call(this, node, {
      ...helpers,
      renderChildren: (...args) => helpers.renderChildren(...args)
        .replace(/ *\n/g, "<br />")
        .replace(/(\\*)\|/g, (_match, slashes: string) => `${slashes}${slashes.length % 2 ? "" : "\\"}|`),
    }, context) ?? "").trim();
  },
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Enter: () => isInTable(this.editor.state) ? nextRow(this.editor) : createFromHeader(this.editor),
      "Mod-Enter": () => insertTablePart(this.editor, "row", false),
      "Shift-Enter": () => isInTable(this.editor.state) && this.editor.commands.setHardBreak(),
    };
  },
});

function nextRow(editor: Editor) {
  const { state, view } = editor;
  const rect = selectedRect(state);
  const tr = state.tr;
  if (rect.bottom < rect.map.height) {
    const pos = rect.tableStart + rect.map.positionAt(rect.bottom, rect.left, rect.table);
    const cell = state.doc.nodeAt(pos);
    if (!cell) return false;
    tr.setSelection(TextSelection.create(tr.doc, pos + 2, pos + cell.nodeSize - 2));
  } else {
    const end = rect.tableStart - 1 + rect.table.nodeSize;
    if (end === state.doc.content.size) tr.insert(end, state.schema.nodes.paragraph!.create());
    tr.setSelection(Selection.near(tr.doc.resolve(end), 1));
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

function createFromHeader(editor: Editor) {
  const { selection } = editor.state;
  const { $from } = selection;
  const text = $from.parent.textContent;
  if (!selection.empty || $from.parent.type.name !== "paragraph" || $from.parentOffset !== text.length || !/^\|.+\|\s*$/.test(text)) return false;
  const markdown = editor.markdown;
  if (!markdown) return false;
  // Marked decides escaped pipes and inline syntax; do not split cells with a second scanner.
  const tokens = markdown.instance.lexer(`${text}\n| ${"--- | ".repeat((text.match(/(?<!\\)(?:\\\\)*\|/g)?.length ?? 1) - 1)}\n`);
  const token = tokens[0];
  if (token?.type !== "table") return false;
  const content = markdown.parse(`${text}\n| ${"--- | ".repeat(token.header.length)}\n| ${" |".repeat(token.header.length)}\n`);
  const from = $from.before();
  return editor.chain().command(({ tr }) => { closeHistory(tr); return true; }).insertContentAt({ from, to: $from.after() }, content.content ?? []).command(({tr}) => {
    const table = tr.doc.nodeAt(from);
    if (!table?.firstChild) return false;
    tr.setSelection(TextSelection.create(tr.doc, from + table.firstChild.nodeSize + 4));
    return true;
  }).run();
}

/** Official structural commands plus the native destination for the user's next input. */
export function insertTablePart(editor: Editor, axis: "row" | "column", before: boolean) {
  if (!isInTable(editor.state)) return false;
  const rect = selectedRect(editor.state);
  const row = axis === "row" ? (before ? rect.top : rect.bottom) : rect.top;
  const col = axis === "column" ? (before ? rect.left : rect.right) : 0;
  let chain = editor.chain().command(({tr}) => {closeHistory(tr); return true;});
  if (axis === "row") chain = before ? chain.addRowBefore() : chain.addRowAfter();
  else chain = before ? chain.addColumnBefore() : chain.addColumnAfter();
  return chain.command(({tr}) => {
    const table = tr.doc.nodeAt(rect.tableStart - 1);
    if (!table) return false;
    const pos = rect.tableStart + TableMap.get(table).positionAt(row, col, table);
    tr.setSelection(TextSelection.create(tr.doc, pos + 2));
    return true;
  }).run();
}

/** Resize through the official row/column commands in one history transaction. */
export function resizeMarkdownTable(editor: Editor, rows: number, columns: number) {
  if (!isInTable(editor.state) || !Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1) return false;
  const rect = selectedRect(editor.state);
  const selectEdge = (axis: "row" | "column") => ({tr}: {tr: import("@tiptap/pm/state").Transaction}) => {
    const table = tr.doc.nodeAt(rect.tableStart - 1);
    if (!table) return false;
    const map = TableMap.get(table);
    const pos = rect.tableStart + map.positionAt(axis === "row" ? map.height - 1 : 0, axis === "column" ? map.width - 1 : 0, table);
    tr.setSelection(TextSelection.create(tr.doc, pos + 2));
    return true;
  };
  const tr = closeHistory(editor.state.tr);
  // Trial commands must not run the live source/history plugins. Only the
  // collected transaction below is an edit of the document session.
  let working = editor.state.reconfigure({ plugins: [] });
  // PM table commands map their own steps. Give each command a fresh transaction,
  // then collect its steps into the single live history entry.
  const apply = (axis: "row" | "column", command: import("@tiptap/pm/state").Command) => {
    const selection = working.tr;
    if (!selectEdge(axis)({tr: selection})) return false;
    working = working.apply(selection);
    return command(working, next => {
      for (const step of next.steps) tr.step(step);
      working = working.apply(next);
    });
  };
  for (let height = rect.map.height; height !== rows; height += rows > height ? 1 : -1) {
    if (!apply("row", rows > height ? addRowAfter : deleteRow)) return false;
  }
  for (let width = rect.map.width; width !== columns; width += columns > width ? 1 : -1) {
    if (!apply("column", columns > width ? addColumnAfter : deleteColumn)) return false;
  }
  tr.setSelection(Selection.fromJSON(tr.doc, working.selection.toJSON()));
  editor.view.dispatch(tr);
  return true;
}
