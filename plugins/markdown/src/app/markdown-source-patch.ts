import { markdownListBoundaries, isMarkdownPresentation } from "./markdown-source-operations";
import type { Transaction } from "@tiptap/pm/state";
import { markdownSourceOrigins } from "./markdown-source-origins";
import { createMarkdownOpeningState } from "./markdown-source-opening";
import type { MarkdownParsedSource } from "./markdown-parse-source";
import { MarkdownSourceManager } from "./markdown-source-manager";
import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
	collectTopLevelNodeSnapshots,
	serializeNodeSnapshot,
	topLevelSnapshotsEqual,
} from "./markdown-source-editor-snapshot";
import {
	createMarkdownSourcePatchPlan,
 readMarkdownBlockInput,
 type MarkdownSourceInput,
	type MarkdownSourcePatchRange,
} from "./markdown-source-patch-plan";

import { advanceEmittedMarkdownSourceState, importMarkdownSourcePresentation, rebindMarkdownPresentationSource, type MarkdownSourcePatchState } from "./markdown-source-region";
/** Optional range uses positions relative to the top-level block content. */
export type MarkdownSourceBlockReader = (node: ProseMirrorNode, index: number, range?: { from: number; to: number }) => MarkdownSourceInput | null;

const TERMINAL_LINE_BREAKS_PATTERN = /(?:\r\n|\n|\r)+$/u;

export type MarkdownSourcePatchResult =
	| {
			kind: "patched";
			markdown: string;
			ranges: MarkdownSourcePatchRange[];
			session: MarkdownSourcePatchSession;
	  }
	| {
			kind: "unchanged";
			markdown: string;
			session: MarkdownSourcePatchSession;
	  };

export class MarkdownSourcePatchSession {
	private readonly state: MarkdownSourcePatchState;

	private constructor(
		state: MarkdownSourcePatchState,
	) {
		this.state = state;
	}

	static fromParsedSource(parsed: MarkdownParsedSource, editor: Editor): MarkdownSourcePatchSession {
		return new MarkdownSourcePatchSession({ ...createMarkdownOpeningState(editor, parsed), doc: editor.state.doc });
	}

	static fromMarkdown(markdown: string, editor: Editor): MarkdownSourcePatchSession {
		if (!(editor.markdown instanceof MarkdownSourceManager)) throw new Error("Markdown source import has no source parser.");
		const parsed = editor.markdown.parseSource(markdown);
		const doc = editor.state.schema.nodeFromJSON(parsed.doc);
		const state = Object.defineProperty(Object.create(editor.state), "doc", { value: doc });
		const parsedEditor = Object.defineProperty(Object.create(editor), "state", { value: state }) as Editor;
		// Imported history has source bytes but no in-memory index. Create the
		// index from its producer, then restore the recorded presentation shape.
		const canonical = MarkdownSourcePatchSession.fromParsedSource(parsed, parsedEditor);
		return new MarkdownSourcePatchSession(importMarkdownSourcePresentation(canonical.state, editor, parsed));
	}

	private rebindPresentation(
		editor: Editor,
    origins: Array<number | null>,
		nodeSnapshots: string[],
		transactions: readonly Transaction[] = [],
	): MarkdownSourcePatchSession {
		return new MarkdownSourcePatchSession(
			rebindMarkdownPresentationSource(this.state, editor, origins, nodeSnapshots, transactions),
		);
	}

	/** Read an already known source spelling without advancing the save session. */
	readBlockSource(node: ProseMirrorNode, index: number, range?: { from: number; to: number }): MarkdownSourceInput | null {
		return readMarkdownBlockInput(this.state.blockSources[index], serializeNodeSnapshot(node), range);
	}

	get document(): ProseMirrorNode { return this.state.doc; }
  get markdown(): string { return this.state.markdown; }

