import { useRef, useState, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Editor } from "@tiptap/react";
import { ChevronDown } from "lucide-react";
import { useToolCopy } from "./markdown-tool-copy";
import { Button } from "@/components/tiptap-ui-primitive/button";
import type { HostMenuItem } from "@/host/host-menu";

export type MarkdownMenuEntry =
	| {
			type: "item";
			id: string;
			label: string;
			icon?: ReactNode;
			checked?: boolean;
			disabled?: boolean;
			accelerator?: string;
			run: (anchor: HTMLElement) => void;
	  }
	| { type: "separator" }
	| {
			type: "submenu";
			label: string;
			icon?: ReactNode;
			items: MarkdownMenuEntry[];
	  };
const icons = new Map<string, Promise<string>>();
function menuIcon(icon: ReactNode) {
	const svg = renderToStaticMarkup(
		<svg aria-hidden="true"
			xmlns="http://www.w3.org/2000/svg"
			width="32"
			height="32"
			viewBox="0 0 24 24"
		>
			{icon}
		</svg>,
	);
	let pending = icons.get(svg);
	if (!pending) {
		pending = new Promise<string>((resolve, reject) => {
			const image = new Image();
			image.onload = () => {
				const canvas = document.createElement("canvas");
				canvas.width = 32;
				canvas.height = 32;
				const context = canvas.getContext("2d");
				if (!context) {
					reject(new Error("Menu icon rendering is unavailable."));
					return;
				}
				context.drawImage(image, 0, 0, 32, 32);
				resolve(canvas.toDataURL("image/png"));
			};
			image.onerror = () => reject(new Error("Menu icon could not be loaded."));
			image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
		});
		icons.set(svg, pending);
	}
	return pending;
}
async function serialize(
	entries: MarkdownMenuEntry[],
	actions: Map<string, (anchor: HTMLElement) => void>,
): Promise<HostMenuItem[]> {
	return Promise.all(
		entries.map(async (entry) => {
			if (entry.type === "separator") return entry;
			const icon = entry.icon ? await menuIcon(entry.icon) : undefined;
			if (entry.type === "submenu")
				return {
					type: "submenu",
					label: entry.label,
					icon,
					items: await serialize(entry.items, actions),
				};
			actions.set(entry.id, entry.run);
			return {
				type: "item",
				actionId: entry.id,
				label: entry.label,
				disabled: entry.disabled,
				checked: entry.checked,
				itemType: entry.checked === undefined ? undefined : "checkbox",
				accelerator: entry.accelerator,
				icon,
			};
		}),
	);
}
export function MarkdownNativeMenu({
	editor,
	label,
	title = label,
	entries,
}: {
	editor: Editor | null;
	label: string;
	title?: string;
	entries: () => MarkdownMenuEntry[];
}) {
	const t = useToolCopy();
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const busy = useRef(false);
	const show = async (anchor: HTMLElement) => {
		if (!editor || busy.current) return;
		busy.current = true;
		setOpen(true);
		setError(null);
		const doc = editor.state.doc;
		const selection = editor.state.selection;
		const active = document.activeElement;
		try {
			const host = window.blablaHost;
			if (!host) throw new Error("Host menu is unavailable.");
			const actions = new Map<string, (anchor: HTMLElement) => void>();
			const items = await serialize(entries(), actions);
			const rect = anchor.getBoundingClientRect();
			const result = await host.menus.popup({
				items,
				position: { x: rect.left, y: rect.bottom + 4 },
			});
			if (
				!result.active ||
				editor.isDestroyed ||
				!anchor.isConnected ||
				!editor.state.doc.eq(doc)
			)
				return;
			if (!editor.state.selection.eq(selection))
				editor.view.dispatch(editor.state.tr.setSelection(selection));
			if (result.actionId) actions.get(result.actionId)?.(anchor);
			else if (
				active instanceof HTMLElement &&
				active.isConnected &&
				active !== editor.view.dom && active !== document.body
			)
				active.focus();
			else editor.view.focus();
		} catch {
			setError(t("Could not open menu. Try again."));
		} finally {
			busy.current = false;
			setOpen(false);
		}
	};
	return (
		<>
			<Button
				aria-label={label}
				aria-haspopup="menu"
				aria-expanded={open}
				data-style="ghost"
				disabled={!editor}
				onMouseDown={(e) => e.preventDefault()}
				onClick={(e) => {
					void show(e.currentTarget);
				}}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown") {
						e.preventDefault();
						void show(e.currentTarget);
					}
				}}
			>
				{title}
				<ChevronDown className="tiptap-button-dropdown-small" />
			</Button>
			{error && <span role="alert">{error}</span>}
		</>
	);
}
