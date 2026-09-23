import { markdownMenuFinalFocus } from "@/app/markdown-menu-focus";
import { useToolCopy } from "./markdown-tool-copy";
import { insertTablePart, resizeMarkdownTable } from "./markdown-table";
import { type Editor, useEditorState } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import {
	isInTable,
	selectedRect,
	moveTableRow,
	moveTableColumn,
} from "@tiptap/pm/tables";
import type { Command } from "@tiptap/pm/state";
import { Table2 } from "lucide-react";
import { useState } from "react";
import { Button, ButtonGroup } from "@/components/tiptap-ui-primitive/button";
import { Card, CardBody } from "@/components/tiptap-ui-primitive/card";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/tiptap-ui-primitive/popover";

export function MarkdownTableMenu({
	editor,
	panel,
}: {
	editor: Editor | null;
	panel?: { anchor: HTMLElement; close: () => void };
}) {
	const t = useToolCopy();
	const [open, updateOpen] = useState(!!panel);
	const setOpen = (next: boolean) => {
		updateOpen(next);
		if (!next) panel?.close();
	};
	const [rows, setRows] = useState(() => editor && isInTable(editor.state) ? selectedRect(editor.state).map.height : 3);
	const [columns, setColumns] = useState(() => editor && isInTable(editor.state) ? selectedRect(editor.state).map.width : 2);
	const status = useEditorState({
		editor,
		selector: ({ editor: current }) => ({
			active: !!current && isInTable(current.state),
			disabled: !current?.isEditable || current.isActive("codeBlock"),
		}),
	});
	const apply = (action: (editor: Editor) => boolean) => {
		if (!editor) return;
		editor.commands.command(({ tr }) => {
			closeHistory(tr);
			return true;
		});
		action(editor);
		setOpen(false);
		editor.view.focus();
	};
	const commands = [
		["Insert row above", (e: Editor) => insertTablePart(e, "row", true)],
		["Insert row below", (e: Editor) => insertTablePart(e, "row", false)],
		["Insert column left", (e: Editor) => insertTablePart(e, "column", true)],
		["Insert column right", (e: Editor) => insertTablePart(e, "column", false)],
		["Move row up", (e: Editor) => move(e, "row", -1)],
		["Move row down", (e: Editor) => move(e, "row", 1)],
		["Move column left", (e: Editor) => move(e, "column", -1)],
		["Move column right", (e: Editor) => move(e, "column", 1)],
		["Align column left", (e: Editor) => alignColumn(e, "left")],
		["Align column center", (e: Editor) => alignColumn(e, "center")],
		["Align column right", (e: Editor) => alignColumn(e, "right")],
		["Delete row", (e: Editor) => e.commands.deleteRow()],
		["Delete column", (e: Editor) => e.commands.deleteColumn()],
		["Delete table", (e: Editor) => e.commands.deleteTable()],
	] as const;
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				if (next && editor && isInTable(editor.state)) {
					const rect = selectedRect(editor.state);
					setRows(rect.map.height);
					setColumns(rect.map.width);
				}
				setOpen(next);
			}}
		>
			{!panel && (
				<PopoverTrigger
					render={
						<Button
							type="button"
							data-style="ghost"
							aria-label={t("Table")}
							tooltip={t("Table")}
							disabled={status?.disabled ?? true}
						>
							<Table2 className="tiptap-button-icon" />
						</Button>
					}
				/>
			)}
			<PopoverContent
				anchor={panel?.anchor}
				align="start"
				finalFocus={(interaction) =>
					markdownMenuFinalFocus(editor, interaction)
				}
			>
				<Card>
					<CardBody style={{ maxHeight: "70vh", overflowY: "auto" }}>
						{status?.active && (
							<form
								style={{
									display: "grid",
									gridTemplateColumns: "1fr 1fr",
									gap: "8px",
									padding: "8px",
								}}
								onSubmit={(event) => {
									event.preventDefault();
									apply((e) => resizeMarkdownTable(e, rows, columns));
								}}
							>
								<label
									style={{ display: "flex", alignItems: "center", gap: "8px" }}
								>
									{t("Rows")}{" "}
									<input
										style={{ width: "3.5em" }}
										aria-label={t("Table rows")}
										type="number"
										min={1}
										max={100}
										value={rows}
										onChange={(event) => setRows(Number(event.target.value))}
										required
									/>
								</label>
								<label
									style={{ display: "flex", alignItems: "center", gap: "8px" }}
								>
									{t("Columns")}{" "}
									<input
										style={{ width: "3.5em" }}
										aria-label={t("Table columns")}
										type="number"
										min={1}
										max={100}
										value={columns}
										onChange={(event) => setColumns(Number(event.target.value))}
										required
									/>
								</label>
								<Button
									style={{ gridColumn: "1 / -1" }}
									type="submit"
									data-style="ghost"
								>
									{t("Resize table")}
								</Button>
							</form>
						)}
						{status?.active ? (
							<ButtonGroup>
								{commands.map(([label, action]) => (
									<Button
										type="button"
										key={label}
										data-style="ghost"
										onClick={() => apply(action)}
									>
										{t(label)}
									</Button>
								))}
							</ButtonGroup>
						) : (
							<form
								style={{
									display: "grid",
									gridTemplateColumns: "1fr 1fr",
									gap: "8px",
									padding: "8px",
								}}
								onSubmit={(event) => {
									event.preventDefault();
									apply((e) =>
										e.commands.insertTable({
											rows,
											cols: columns,
											withHeaderRow: true,
										}),
									);
								}}
							>
								<p style={{ gridColumn: "1 / -1", margin: 0 }}>
									{t("Insert table")}
								</p>
								<label
									style={{ display: "flex", alignItems: "center", gap: "8px" }}
								>
									{t("Rows")}{" "}
									<input
										style={{ width: "3.5em" }}
										aria-label={t("Table rows")}
										type="number"
										min={2}
										max={100}
										value={rows}
										onChange={(event) => setRows(Number(event.target.value))}
										required
									/>
								</label>
								<label
									style={{ display: "flex", alignItems: "center", gap: "8px" }}
								>
									{t("Columns")}{" "}
									<input
										style={{ width: "3.5em" }}
										aria-label={t("Table columns")}
										type="number"
										min={1}
										max={100}
										value={columns}
										onChange={(event) => setColumns(Number(event.target.value))}
										required
									/>
								</label>
								<Button
									style={{ gridColumn: "1 / -1" }}
									type="submit"
									data-style="ghost"
								>
									{t("Insert table")}
								</Button>
							</form>
						)}
					</CardBody>
				</Card>
			</PopoverContent>
		</Popover>
	);
}

