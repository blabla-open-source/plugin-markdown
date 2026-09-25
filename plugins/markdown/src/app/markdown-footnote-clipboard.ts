import { isFootnoteLabel } from "./markdown-footnote-source";

/** Map the desktop-editor clipboard envelope to the existing footnote schema. */
export function normalizeFootnoteClipboard(html: string): string {
	if (!html.includes("md-footnote") && !html.includes("md-def-footnote"))
		return html;
	const template = document.createElement("template");
	template.innerHTML = html;
	for (const reference of template.content.querySelectorAll(
		'sup.md-footnote[md-inline="footnote"][data-ref]',
	)) {
		const label = reference.getAttribute("data-ref") ?? undefined;
		if (!isFootnoteLabel(label)) continue;
		const sup = document.createElement("sup");
		sup.dataset.footnoteLabel = label;
		sup.textContent = label;
		reference.replaceWith(sup);
	}
	for (const definition of template.content.querySelectorAll(
		'div.md-def-footnote[mdtype="def_footnote"]',
	)) {
		const label =
			definition.querySelector(":scope > .md-def-name")?.textContent ??
			undefined;
		const content = definition.querySelector(":scope > .md-def-content");
		if (!isFootnoteLabel(label) || !content) continue;
		const block = document.createElement("div");
		block.dataset.footnoteDefinition = "";
		block.dataset.footnoteLabel = label;
		const body = document.createElement("span");
		body.className = "footnote-content";
		body.append(...content.childNodes);
		block.append(body);
		definition.replaceWith(block);
	}
	return template.innerHTML;
}
