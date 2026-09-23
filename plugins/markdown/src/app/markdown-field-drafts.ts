import type { Editor } from "@tiptap/core";

// Fields retain their editing session until confirmation. Destruction must
// commit those sessions before the source controller can report a clean document.
export const MARKDOWN_FIELD_DRAFT_CHANGED = "markdownFieldDraftChanged";
const drafts = new WeakMap<Editor, Set<() => boolean | Promise<boolean>>>();

export function hasMarkdownFieldDrafts(editor: Editor): boolean {
	return (drafts.get(editor)?.size ?? 0) > 0;
}

export async function commitMarkdownFieldDrafts(editor: Editor): Promise<boolean> {
	while (hasMarkdownFieldDrafts(editor)) {
		for (const commit of [...(drafts.get(editor) ?? [])]) {
			if (!await commit()) return false;
		}
	}
	return true;
}

function markdownFieldDrafts(editor: Editor): Set<() => boolean | Promise<boolean>> {
	let pending = drafts.get(editor);
	if (!pending) {
		pending = new Set();
		drafts.set(editor, pending);
	}
	return pending;
}

export interface MarkdownFieldDraft<Result = boolean | Promise<boolean>> {
	commit(): Result;
	readonly pending: boolean;
	readonly composing: boolean;
	input(): void;
	compositionStart(): void;
	compositionEnd(): void;
	cancel(): void;
	destroy(): void;
}

/** Fields own their transaction or Host operation; one session owns pending state. */
export function createMarkdownFieldDraft(editor: Editor, apply: () => boolean): MarkdownFieldDraft<boolean>;
export function createMarkdownFieldDraft(editor: Editor, apply: () => Promise<boolean>): MarkdownFieldDraft;
export function createMarkdownFieldDraft(editor: Editor, apply: () => boolean | Promise<boolean>): MarkdownFieldDraft {
	const pending = markdownFieldDrafts(editor);
	let composing = false;
	let destroyed = false;
	let revision = 0;
	let saving: Promise<boolean> | undefined;
	const changed = (value: true | "compositionend" = true) => {
		if (!destroyed) editor.view.dispatch(editor.state.tr.setMeta(MARKDOWN_FIELD_DRAFT_CHANGED, value));
	};
	const commit = (): boolean | Promise<boolean> => {
		if (destroyed || composing || !editor.isEditable) return false;
		if (saving) return saving;
		const captured = revision;
		pending.delete(commit);
		const finish = (committed: boolean) => {
			if (!destroyed) {
				if (committed && revision === captured) pending.delete(commit);
				else pending.add(commit);
				changed();
			}
			return committed;
		};
		try {
			const result = apply();
			if (typeof result === "boolean") return finish(result);
			pending.add(commit);
			saving = result.then(finish, () => finish(false)).finally(() => { saving = undefined; });
			return saving;
		} catch { return finish(false); }
	};
	return {
		commit,
		get pending() { return pending.has(commit); },
		get composing() { return composing; },
		input() { if (!destroyed) { revision += 1; pending.add(commit); changed(); } },
		compositionStart() { if (!destroyed) { composing = true; revision += 1; pending.add(commit); changed(); } },
		compositionEnd() { composing = false; changed("compositionend"); },
		cancel() { revision += 1; pending.delete(commit); changed(); },
		destroy() { destroyed = true; pending.delete(commit); },
	};
}

/** Native composition can belong to the outer editor or any embedded field.
 * Release the barrier after target handlers have consumed the final input. */
export function observeMarkdownComposition(editor: Editor, root: EventTarget) {
	const draft = createMarkdownFieldDraft(editor, () => true);
	let generation = 0;
	const start = () => { generation += 1; draft.compositionStart(); };
	const end = () => {
		const ended = generation;
		queueMicrotask(() => {
			if (generation !== ended) return;
			draft.compositionEnd();
			draft.cancel();
		});
	};
	root.addEventListener("compositionstart", start, true);
	root.addEventListener("compositionend", end, true);
	return () => {
		generation += 1;
		root.removeEventListener("compositionstart", start, true);
		root.removeEventListener("compositionend", end, true);
		draft.destroy();
	};
}
