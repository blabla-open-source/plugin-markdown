/** Tiptap lists are homogeneous; keep mixed native lists in ordered runs. */
export function normalizeNativeTaskLists(container: ParentNode): void {
	for (const list of container.querySelectorAll('ul[mdtype="list"]')) {
		const items = Array.from(list.children, (item) => ({
			item,
			task: item.matches('li.md-task-list-item[mdtype="list_item"]'),
			checkbox: item.querySelector<HTMLInputElement>(':scope > input[type="checkbox"]'),
		}));
		if (!items.some(({ task }) => task)) continue;
		const runs = document.createDocumentFragment();
		let group: HTMLElement | null = null;
		for (const { item, task, checkbox } of items) {
			const type = task ? "taskList" : null;
			if (!group || group.getAttribute("data-type") !== type) {
				group = document.createElement("ul");
				if (type) group.dataset.type = type;
				runs.append(group);
			}
			if (task) {
				item.setAttribute("data-type", "taskItem");
				item.setAttribute(
					"data-checked",
					String(checkbox ? checkbox.hasAttribute("checked") : item.classList.contains("task-list-done")),
				);
				item.removeAttribute("contenteditable");
				checkbox?.remove();
			}
			group.append(item);
		}
		list.replaceWith(runs);
	}
}