	/** The real history record selects the source version. Only presentation
	 * differences within that version need rebinding; ordinary Undo reuses it. */
	restoreHistoryDocument(editor: Editor): MarkdownSourcePatchSession {
		const nodeSnapshots = collectTopLevelNodeSnapshots(editor);
		let start = 0;
		let previousEnd = this.state.nodeSnapshots.length;
		let currentEnd = nodeSnapshots.length;
		while (start < previousEnd && start < currentEnd && this.state.nodeSnapshots[start] === nodeSnapshots[start]) start++;
		while (previousEnd > start && currentEnd > start && this.state.nodeSnapshots[previousEnd - 1] === nodeSnapshots[currentEnd - 1]) { previousEnd--; currentEnd--; }
		if (start === previousEnd && start === currentEnd) return new MarkdownSourcePatchSession({ ...this.state, doc: editor.state.doc });
		const origins = nodeSnapshots.map((_, index) => index < start ? index : index >= currentEnd ? previousEnd + index - currentEnd : null);
		if (start < previousEnd && start < currentEnd) origins[start] = start;
		return this.rebindPresentation(editor, origins, nodeSnapshots);
	}

	resolveUpdate(editor: Editor, transactions: readonly Transaction[] = []): MarkdownSourcePatchResult {
    const origins = markdownSourceOrigins(this.state.doc, editor.state.doc, transactions);
		const nodeSnapshots = collectTopLevelNodeSnapshots(editor);
    if (transactions.some((tr) => tr.docChanged) && transactions.every((tr) => !tr.docChanged || isMarkdownPresentation(tr))) {
      return { kind: "unchanged", markdown: this.state.markdown, session: this.rebindPresentation(editor, origins, nodeSnapshots, transactions) };
    }
		if (this.state.blocks.length !== this.state.nodeSnapshots.length) {
			throw new Error("Markdown source mapping has a stale session shape.");
		}

		if (origins.every((origin,index) => origin === index) && topLevelSnapshotsEqual(nodeSnapshots, this.state.nodeSnapshots)) {
			return {
				kind: "unchanged",
				markdown: this.state.markdown,
				session: new MarkdownSourcePatchSession(
					{
						...this.state,
            doc: editor.state.doc,
						nodeSnapshots,
					},
				),
			};
		}


		const patchPlan = createMarkdownSourcePatchPlan(
			editor,
			this.state,
			nodeSnapshots,
      origins,
      markdownListBoundaries(transactions),
		);

		if (patchPlan === null) {
			throw new Error("Markdown source patch range cannot be serialized.");
		}

		const markdown = preserveTerminalLineBreaks(
			patchPlan.markdown,
			this.state.markdown,
		);

		return {
			kind: "patched",
			markdown,
			ranges: patchPlan.ranges,
			session: new MarkdownSourcePatchSession(advanceEmittedMarkdownSourceState(this.state, markdown, editor, origins, nodeSnapshots, patchPlan)),
		};
	}
}

export function createMarkdownOpeningSession(editor: Editor): MarkdownSourcePatchSession {
	if (!(editor.markdown instanceof MarkdownSourceManager)) throw new Error("Markdown opening has no source parser.");
	return MarkdownSourcePatchSession.fromParsedSource(editor.markdown.takeOpeningSource(), editor);
}

export function createMarkdownSourcePatchSession(
	markdown: string,
	editor: Editor,
): MarkdownSourcePatchSession {
	return MarkdownSourcePatchSession.fromMarkdown(
		markdown,
		editor,
	);
}

export function resolveMarkdownSourceUpdate(
	editor: Editor,
	previousSession: MarkdownSourcePatchSession | null,
  transactions: readonly Transaction[] = [],
): MarkdownSourcePatchResult {
	if (!previousSession) {
		throw new Error("Markdown source update has no source session.");
	}

	return previousSession.resolveUpdate(editor, transactions);
}

function preserveTerminalLineBreaks(
	markdown: string,
	reference: string,
): string {
	const terminalLineBreaks =
		reference.match(TERMINAL_LINE_BREAKS_PATTERN)?.[0] ?? "";
	return (
		markdown.replace(TERMINAL_LINE_BREAKS_PATTERN, "") + terminalLineBreaks
	);
}
