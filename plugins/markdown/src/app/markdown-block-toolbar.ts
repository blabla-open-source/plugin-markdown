import "./markdown-block-toolbar.css";

/** Shared presentation only; each node retains its own edit transaction. */
export function blockToolbar(label: string | HTMLElement) {
	const dom = document.createElement("div");
	dom.className = "markdown-block-toolbar";
	dom.contentEditable = "false";
	const type =
		typeof label === "string" ? document.createElement("span") : label;
	if (typeof label === "string") type.textContent = label;
	const done = document.createElement("button");
	done.type = "button";
	done.textContent = "Finish editing";
	done.title = "Return to preview";
	dom.append(type, done);
	return { dom, done };
}
