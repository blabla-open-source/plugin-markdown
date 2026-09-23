import { Parser, defaultTreeAdapter, type DefaultTreeAdapterTypes as Tree, Token } from "parse5";

export interface HTMLTextRecord {
	from: number;
	to: number;
	range: Token.SourceTextRange;
	epoch: number;
}

export interface HTMLElementOperation {
	createdAt: number;
	closing?: {from: number; to: number; explicit: boolean; name?: Token.SourceTextRange};
}

/** Character ranges come from actual tokenizer emissions and tree insertions. */
export function parseMarkdownHTMLTree(source: string) {
	const records = new WeakMap<Tree.TextNode, HTMLTextRecord[]>();
	const comments = new WeakMap<Tree.CommentNode, Token.CommentToken>();
	let insertingComment: Token.CommentToken | undefined;
	const elements = new WeakMap<Tree.Element, HTMLElementOperation>();
	let activeToken: Token.Token | undefined;
	const consume = (token: Token.Token, action: () => void) => {
		const previous = activeToken;
		activeToken = token;
		try { action(); } finally { activeToken = previous; }
	};
	const epochs = new WeakMap<Token.CharacterToken, number>();
	let inserting: Token.CharacterToken | undefined;
	let epoch = 0;
	const record = (node: Tree.ChildNode | undefined, text: string) => {
		if (!node || !defaultTreeAdapter.isTextNode(node) || !inserting?.source)
			throw new Error("HTML text insertion lacks its producing characters.");
		const parts = records.get(node) ?? [];
		let offset = node.value.length - text.length;
		for (const piece of inserting.source) {
			parts.push({from: offset, to: offset + piece.text.length, range: piece.range, epoch: epochs.get(inserting)!});
			offset += piece.text.length;
		}
		if (offset !== node.value.length) throw new Error("HTML character insertion changed its observed length.");
		records.set(node, parts);
	};
	class SourceParser extends Parser<Tree.DefaultTreeAdapterMap> {
		override _setEndLocation(element: Tree.Element, token: Token.Token) {
			const record = elements.get(element);
			if (!record) throw new Error("HTML closure lacks its creating operation.");
			if (!token.location) throw new Error("HTML closure lacks its triggering input.");
			record.closing = {
				from: token.location.startOffset, to: token.location.endOffset,
				explicit: token.type === Token.TokenType.END_TAG && element.tagName === token.tagName,
				...(token.location.sourceName ? {name: {...token.location.sourceName}} : {}),
			};
			super._setEndLocation(element, token);
		}
		override _insertCharacters(token: Token.CharacterToken) {
			const previous = inserting;
			inserting = token;
			try { super._insertCharacters(token); } finally { inserting = previous; }
		}
		override onStartTag(token: Token.TagToken) { epoch++; consume(token, () => super.onStartTag(token)); }
		override onEndTag(token: Token.TagToken) { epoch++; consume(token, () => super.onEndTag(token)); }
		override onComment(token: Token.CommentToken) {
			epoch++;
			const previous = insertingComment;
			insertingComment = token;
			try { consume(token, () => super.onComment(token)); } finally { insertingComment = previous; }
		}
		override onDoctype(token: Token.DoctypeToken) { epoch++; consume(token, () => super.onDoctype(token)); }
		override onEof(token: Token.EOFToken) { epoch++; consume(token, () => super.onEof(token)); }
		override onCharacter(token: Token.CharacterToken) { epochs.set(token, epoch); consume(token, () => super.onCharacter(token)); }
		override onWhitespaceCharacter(token: Token.CharacterToken) { epochs.set(token, epoch); consume(token, () => super.onWhitespaceCharacter(token)); }
		override onNullCharacter(token: Token.CharacterToken) { epochs.set(token, epoch); consume(token, () => super.onNullCharacter(token)); }
	}
	const parser = new SourceParser({
		sourceTextInfo: true, sourceCodeLocationInfo: true, scriptingEnabled: false,
		treeAdapter: {
			...defaultTreeAdapter,
			createElement(name, namespace, attrs) {
				if (!activeToken?.location) throw new Error("HTML element lacks its triggering token.");
				const node = defaultTreeAdapter.createElement(name, namespace, attrs);
				elements.set(node, {createdAt: activeToken.location.startOffset});
				return node;
			},
			createCommentNode(data) {
				if (!insertingComment) throw new Error("HTML comment lacks its producing token.");
				const node = defaultTreeAdapter.createCommentNode(data);
				comments.set(node, insertingComment);
				return node;
			},
			insertText(parent, text) {
				defaultTreeAdapter.insertText(parent, text);
				record(parent.childNodes.at(-1), text);
			},
			insertTextBefore(parent, text, before) {
				defaultTreeAdapter.insertTextBefore(parent, text, before);
				record(parent.childNodes[parent.childNodes.indexOf(before) - 1], text);
			},
		},
	});
	parser.tokenizer.write(`<body>${source}</body>`, true);
	const html = parser.document.childNodes.find(node => defaultTreeAdapter.isElementNode(node) && node.tagName === "html");
	const body = html && defaultTreeAdapter.isElementNode(html) && html.childNodes.find(node => defaultTreeAdapter.isElementNode(node) && node.tagName === "body");
	if (!body || !defaultTreeAdapter.isElementNode(body)) throw new Error("HTML parser did not produce a body.");
	return {body, records, comments, elements};
}
