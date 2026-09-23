import { createMarkdownSourceHistoryPlugin, markdownSourceHistoryKey, retryMarkdownSourceHistory } from "./markdown-source-history";
import type { Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	BlablaHostBridge,
	BlablaHostSourceTextDocument,
	BlablaHostSourceTextRecoveryDraft,
} from "../host/host-api";
import {
	createMarkdownOpeningSession,
	MarkdownSourcePatchSession,
	type MarkdownSourceBlockReader,
	resolveMarkdownSourceUpdate,
} from "./markdown-source-patch";
import { useMarkdownSourceTextBridgeWatch } from "./markdown-source-watch";
import {
	completeMarkdownSave,
	isMarkdownSaveShortcut,
	MARKDOWN_RECOVERY_DELAY_MS,
	markdownRecoveryOpeningState,
	type MarkdownSaveResult,
	prepareMarkdownDestroy,
	recoverMarkdownSaveFailure,
	runMarkdownSaveAgainLoop,
	scheduleMarkdownAutosave,
	sameSourceRevision,
} from "./markdown-save-policy";
import { MARKDOWN_FIELD_DRAFT_CHANGED, commitMarkdownFieldDrafts, hasMarkdownFieldDrafts, observeMarkdownComposition } from "./markdown-field-drafts";
import { markdownTitleFromFileName } from "./markdown-title";
import { MarkdownSourceManager } from "./markdown-source-manager";

interface MarkdownSourceWriteGate {
	beforeSourceTextWrite(): Promise<void>;
	beforeRecoveryClear?(): Promise<void>;
}

interface UseMarkdownSourceControllerInput {
	committedTitleRef: { current: string };
	document: BlablaHostSourceTextDocument;
	host: BlablaHostBridge;
	recovery: BlablaHostSourceTextRecoveryDraft | null;
	setTitle: (title: string) => void;
}

declare global {
	interface Window {
		__blablaMarkdownEditor?: Editor;
		__blablaMarkdownSaveSettled?: () => Promise<MarkdownSaveResult | null>;
		__blablaMarkdownSourceWriteGate?: MarkdownSourceWriteGate;
	}
}

const MARKDOWN_E2E_TEST_HOOKS_ENABLED =
	import.meta.env.DEV || import.meta.env.VITE_BLABLA_MARKDOWN_E2E === "1";

