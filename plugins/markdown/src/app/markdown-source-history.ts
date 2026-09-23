import type { Node, Schema } from "@tiptap/pm/model";
import {
	Plugin,
	PluginKey,
	type EditorState,
	type Transaction,
} from "@tiptap/pm/state";
import { Step, StepMap, StepResult } from "@tiptap/pm/transform";
import type { Editor } from "@tiptap/react";
import {
	createMarkdownSourcePatchSession,
	type MarkdownSourcePatchSession,
	resolveMarkdownSourceUpdate,
} from "./markdown-source-patch";

type PendingSource = {
 before: SourceResult;
 transactions: readonly Transaction[];
 oldState: EditorState;
 newState: EditorState;
};
type SourceResult = { value:
 | { kind: "ready"; session: MarkdownSourcePatchSession }
 | { kind: "pending"; operation: PendingSource }
 | { kind: "imported"; source: string | null }
};
const readySource = (session: MarkdownSourcePatchSession): SourceResult => ({ value: { kind: "ready", session } });
const sourceText = ({ value }: SourceResult) => value.kind === "ready" ? value.session.markdown : value.kind === "imported" ? value.source : null;

/** Pending results belong to their real history event. Resolving one also
 * resolves the inverse Step's reference, without adding another undo event. */
/** Stored in the same history event as the document edit; no snapshot lookup. */
export class MarkdownSourceHistoryStep extends Step {
	readonly beforeResult: SourceResult;
	readonly afterResult: SourceResult;
	constructor(
		before: string | null | SourceResult,
		after: string | null | SourceResult,
	) {
		super();
		this.beforeResult =
			typeof before === "object" && before !== null
				? before
				: { value: { kind: "imported", source: before } };
		this.afterResult =
			typeof after === "object" && after !== null ? after : { value: { kind: "imported", source: after } };
	}
	get before() {
		return sourceText(this.beforeResult);
	}
	get after() {
		return sourceText(this.afterResult);
	}
	apply(doc: Node) {
		return StepResult.ok(doc);
	}
	getMap() {
		return StepMap.empty;
	}
	invert() {
		return new MarkdownSourceHistoryStep(this.afterResult, this.beforeResult);
	}
	map() {
		return this;
	}
	toJSON() {
		return {
			stepType: "markdownSourceHistory",
			before: this.before,
			after: this.after,
		};
	}
	static fromJSON(
		_schema: Schema,
		json: { before: string | null; after: string | null },
	) {
		if (
			(json.before !== null && typeof json.before !== "string") ||
			(json.after !== null && typeof json.after !== "string")
		)
			throw new Error("Invalid Markdown source history step.");
		return new MarkdownSourceHistoryStep(json.before, json.after);
	}
}
Step.jsonID("markdownSourceHistory", MarkdownSourceHistoryStep);
export const markdownSourceHistoryKey = new PluginKey("markdownSourceHistory");

/** This bookkeeping Step changes neither content nor selection. Preserve the
 * input rule's immediate Backspace inverse across the appended transaction. */
function appendSourceRecord(state: EditorState, before: SourceResult, after: SourceResult) {
 const tr = state.tr.step(new MarkdownSourceHistoryStep(before, after)).setStoredMarks(state.storedMarks);
 for (const plugin of state.plugins) {
  if (!plugin.spec.isInputRules) continue;
  const inputRule = plugin.getState(state);
  if (inputRule) tr.setMeta(plugin, inputRule);
 }
 return tr;
}

