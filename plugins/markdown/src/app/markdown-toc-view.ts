import type { NodeViewRenderer } from "@tiptap/core";
import type { TableOfContentData } from "@tiptap/extension-table-of-contents";
import { DOMSerializer } from "@tiptap/pm/model";

/** The official extension owns the index. This view only projects its data. */
export const createTocBlockView: NodeViewRenderer = ({ editor }) => {
	const dom = document.createElement("nav");
	dom.dataset.markdownToc = "";
	dom.contentEditable = "false";
	dom.setAttribute("aria-label", "Table of contents");
	const serializer = DOMSerializer.fromSchema(editor.schema);
	let previous = "";
	const render = () => {
		const items: TableOfContentData = editor.storage.tableOfContents.content;
		// Scroll/selection updates do not replace controls or steal keyboard focus.
		const key = JSON.stringify(
			items.map((item) => [item.id, item.originalLevel, item.node.toJSON()]),
		);
		if (key === previous) return;
		previous = key;
		const list = document.createElement("ul");
		list.className = "markdown-toc-items";
		const minimum = Math.min(...items.map((item) => item.originalLevel));
		for (const item of items) {
			const row = document.createElement("li");
			row.style.setProperty(
				"--toc-depth",
				String(item.originalLevel - minimum),
			);
			const button = document.createElement("button");
			button.type = "button";
			button.append(serializer.serializeFragment(item.node.content));
			// A heading's links and footnote controls are text here, not nested actions.
			for (const link of button.querySelectorAll("a, button"))
				link.replaceWith(...link.childNodes);
			button.addEventListener("click", () => {
				const current = editor.storage.tableOfContents.content.find(
					(heading) => heading.id === item.id,
				);
				if (!current) return;
				editor.commands.setTextSelection(current.pos + 1);
				editor.view.focus();
				const heading = editor.view.nodeDOM(current.pos);
				if (heading instanceof HTMLElement)
					heading.scrollIntoView({ block: "start" });
			});
			row.append(button);
			list.append(row);
		}
		if (items.length === 0) {
			const empty = document.createElement("span");
			empty.className = "markdown-toc-empty";
			empty.textContent = "Add headings to create a table of contents.";
			dom.replaceChildren(empty);
		} else dom.replaceChildren(list);
	};
	editor.on("transaction", render);
	render();
	return {
		dom,
		ignoreMutation: () => true,
		stopEvent: (event) =>
			event.target instanceof Element &&
			Boolean(event.target.closest("button")),
		destroy: () => editor.off("transaction", render),
	};
};
