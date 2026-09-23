import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { diagramEngine } from "./markdown-diagram-engine";

/** Native rendered diagram HTML omits the code carried by its plain format. */
export function restoreNativeDiagramClipboard(
	html: string,
	text: string,
	editor: Editor,
): string | null {
	if (!html.includes("md-diagram")) return null;
	const template = document.createElement("template");
	template.innerHTML = html;
	const previews = Array.from(template.content.querySelectorAll(
		'pre.md-diagram.md-fences[mdtype="fences"][lang]',
	));
	if (!previews.length || previews.some((node) =>
		!node.querySelector(".md-diagram-panel-preview svg"))) return null;
	const parsed = editor.markdown?.parse(text);
	if (!parsed) return null;
	const sources: ProseMirrorNode[] = [];
	editor.schema.nodeFromJSON(parsed).descendants((node) => {
		if (node.type.name === "codeBlock" && diagramEngine(node.attrs.language))
			sources.push(node);
	});
	if (sources.length !== previews.length || previews.some((node, index) =>
		node.getAttribute("lang") !== sources[index]?.attrs.language)) return null;
	for (const [index, preview] of previews.entries())
		preview.replaceChildren(document.createTextNode(sources[index]?.textContent ?? ""));
	return template.innerHTML;
}
