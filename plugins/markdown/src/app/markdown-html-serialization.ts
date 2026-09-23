import { serializeOuter, type SerializerOptions, type TreeAdapterTypeMap, type Token, type html } from "parse5";

type DOMTree = TreeAdapterTypeMap<globalThis.Node, globalThis.Node, ChildNode, Document, DocumentFragment, Element, Comment, Text, HTMLTemplateElement, DocumentType>;
type Emission = Parameters<NonNullable<SerializerOptions<DOMTree>["onSource"]>>[0];
export type HTMLSerializationRecord = Omit<Emission, "attribute"> & {attribute?: Attr};
export interface HTMLSerialization {text: string; records: HTMLSerializationRecord[]}
const escapes: Record<string, string> = {"&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;", "\u00a0": "&nbsp;"};

/** One serializer writes both the schema text and its producing DOM fields. */
export function serializeMarkdownHTMLElement(element: Element): HTMLSerialization {
	const attributes = new WeakMap<Token.Attribute, Attr>();
	const records: HTMLSerializationRecord[] = [];
	const text = serializeOuter<DOMTree>(element, {
		scriptingEnabled: false,
		escapeAttribute: character => escapes[character] ?? character,
		treeAdapter: {
			isElementNode: (node): node is Element => node.nodeType === 1,
			isTextNode: (node): node is Text => node.nodeType === 3,
			isCommentNode: (node): node is Comment => node.nodeType === 8,
			isDocumentTypeNode: (node): node is DocumentType => node.nodeType === 10,
			getTagName: node => node.localName,
			getNamespaceURI: node => node.namespaceURI as html.NS,
			getAttrList: node => Array.from(node.attributes, attr => {
				const input = {name: attr.localName, value: attr.value, namespace: attr.namespaceURI ?? undefined, prefix: attr.prefix ?? undefined};
				attributes.set(input, attr);
				return input;
			}),
			getTextNodeContent: node => node.data,
			getParentNode: node => node.parentNode,
			getTemplateContent: node => node.content,
			getChildNodes: node => Array.from(node.childNodes),
			getCommentNodeContent: node => node.data,
			getDocumentTypeNodeName: node => node.name,
		},
		onSource(event) {
			const {attribute, ...record} = event;
			records.push({...record, ...(attribute ? {attribute: attributes.get(attribute)!} : {})});
		},
	});
	return {text, records};
}