export function useMarkdownSourceController({
	committedTitleRef,
	document,
	host,
	recovery,
	setTitle,
}: UseMarkdownSourceControllerInput) {
	const openingStateRef = useRef(
		markdownRecoveryOpeningState(document, recovery),
	);
	const [conflict, setConflict] = useState<BlablaHostSourceTextDocument | null>(
		openingStateRef.current.conflict,
	);
	const [dirty, setDirty] = useState(openingStateRef.current.dirty);
	const [draftRevision, setDraftRevision] = useState(
		openingStateRef.current.revision,
	);
	const [editor, setEditor] = useState<Editor | null>(null);
	const [compositionEndedRevision, setCompositionEndedRevision] = useState(0);
	const [saveFailure, setSaveFailure] = useState<
		"backup-failed" | "save-failed" | null
	>(null);
	const applyingExternalContentRef = useRef(false);
	const contentRevisionRef = useRef(openingStateRef.current.revision);
	const currentContentRef = useRef(openingStateRef.current.content);
	const dirtyRef = useRef(openingStateRef.current.dirty);
	const readyPromiseRef = useRef<Promise<void> | null>(null);
	const recoveryQueueRef = useRef<Promise<void>>(Promise.resolve());
	const savedContentRef = useRef(recovery?.baselineContent ?? document.content);
	const saveRequestedWhileSavingRef = useRef(false);
	const savePromiseRef = useRef<Promise<MarkdownSaveResult> | null>(null);
	const sourcePatchSessionRef = useRef<MarkdownSourcePatchSession | null>(null);
 const sourceFailureRef = useRef<Error | null>(null);
 const sourceFailureShownRef = useRef(false);
	const sourceRevisionRef = useRef(
		recovery?.expectedSourceRevision ?? document.sourceRevision,
	);
	const readSourceBlock = useCallback<MarkdownSourceBlockReader>(
		(node, index, range) => sourcePatchSessionRef.current?.readBlockSource(node, index, range) ?? null,
		[],
	);

 // Mount runs before Tiptap's initial focus/append transactions. React effects
 // can run later; no update may precede the original source baseline.
 const initializeEditorContent = useCallback((activeEditor: Editor) => {
  sourcePatchSessionRef.current = createMarkdownOpeningSession(activeEditor);
  // Source spelling must advance before presentation plugins read it.
  if (!markdownSourceHistoryKey.get(activeEditor.state)) activeEditor.registerPlugin(createMarkdownSourceHistoryPlugin({
    editorAt: (state) => Object.defineProperty(Object.create(activeEditor), "state", { value: state }),
    read: () => {
      const session = sourcePatchSessionRef.current;
      if (!session) throw new Error("Markdown source history has no opening session.");
      return session;
    },
    write: (session) => { sourcePatchSessionRef.current = session; },
    isExternalReplacement: () => applyingExternalContentRef.current,
    onFailure: (error) => { sourceFailureRef.current = error; },
  }), (sourceHistory, plugins) => [sourceHistory, ...plugins]);
 }, []);

	const resolveEditorContent = useCallback((activeEditor: Editor, transactions: readonly Transaction[] = []): string => {
    if (sourceFailureRef.current) retryMarkdownSourceHistory(activeEditor.state);
    if (sourceFailureRef.current) throw sourceFailureRef.current;
		const result = resolveMarkdownSourceUpdate(
			activeEditor,
			sourcePatchSessionRef.current,
      sourcePatchSessionRef.current?.document === activeEditor.state.doc ? [] : transactions,
		);
		sourcePatchSessionRef.current = result.session;
		currentContentRef.current = result.markdown;
		return result.markdown;
	}, []);

	const queueRecoveryOperation = useCallback(
		(operation: () => Promise<unknown>): Promise<void> => {
			const next = recoveryQueueRef.current
				.catch(() => undefined)
				.then(operation)
				.then(() => undefined);
			recoveryQueueRef.current = next;
			return next;
		},
		[],
	);

	const clearRecovery = useCallback(
		() => queueRecoveryOperation(async () => {
			if (MARKDOWN_E2E_TEST_HOOKS_ENABLED) await window.__blablaMarkdownSourceWriteGate?.beforeRecoveryClear?.();
			return host.document.clearSourceTextRecovery();
		}),
		[host, queueRecoveryOperation],
	);

	const publishDirtyState = useCallback(
		async (nextDirty: boolean, revision: number): Promise<void> => {
			dirtyRef.current = nextDirty;
			setDirty(nextDirty);
            // Initial editor transactions can precede Host registration. Keep
            // their latest state locally; ready publishes it once registered.
            if (!readyPromiseRef.current) return;
            await readyPromiseRef.current;
			await host.surface.setDirty({ dirty: true, revision });
			if (nextDirty) {
				return;
			}
			await clearRecovery();
			if (contentRevisionRef.current === revision && !dirtyRef.current) {
				await host.surface.setDirty({ dirty: false, revision });
			}
		},
		[clearRecovery, host],
	);

	const markRevisionClean = useCallback(
		async (revision: number): Promise<void> => {
			await clearRecovery();
			if (contentRevisionRef.current === revision) {
				dirtyRef.current = false;
				setDirty(false);
				await host.surface.setDirty({ dirty: false, revision });
			}
		},
		[clearRecovery, host],
	);

	const persistRecovery = useCallback(
		async (reason: "conflict" | "dirty" | "save-failed"): Promise<number> => {
			if (!(editor && dirtyRef.current)) {
				return Promise.resolve(contentRevisionRef.current);
			}
			// An invalid field has no serializable revision to acknowledge as recovered.
			if (!await commitMarkdownFieldDrafts(editor)) return Promise.reject(new Error("Markdown field draft cannot be serialized."));
			const previousContent = currentContentRef.current;
			const content = resolveEditorContent(editor);
			if (content !== previousContent) {
				contentRevisionRef.current += 1;
				setDraftRevision(contentRevisionRef.current);
				void publishDirtyState(true, contentRevisionRef.current);
			}
			const revision = contentRevisionRef.current;
			return queueRecoveryOperation(() =>
				host.document.writeSourceTextRecovery({
					baselineContent: savedContentRef.current,
					content,
					expectedSourceRevision: sourceRevisionRef.current,
					reason,
					revision,
				}),
			).then(() => revision);
		},
		[
			editor,
			host,
			publishDirtyState,
			queueRecoveryOperation,
			resolveEditorContent,
		],
	);

	const handleEditorUpdate = useCallback(
		(activeEditor: Editor, transactions: readonly Transaction[] = []) => {
			if (applyingExternalContentRef.current) {
				return;
			}
      if (sourceFailureRef.current) {
        sourceFailureShownRef.current = true;
        contentRevisionRef.current += 1;
        setDraftRevision(contentRevisionRef.current);
        setSaveFailure("backup-failed");
        void publishDirtyState(true, contentRevisionRef.current);
        return;
      }
      if (sourceFailureShownRef.current) {
        sourceFailureShownRef.current = false;
        setSaveFailure(null);
      }
			const previousContent = currentContentRef.current;
			const content = resolveEditorContent(activeEditor, transactions);
			if (content !== previousContent) {
				contentRevisionRef.current += 1;
				setDraftRevision(contentRevisionRef.current);
			}
			setConflict(null);
			void publishDirtyState(
				content !== savedContentRef.current || savePromiseRef.current !== null || hasMarkdownFieldDrafts(activeEditor),
				contentRevisionRef.current,
			);
		},
		[publishDirtyState, resolveEditorContent],
	);

	useEffect(() => editor ? observeMarkdownComposition(editor, editor.view.dom.ownerDocument) : undefined, [editor]);

	useEffect(() => {
		if (!editor) return;
		const changed = ({ transaction }: { transaction: Transaction }) => {
			const change = transaction.getMeta(MARKDOWN_FIELD_DRAFT_CHANGED);
			if (!change) return;
			contentRevisionRef.current += 1;
			if (change === "compositionend") setCompositionEndedRevision(contentRevisionRef.current);
			setDraftRevision(contentRevisionRef.current);
			handleEditorUpdate(editor);
		};
		editor.on("transaction", changed);
		return () => { editor.off("transaction", changed); };
	}, [editor, handleEditorUpdate]);

	const applySourceTextDocument = useCallback(
		async (nextDocument: BlablaHostSourceTextDocument): Promise<number> => {
			if (
				!editor ||
				(!dirtyRef.current &&
					sameSourceRevision(
						nextDocument.sourceRevision,
						sourceRevisionRef.current,
					) &&
					nextDocument.content === currentContentRef.current &&
					markdownTitleFromFileName(nextDocument.title) === committedTitleRef.current)
			) {
				return contentRevisionRef.current;
			}

			if (!(editor.markdown instanceof MarkdownSourceManager)) throw new Error("Markdown replacement has no source parser.");
			const parsed = editor.markdown.parseSource(nextDocument.content);
			applyingExternalContentRef.current = true;
			try {
				editor.commands.setContent(parsed.doc);
				sourcePatchSessionRef.current = MarkdownSourcePatchSession.fromParsedSource(parsed, editor);
			} finally {
				// Only the synchronous replacement is external. Real input during
				// asynchronous Recovery cleanup belongs to a new local revision.
				applyingExternalContentRef.current = false;
			}
			sourceRevisionRef.current = nextDocument.sourceRevision;
			savedContentRef.current = nextDocument.content;
			currentContentRef.current = nextDocument.content;
			committedTitleRef.current = markdownTitleFromFileName(nextDocument.title);
			setTitle(committedTitleRef.current);
			setConflict(null);
			setSaveFailure(null);
			contentRevisionRef.current += 1;
			setDraftRevision(contentRevisionRef.current);
			const appliedRevision = contentRevisionRef.current;
			await publishDirtyState(false, appliedRevision);
			return appliedRevision;
		},
		[committedTitleRef, editor, publishDirtyState, setTitle],
	);

	const showSourceTextConflict = useCallback(
		(diskDocument: BlablaHostSourceTextDocument) => {
			if (
				sameSourceRevision(
					diskDocument.sourceRevision,
					sourceRevisionRef.current,
				)
			) {
				return;
			}
			setConflict(diskDocument);
			void persistRecovery("conflict").catch(() => undefined);
		},
		[persistRecovery],
	);

	const saveDraft = useCallback(
		async (options: { overwrite?: boolean } = {}): Promise<MarkdownSaveResult> => {
			if (!editor) {
				return Promise.resolve({
					revision: contentRevisionRef.current,
					status: "clean",
				});
			}
			if (!await commitMarkdownFieldDrafts(editor)) {
				return Promise.resolve({ revision: contentRevisionRef.current, status: "invalid-input" });
			}
			if (savePromiseRef.current) {
				saveRequestedWhileSavingRef.current = true;
				return savePromiseRef.current;
			}
			if (!(dirtyRef.current || options.overwrite)) {
				return Promise.resolve({
					revision: contentRevisionRef.current,
					status: "clean",
				});
			}

			const run = async (): Promise<MarkdownSaveResult> => {
				let overwrite = options.overwrite;
				return runMarkdownSaveAgainLoop(async () => {
					try {
						if (!await commitMarkdownFieldDrafts(editor)) {
							return { result: { revision: contentRevisionRef.current, status: "invalid-input" }, saveAgain: false };
						}
						saveRequestedWhileSavingRef.current = false;
						const previousContent = currentContentRef.current;
						const content = resolveEditorContent(editor);
						if (content !== previousContent) {
							contentRevisionRef.current += 1;
							setDraftRevision(contentRevisionRef.current);
							void publishDirtyState(true, contentRevisionRef.current);
						}
						const capturedContentRevision = contentRevisionRef.current;
						await waitForMarkdownSourceWriteGate();
						const result = await host.document.writeSourceText({
							content,
							expectedSourceRevision: sourceRevisionRef.current,
							overwrite,
						});
						overwrite = false;
						if (result.status === "conflict") {
							setConflict(result.diskDocument);
							setSaveFailure(null);
							return {
								result: await recoverMarkdownSaveFailure(
									"conflict",
									persistRecovery,
									capturedContentRevision,
								),
								saveAgain: false,
							};
						}

						sourceRevisionRef.current = result.document.sourceRevision;
						savedContentRef.current = result.document.content;

						const hasPendingLocalChange = () =>
							saveRequestedWhileSavingRef.current ||
							contentRevisionRef.current !== capturedContentRevision ||
							currentContentRef.current !== result.document.content;

						if (hasPendingLocalChange()) {
							setSaveFailure(null);
							void publishDirtyState(true, contentRevisionRef.current);
							return {
								result: {
									revision: capturedContentRevision,
									status: "saved",
								},
								saveAgain: true,
							};
						}

						currentContentRef.current = result.document.content;
						// The acknowledged bytes are the live session's source. A save
						// advances the Host revision, not the editor's source index.
						setConflict(null);
						setSaveFailure(null);
						return {
							result: await completeMarkdownSave(capturedContentRevision, () =>
								markRevisionClean(capturedContentRevision),
							),
							// Recovery cleanup is asynchronous too. A later edit or
							// close request must still drain through this same loop.
							saveAgain: hasPendingLocalChange(),
						};
					} catch {
						const failure = await recoverMarkdownSaveFailure(
							"save-failed",
							persistRecovery,
							contentRevisionRef.current,
						);
						setSaveFailure(
							failure.status === "backup-failed"
								? "backup-failed"
								: "save-failed",
						);
						return {
							result: failure,
							saveAgain: false,
						};
					}
				});
			};
			const promise = run().finally(() => {
				if (savePromiseRef.current === promise) {
					savePromiseRef.current = null;
				}
			});
			savePromiseRef.current = promise;
			return promise;
		},
		[
			editor,
			host,
			markRevisionClean,
			persistRecovery,
			publishDirtyState,
			resolveEditorContent,
		],
	);

	const reloadDisk = useCallback(async () => {
		if (!conflict) {
			return;
		}
		await savePromiseRef.current?.catch(() => undefined);
		await applySourceTextDocument(conflict);
	}, [applySourceTextDocument, conflict]);

	useEffect(() => {
		if (!editor) {
			return;
		}
		const preservation = host.lifecycle.onPrepareDestroy(async ({ action }) => {
			if (action === "discard") {
				if (conflict) {
					return {
						revision: await applySourceTextDocument(conflict),
						status: "clean",
					};
				} else {
					await markRevisionClean(contentRevisionRef.current);
				}
				return {
					revision: contentRevisionRef.current,
					status: "clean",
				};
			}
			return prepareMarkdownDestroy(saveDraft);
		});
		if (!readyPromiseRef.current) {
            const ready = host.lifecycle.ready({
                saveMode: "autosave",
                title: document.title,
            }).then(() => undefined);
            readyPromiseRef.current = ready;
            void ready.then(() =>
					host.surface.setDirty({
						dirty: dirtyRef.current,
						revision: contentRevisionRef.current,
					}),
				);
		}
		return () => preservation.dispose();
	}, [
		applySourceTextDocument,
		clearRecovery,
		conflict,
		document.title,
		editor,
		host,
		persistRecovery,
		saveDraft,
		markRevisionClean,
	]);

	useEffect(() => {
		if (!(editor && MARKDOWN_E2E_TEST_HOOKS_ENABLED)) {
			return;
		}
		window.__blablaMarkdownEditor = editor;
		// Observe the real save, including recovery cleanup, without initiating one.
		const saveSettled = async () => savePromiseRef.current;
		window.__blablaMarkdownSaveSettled = saveSettled;
		return () => {
			if (window.__blablaMarkdownEditor === editor) {
				delete window.__blablaMarkdownEditor;
			}
			if (window.__blablaMarkdownSaveSettled === saveSettled) {
				delete window.__blablaMarkdownSaveSettled;
			}
		};
	}, [editor]);

	useEffect(() => {
		// Host teardown prepares drafts before destruction. A direct renderer reload
		// bypasses that handshake and must not discard a still-dirty editing session.
		const preventDirtyUnload = (event: BeforeUnloadEvent) => {
			if (!dirtyRef.current) return;
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", preventDirtyUnload);
		return () => window.removeEventListener("beforeunload", preventDirtyUnload);
	}, []);

	const getSourceWatchVersion = useCallback(
		() =>
			JSON.stringify([contentRevisionRef.current, sourceRevisionRef.current]),
		[],
	);
	useMarkdownSourceTextBridgeWatch({
		active: Boolean(editor),
		dirtyRef,
		documentId: document.documentId,
		getLocalVersion: getSourceWatchVersion,
		host,
		onCleanSourceChanged: applySourceTextDocument,
		onDirtySourceChanged: showSourceTextConflict,
	});

	useEffect(() => {
		if (!(dirty && editor && !conflict)) {
			return;
		}
		return scheduleMarkdownAutosave(() => {
			void saveDraft();
		});
	}, [compositionEndedRevision, conflict, dirty, editor, saveDraft]);

	useEffect(() => {
		if (!(dirty && editor)) {
			return;
		}
		const timer = window.setTimeout(() => {
			void persistRecovery(conflict ? "conflict" : "dirty").catch(() => undefined);
		}, MARKDOWN_RECOVERY_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, [conflict, dirty, draftRevision, editor, persistRecovery]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!isMarkdownSaveShortcut(event)) {
				return;
			}
			event.preventDefault();
			void saveDraft();
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [saveDraft]);

	return {
		conflict,
		handleEditorUpdate,
		initializeEditorContent,
		readSourceBlock,
		reloadDisk,
		saveDraft,
		saveFailure,
		setEditor,
	};
}

async function waitForMarkdownSourceWriteGate(): Promise<void> {
	if (!MARKDOWN_E2E_TEST_HOOKS_ENABLED) {
		return;
	}
	await window.__blablaMarkdownSourceWriteGate?.beforeSourceTextWrite();
}
