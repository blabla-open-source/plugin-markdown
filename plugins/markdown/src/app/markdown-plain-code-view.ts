import type { NodeViewRenderer } from "@tiptap/core";
import { codeLanguageControl } from "./markdown-code-language";
import { codeEditor } from "./markdown-code-editor";
import { diagramEngine } from "./markdown-diagram-engine";

export const plainCodeNodeView: NodeViewRenderer = (props) => {
	let node = props.node;
	const dom = document.createElement("div");
	dom.className = "markdown-plain-code";
	const code = codeEditor(props, "Code source");
	const language = codeLanguageControl(props);
	dom.append(language.dom, code.dom);
	return {
		dom,
		setSelection: code.setSelection,
		update(next) {
			if (
				next.type !== node.type ||
				(props.extension.options.diagrams && diagramEngine(next.attrs.language))
			)
				return false;
			node = next;
			code.update(node);
			language.update(node);
			return true;
		},
		ignoreMutation: () => true,
		stopEvent: () => true,
		destroy() {
			language.destroy();
			code.destroy();
		},
	};
};
