import { defaultTreeAdapter, type DefaultTreeAdapterTypes as Tree, type Token } from "parse5";
import { elementFromString } from "@tiptap/core";
import { parseMarkdownHTMLTree, type HTMLTextRecord } from "./markdown-html-tree";

export interface HTMLDOMInput { tree: Tree.TextNode; from: number; to: number }

/** Match Chromium's text flush and chunk boundaries, which affect PM whitespace. */
export function createMarkdownHTMLDOM(source: string) {
	const {body, records, comments: commentInputs, elements: elementOperations} = parseMarkdownHTMLTree(source);
	const document = window.document.implementation.createHTMLDocument();
	const inputs = new WeakMap<Text, HTMLDOMInput>();
	const elements = new WeakMap<Element, Tree.Element>();
	const attributes = new WeakMap<Attr, Token.Attribute>();
	const comments = new WeakMap<Comment, Token.CommentToken>();
	const graphemes = new Intl.Segmenter(undefined, {granularity: "grapheme"});
	const materializeText = (tree: Tree.TextNode, parent: Tree.Element) => {
		const fragment = document.createDocumentFragment();
		const unlimited = parent.namespaceURI === "http://www.w3.org/1999/xhtml" && ["script", "style"].includes(parent.tagName)
			|| parent.namespaceURI === "http://www.w3.org/2000/svg" && parent.tagName === "script";
		const runs: Pick<HTMLTextRecord, "from" | "to" | "epoch">[] = [];
		for (const record of records.get(tree) ?? []) {
			const previous = runs.at(-1);
			if (previous?.epoch === record.epoch) previous.to = record.to;
			else runs.push({from: record.from, to: record.to, epoch: record.epoch});
		}
		for (const run of runs) {
			let from = run.from;
			while (from < run.to) {
				let to = unlimited ? run.to : Math.min(from + 65536, run.to);
				if (to < run.to) {
					const value = tree.value.slice(from, Math.min(to + 2, run.to));
					let point = to - from;
					const insideSurrogate = value.charCodeAt(point) >= 0xdc00 && value.charCodeAt(point) <= 0xdfff && value.charCodeAt(point - 1) >= 0xd800 && value.charCodeAt(point - 1) <= 0xdbff;
					if (insideSurrogate) point -= 2;
					const segment = graphemes.segment(value).containing(point);
					to = segment?.index ? from + segment.index : run.to;
				}
				const chunk = tree.value.slice(from, to), previous = fragment.lastChild as Text | null;
				if (previous && (unlimited || previous.length + chunk.length < 65536)) {
					previous.appendData(chunk);
					inputs.get(previous)!.to = to;
				} else {
					const text = document.createTextNode(chunk);
					inputs.set(text, {tree, from, to});
					fragment.appendChild(text);
				}
				from = to;
			}
		}
		return fragment;
	};
	const materialize = (tree: Tree.Element): Element => {
		const node = document.createElementNS(tree.namespaceURI, tree.tagName);
		elements.set(node, tree);
		for (const attr of tree.attrs) {
			if (attr.namespace) {
				node.setAttributeNS(attr.namespace, attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name, attr.value);
			} else {
				node.setAttribute(attr.name, attr.value);
			}
			attributes.set(node.getAttributeNodeNS(attr.namespace ?? null, attr.name)!, attr);
		}
		const template = tree.tagName === "template" && "content" in tree;
		const children = template ? (tree as Tree.Template).content.childNodes : tree.childNodes;
		const target = template ? (node as HTMLTemplateElement).content : node;
		for (const child of children) {
			if (defaultTreeAdapter.isTextNode(child)) target.appendChild(materializeText(child, tree));
			else if (defaultTreeAdapter.isCommentNode(child)) {
				const node = document.createComment(child.data);
				comments.set(node, commentInputs.get(child)!);
				target.appendChild(node);
			}
			else if (defaultTreeAdapter.isElementNode(child)) target.appendChild(materialize(child));
		}
		return node;
	};
	return {dom: elementFromString(source, () => materialize(body) as HTMLElement), inputs, elements, attributes, comments, elementOperations, records};
}
