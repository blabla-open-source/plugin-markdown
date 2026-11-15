import type {
	BlablaHostBridge,
	BlablaHostSettingsRecord,
	BlablaHostSourceTextDocument,
	BlablaHostSourceTextRecoveryDraft,
	BlablaHostThemeState,
} from "../host/host-api";

export type MarkdownActivationState<Editor> =
	| { status: "loading" }
	| { status: "error"; error: string }
	| {
			status: "mountable";
			Editor: Editor;
			host: BlablaHostBridge;
			document: BlablaHostSourceTextDocument;
			recovery: BlablaHostSourceTextRecoveryDraft | null;
			settings: BlablaHostSettingsRecord;
			language: "zh-CN" | "en";
			theme: BlablaHostThemeState | null;
	  };

/** One activation owns its results; disposal never cancels shared module loading. */
export function activateMarkdown<Editor>(
	host: BlablaHostBridge,
	loadEditor: () => Promise<{ MarkdownEditor: Editor }>,
	publish: (state: MarkdownActivationState<Editor>) => void,
) {
	let disposed = false;
	publish({ status: "loading" });
	// Schedule every producer before awaiting any of them. Synchronous bridge
	// errors become rejections too, so every started promise has an observer.
	void Promise.all([
		Promise.resolve().then(loadEditor),
		Promise.resolve().then(() => host.document.readSourceText()),
		Promise.resolve().then(() => host.document.readSourceTextRecovery()),
		Promise.resolve().then(() => host.appearance.getTheme()),
		Promise.resolve().then(() => host.settings.get()),
		Promise.resolve().then(() => host.context.get()),
	])
		.then(
			([
				{ MarkdownEditor: Editor },
				document,
				recovery,
				theme,
				settings,
				context,
			]) => {
				if (!disposed)
					publish({
						status: "mountable",
						Editor,
						host,
						document,
						recovery,
						theme,
						settings,
						language: context.language,
					});
			},
		)
		.catch((error: unknown) => {
			if (!disposed)
				publish({
					status: "error",
					error: error instanceof Error ? error.message : String(error),
				});
		});
	return () => {
		disposed = true;
	};
}