export function createMarkdownSourceHistoryPlugin(options: {
	editorAt(state: EditorState): Editor;
	read(): MarkdownSourcePatchSession;
	write(session: MarkdownSourcePatchSession): void;
	isExternalReplacement?(): boolean;
	onFailure?(error: Error | null): void;
}) {
	let current: SourceResult | null = null;
	let failure: Error | null = null;
	const report = (error: Error | null) => {
		failure = error;
		options.onFailure?.(error);
	};
 const restoreVersion = (result: SourceResult, editor: Editor): MarkdownSourcePatchSession => {
  if (result.value.kind === "imported") {
   const source = result.value.source;
   if (source === null) throw new Error("Imported Markdown history has no resolved source.");
   // Step.fromJSON is an import boundary. Live history always owns its index.
   result.value = { kind: "ready", session: createMarkdownSourcePatchSession(source, editor) };
  }
  if (result.value.kind !== "ready") throw new Error("Markdown source history contains an unresolved edit.");
  return result.value.session.restoreHistoryDocument(editor);
 };
 const resolvePending = (result: SourceResult, state: EditorState): MarkdownSourcePatchSession => {
  const pending: Array<{ target: SourceResult; event: PendingSource }> = [];
  let cursor = result;
  while (cursor.value.kind === "pending") {
   const event = cursor.value.operation;
   pending.push({ target: cursor, event });
   cursor = event.before;
  }
  let session = restoreVersion(cursor, options.editorAt(pending.at(-1)?.event.oldState ?? state));
  for (const { target, event } of pending.reverse()) {
   session = resolveMarkdownSourceUpdate(options.editorAt(event.newState), session, event.transactions).session;
   target.value = { kind: "ready", session };
  }
  return session.restoreHistoryDocument(options.editorAt(state));
 };

	return new Plugin({
		key: markdownSourceHistoryKey,
		retrySource(state: EditorState): boolean {
			if (!failure) return true;
			try {
				if (!current) throw failure;
				options.write(resolvePending(current, state));
				report(null);
				return true;
			} catch (error) {
				report(error instanceof Error ? error : new Error(String(error)));
				return false;
			}
		},
		appendTransaction(transactions, oldState, newState) {
			if (options.isExternalReplacement?.()) {
				current = null;
				report(null);
				return null;
			}
			const editor = options.editorAt(newState);
			const records = transactions
				.flatMap((tr) => tr.steps)
				.filter(
					(step): step is MarkdownSourceHistoryStep =>
						step instanceof MarkdownSourceHistoryStep,
				);
			if (records.length) {
				const last = records.at(-1);
				if (last) current = last.afterResult;
				if (last?.after === null)
					report(
						new Error("Markdown source history contains an unresolved edit."),
					);
				else if (last) {
					try {
						options.write(restoreVersion(last.afterResult, editor));
						report(null);
					} catch (error) {
						report(error instanceof Error ? error : new Error(String(error)));
					}
				}
				return null;
			}
			if (!transactions.some((tr) => tr.docChanged)) return null;
			const previous = options.read();
			const before: SourceResult =
				failure && current ? current : readySource(previous);
			try {
				if (failure) throw failure;
				const result = resolveMarkdownSourceUpdate(
					editor,
					previous,
					transactions,
				);
				options.write(result.session);
				if (result.markdown === previous.markdown) {
          // Native history may change document partitions without changing bytes.
          // Its inverse and redo still need the corresponding source session.
          const recorded = transactions.some(tr => tr.docChanged &&
            tr.getMeta("addToHistory") !== false &&
            tr.getMeta("appendedTransaction")?.getMeta("addToHistory") !== false);
          if (!recorded) {
            if (current?.value.kind === "ready") current.value = { kind: "ready", session: result.session };
            return null;
          }
        }
				current = readySource(result.session);
				return appendSourceRecord(newState, before, current);
			} catch (error) {
				// Keep the applied document and its normal undo steps. An unresolved
				// source must never be replaced by a whole-document serialization.
				report(error instanceof Error ? error : new Error(String(error)));
				current = { value: { kind: "pending", operation: { before, transactions, oldState, newState } } };
				return appendSourceRecord(newState, before, current);
			}
		},
	});
}

export function retryMarkdownSourceHistory(state: EditorState): boolean {
	const retry: ((state: EditorState) => boolean) | undefined =
		markdownSourceHistoryKey.get(state)?.spec.retrySource;
	return retry?.(state) ?? false;
}
