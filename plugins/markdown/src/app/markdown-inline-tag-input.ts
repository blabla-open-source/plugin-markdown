import { type Editor, InputRule, type JSONContent } from "@tiptap/core";
import { Fragment, type MarkType } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { Lexer } from "marked";
import { inheritInlineStyles } from "./markdown-inline-style";

/** Find a complete outer tag, not an inner closer in unfinished source. */
function completedTagStart(
	text: string,
	tag: "span" | "a" | "kbd" | "ruby",
): number | null {
	const opening = new RegExp(`^<${tag}(?:\\s|>)`, "i");
	const closing = new RegExp(`^<\\/${tag}\\s*>$`, "i");
	let depth = 0;
	let start = 0;
	let offset = 0;
	for (const token of new Lexer({ gfm: true }).inlineTokens(text)) {
		if (token.type === "html" && opening.test(token.raw)) {
			if (depth === 0) start = offset;
			depth += 1;
		}
		if (token.type === "html" && closing.test(token.raw)) {
			depth -= 1;
			if (depth === 0 && offset + token.raw.length === text.length)
				return start;
			depth = Math.max(0, depth);
		}
		offset += token.raw.length;
	}
	return null;
}

/** Existing marks/atoms belong to the editor; remaining typed text is source. */
function typedSource(
	editor: Editor,
	content: JSONContent[],
	ambient: JSONContent["attrs"],
) {
	let prefix = "BlablaInlineInputQ";
	while (JSON.stringify(content).includes(prefix)) prefix += "Q";
	const text: string[] = [];
	const projected = content.map((node) => {
		const marks = node.marks?.flatMap((mark) => {
			if (mark.type !== "textStyle") return [mark];
			const attrs = Object.fromEntries(
				Object.entries(mark.attrs ?? {}).filter(
					([key, value]) => value && value !== ambient?.[key],
				),
			);
			return Object.keys(attrs).length ? [{ ...mark, attrs }] : [];
		});
		// Code is already literal. All other text can contain unfinished Markdown.
		return node.type === "text" && !marks?.some((mark) => mark.type === "code")
			? { ...node, marks, text: `${prefix}${text.push(node.text ?? "") - 1}Q` }
			: { ...node, marks };
	});
	return editor.markdown
		?.serialize({
			type: "doc",
			content: [{ type: "paragraph", content: projected }],
		})
		.replace(
			new RegExp(`${prefix}(\\d+)Q`, "g"),
			(_token, index: string) => text[Number(index)] ?? "",
		);
}

export function inlineTagInputRule(
	editor: Editor,
	type: MarkType | null,
	tag: "span" | "a" | "kbd" | "ruby",
) {
	return new InputRule({
		find: new RegExp(`<\\/${tag}\\s*>$`, "i"),
		handler: ({ state, range, match }) => {
			const blockStart = state.selection.$from.start();
			const cursor = state.selection.from;
			const inputSize = match[0].length - (cursor - range.from);
			const input = inputSize ? match[0].slice(-inputSize) : "";
			const before = state.doc.slice(blockStart, cursor).content;
			let text = "";
			before.forEach((node) => {
				text +=
					node.isText && !node.marks.some((mark) => mark.type.spec.code)
						? node.text
						: "\ufffc".repeat(node.nodeSize);
			});
			// Input can contain several characters, or already exist after composition.
			const start = completedTagStart(text + input, tag);
			if (start === null) return null;
			const from = blockStart + start;
			const fragment = state.doc.slice(from, cursor).content;
			const ambient = fragment.firstChild?.marks.find(
				(mark) => mark.type.name === "textStyle",
			);
			const content = fragment.toJSON() as JSONContent[];
			if (input)
				content.push({
					type: "text",
					text: input,
					marks: (state.storedMarks ?? state.selection.$from.marks()).map(
						(mark) => mark.toJSON(),
					),
				});
			const source = typedSource(editor, content, ambient?.attrs);
			if (!source) return null;
			const parsed = editor.markdown?.parse(`<span>${source}</span>`)
				.content?.[0]?.content;
			if (!parsed?.length) return null;
			const nodes = inheritInlineStyles(parsed, ambient?.attrs ?? {}).map(
				(node) => editor.schema.nodeFromJSON(node),
			);
			const replacement = Fragment.fromArray(nodes);
			state.tr.replaceWith(from, range.to, replacement);
			// A completed inline container leaves the caret outside its closing tag.
			state.tr.setSelection(
				TextSelection.create(state.tr.doc, from + replacement.size),
			);
			if (type) state.tr.removeStoredMark(type);
			if (ambient) state.tr.addStoredMark(ambient);
			return undefined;
		},
	});
}
