import type { BlablaHostAssetKind } from "./host-assets";

export interface BlablaHostSourceTextRevision {
	kind: BlablaHostAssetKind;
	mime: string;
	mtime: number;
	size: number;
}

export interface BlablaHostSourceTextDocument {
	content: string;
	documentId: string;
	sourceMtime: number;
	sourceRevision: BlablaHostSourceTextRevision;
	sourceSize: number;
	surfaceId: string;
	title: string;
	updatedAt: number;
}

export type BlablaHostSourceTextWriteResult =
	| { document: BlablaHostSourceTextDocument; status: "saved" }
	| { diskDocument: BlablaHostSourceTextDocument; status: "conflict" };

export interface BlablaHostSourceTextRecoveryDraft {
	baselineContent: string;
	content: string;
	expectedSourceRevision: BlablaHostSourceTextRevision;
	reason: "conflict" | "dirty" | "save-failed";
	revision: number;
	updatedAt: number;
}

export interface BlablaHostSourceTextDocumentApi {
	clearSourceTextRecovery(): Promise<{ ok: true }>;
	readSourceText(): Promise<BlablaHostSourceTextDocument>;
	readSourceTextRecovery(): Promise<BlablaHostSourceTextRecoveryDraft | null>;
	rename(input: { title: string }): Promise<{ title: string }>;
	writeSourceText(input: {
		content: string;
		expectedSourceRevision?: BlablaHostSourceTextRevision;
		overwrite?: boolean;
	}): Promise<BlablaHostSourceTextWriteResult>;
	writeSourceTextRecovery(input: {
		baselineContent: string;
		content: string;
		expectedSourceRevision: BlablaHostSourceTextRevision;
		reason: "conflict" | "dirty" | "save-failed";
		revision: number;
	}): Promise<{ updatedAt: number }>;
}

export type BlablaHostPreservationOutcome =
	| { revision: number; status: "clean" | "recovered" | "saved" }
	| {
			failure:
				| "backup-failed"
				| "conflict"
				| "renderer-unavailable"
				| "save-failed"
				| "timeout";
			revision: number;
			status: "blocked";
	  };

export interface BlablaHostLifecycleApi<TContext, TDisposable> {
	onPrepareDestroy(
		handler: (input: {
			action: "discard" | "preserve" | "save";
			revision: number;
			reason:
				| "app-quit"
				| "cache-evict"
				| "library-switch"
				| "plugin-disable"
				| "plugin-update"
				| "tab-close"
				| "window-close";
		}) => BlablaHostPreservationOutcome | Promise<BlablaHostPreservationOutcome>,
	): TDisposable;
	ready(input: {
		saveMode: "autosave" | "explicit";
		title: string;
	}): Promise<TContext>;
}

export interface BlablaHostSurfaceStateApi {
	setDirty(input: {
		dirty: boolean;
		revision: number;
	}): Promise<{ dirty: boolean; revision: number }>;
}
