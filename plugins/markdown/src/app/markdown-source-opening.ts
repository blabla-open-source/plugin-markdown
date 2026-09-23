import type { Editor } from "@tiptap/core";
import { captureParsedMarkdownInlineSource } from "./markdown-inline-source";
import { markdownParsedBlockRange, type MarkdownParsedSource } from "./markdown-parse-source";
import { collectMarkdownSourceGaps, type MarkdownSourceBlock } from "./markdown-source-blocks";
import { collectTopLevelNodeSnapshots } from "./markdown-source-editor-snapshot";
import type { MarkdownSourcePatchPlanState } from "./markdown-source-patch-plan";

/** Bind the just-parsed source to the editor before its first transaction. */
export function createMarkdownOpeningState(editor: Editor, parsed: MarkdownParsedSource): MarkdownSourcePatchPlanState {
	const { source: markdown } = parsed;
	const blocks: MarkdownSourceBlock[] = parsed.blocks.map((block, index) => {
		if (block.fromNode !== index || block.toNode !== index + 1) {
			throw new Error("Markdown grammar produced an unsplit top-level source group.");
		}
		return markdownParsedBlockRange(markdown, block);
	});
	const { doc } = editor.state;
	// ProseMirror fills an empty document; TrailingNode supplies one landing
	// paragraph after a terminal non-paragraph block. Neither owns source bytes.
	if (doc.childCount === blocks.length + 1 && doc.lastChild?.type.name === "paragraph" && doc.lastChild.content.size === 0) {
		const end = blocks.at(-1)?.end ?? 0;
		blocks.push({ start: end, end, synthetic: true });
	}
	if (doc.childCount !== blocks.length) throw new Error("Markdown opening document and parsed source have different shapes.");
	const nodeSnapshots = collectTopLevelNodeSnapshots(editor);
	const blockSources = blocks.map((block, index) => {
		const source = markdown.slice(block.start, block.end);
		const current = {
			semantic: nodeSnapshots[index]!,
			source,
			inline: captureParsedMarkdownInlineSource(doc.child(index), parsed.blocks[index]?.inline ?? []),
		};
		return { authored: current, current };
	});
	return { markdown, blocks, gaps: collectMarkdownSourceGaps(markdown, blocks), nodeSnapshots, blockSources };
}
