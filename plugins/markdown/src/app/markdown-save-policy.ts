import type {
	BlablaHostSourceTextDocument,
	BlablaHostSourceTextRecoveryDraft,
	BlablaHostSourceTextRevision,
} from "../host/host-api";

export const MARKDOWN_AUTOSAVE_DELAY_MS = 2000;
export const MARKDOWN_RECOVERY_DELAY_MS = 500;

export interface MarkdownSaveResult {
	revision: number;
	status:
		| "backup-failed"
		| "clean"
		| "conflict"
		| "invalid-input"
		| "save-failed"
		| "saved";
}

export interface MarkdownRecoveryOpeningState {
	conflict: BlablaHostSourceTextDocument | null;
	content: string;
	dirty: boolean;
	revision: number;
}

export function markdownRecoveryOpeningState(
	document: BlablaHostSourceTextDocument,
	recovery: BlablaHostSourceTextRecoveryDraft | null,
): MarkdownRecoveryOpeningState {
	if (!recovery) {
		return { conflict: null, content: document.content, dirty: false, revision: 0 };
	}
	return {
		conflict: sameSourceRevision(
			recovery.expectedSourceRevision,
			document.sourceRevision,
		)
			? null
			: document,
		content: recovery.content,
		dirty: true,
		revision: recovery.revision,
	};
}

export function isMarkdownSaveShortcut(input: {
	ctrlKey: boolean;
	key: string;
	metaKey: boolean;
}): boolean {
	return (
		input.key.toLowerCase() === "s" && (input.metaKey || input.ctrlKey)
	);
}

export function preservationOutcomeForMarkdownSave(
	result: MarkdownSaveResult,
):
	| { failure: "backup-failed" | "save-failed"; revision: number; status: "blocked" }
	| { revision: number; status: "clean" | "recovered" | "saved" } {
	if (result.status === "clean") {
		return { revision: result.revision, status: "clean" };
	}
	if (result.status === "saved") {
		return { revision: result.revision, status: "saved" };
	}
	if (result.status === "backup-failed" || result.status === "invalid-input") {
		return {
			failure: result.status === "invalid-input" ? "save-failed" : "backup-failed",
			revision: result.revision,
			status: "blocked",
		};
	}
	return { revision: result.revision, status: "recovered" };
}

export async function prepareMarkdownDestroy(
	saveDraft: () => Promise<MarkdownSaveResult>,
): Promise<ReturnType<typeof preservationOutcomeForMarkdownSave>> {
	return preservationOutcomeForMarkdownSave(await saveDraft());
}

export async function recoverMarkdownSaveFailure(
	reason: "conflict" | "save-failed",
	persistRecovery: (reason: "conflict" | "save-failed") => Promise<number>,
	revision: number,
): Promise<MarkdownSaveResult> {
	try {
		return { revision: await persistRecovery(reason), status: reason };
	} catch {
		return { revision, status: "backup-failed" };
	}
}

export async function completeMarkdownSave(
	revision: number,
	clearRecovery: () => Promise<void>,
): Promise<MarkdownSaveResult> {
	await clearRecovery();
	return { revision, status: "saved" };
}

export function bindMarkdownBlurFlush(
	element: Pick<EventTarget, "addEventListener" | "removeEventListener">,
	saveDraft: () => void,
): () => void {
	const handleBlur = () => saveDraft();
	element.addEventListener("blur", handleBlur);
	return () => element.removeEventListener("blur", handleBlur);
}

export function scheduleMarkdownAutosave(saveDraft: () => void): () => void {
	const timer = globalThis.setTimeout(saveDraft, MARKDOWN_AUTOSAVE_DELAY_MS);
	return () => globalThis.clearTimeout(timer);
}

export async function runMarkdownSaveAgainLoop(
	runPass: () => Promise<{
		result: MarkdownSaveResult;
		saveAgain: boolean;
	}>,
): Promise<MarkdownSaveResult> {
	while (true) {
		const pass = await runPass();
		if (pass.result.status !== "saved" || !pass.saveAgain) {
			return pass.result;
		}
	}
}

export function sameSourceRevision(
	left: BlablaHostSourceTextRevision,
	right: BlablaHostSourceTextRevision,
): boolean {
	return (
		left.kind === right.kind &&
		left.mime === right.mime &&
		left.mtime === right.mtime &&
		left.size === right.size
	);
}