function move(editor: Editor, axis: "row" | "column", offset: number) {
	if (!isInTable(editor.state)) return false;
	const rect = selectedRect(editor.state);
	const from = axis === "row" ? rect.top : rect.left;
	const to = from + offset;
	const size = axis === "row" ? rect.map.height : rect.map.width;
	if (to < 0 || to >= size) return false;
	const command: Command =
		axis === "row" ? moveTableRow({ from, to }) : moveTableColumn({ from, to });
	return editor.commands.command(({ state, dispatch }) =>
		command(state, dispatch),
	);
}

function alignColumn(editor: Editor, align: string) {
	if (!isInTable(editor.state)) return false;
	const rect = selectedRect(editor.state);
	const tr = editor.state.tr;
	const visited = new Set<number>();
	for (let column = rect.left; column < rect.right; column++) {
		const header = rect.table.nodeAt(
			rect.map.positionAt(0, column, rect.table),
		);
		const nextAlign = header?.attrs.align === align ? null : align;
		for (let row = 0; row < rect.map.height; row++) {
			const pos =
				rect.tableStart + rect.map.positionAt(row, column, rect.table);
			if (visited.has(pos)) continue;
			visited.add(pos);
			const node = tr.doc.nodeAt(pos);
			if (node)
				tr.setNodeMarkup(pos, undefined, { ...node.attrs, align: nextAlign });
		}
	}
	editor.view.dispatch(tr);
	return true;
}
