import { useEffect } from "react";
import type {
	BlablaHostBridge,
	BlablaHostFileReferenceChangeEvent,
	BlablaHostSourceTextDocument,
} from "../host/host-api";

declare global {
	interface Window {
		__blablaMarkdownSourceWatchReady?: Promise<{ ok: true }>;
	}
}

const MARKDOWN_E2E_TEST_HOOKS_ENABLED =
	import.meta.env.DEV || import.meta.env.VITE_BLABLA_MARKDOWN_E2E === "1";

export function useMarkdownSourceTextBridgeWatch(input: {
	active: boolean;
	dirtyRef: { current: boolean };
	documentId: string;
	getLocalVersion: () => string;
	host: BlablaHostBridge;
	onCleanSourceChanged: (document: BlablaHostSourceTextDocument) => void;
	onDirtySourceChanged: (document: BlablaHostSourceTextDocument) => void;
}) {
	const {
		active,
		dirtyRef,
		documentId,
		getLocalVersion,
		host,
		onCleanSourceChanged,
		onDirtySourceChanged,
	} = input;

	useEffect(() => {
		if (!active) {
			return;
		}

		let cancelled = false;
		const watchReady = host.fileReferences
			.setSourceWatchIds([documentId])
			.catch((error: unknown) => {
				console.warn(
					"Failed to watch Markdown source file.",
					error instanceof Error ? error.message : error,
				);
				return { ok: true as const };
			});

		if (MARKDOWN_E2E_TEST_HOOKS_ENABLED) {
			window.__blablaMarkdownSourceWatchReady = watchReady;
		}

		const refresh = async () => {
			while (!cancelled) {
				const version = getLocalVersion();
				const diskDocument = await host.document.readSourceText();
				if (cancelled) return;
				// A local edit or write acknowledgement invalidates this read.
				// Read current Host state again; never apply a stale snapshot.
				if (version !== getLocalVersion()) continue;
				if (dirtyRef.current) onDirtySourceChanged(diskDocument);
				else onCleanSourceChanged(diskDocument);
				return;
			}
		};
		const subscription = host.fileReferences.onChanged((event) => {
			if (!sourceChangeIncludesDocument(event, documentId)) return;
			void refresh().catch((error: unknown) => {
				console.warn(
					"Failed to reload Markdown source file.",
					error instanceof Error ? error.message : error,
				);
			});
		});

		return () => {
			cancelled = true;
			subscription.dispose();
			if (
				MARKDOWN_E2E_TEST_HOOKS_ENABLED &&
				window.__blablaMarkdownSourceWatchReady === watchReady
			) {
				delete window.__blablaMarkdownSourceWatchReady;
			}
			void host.fileReferences.setSourceWatchIds([]).catch(() => undefined);
		};
	}, [
		active,
		dirtyRef,
		documentId,
		getLocalVersion,
		host,
		onCleanSourceChanged,
		onDirtySourceChanged,
	]);
}

function sourceChangeIncludesDocument(
	event: BlablaHostFileReferenceChangeEvent,
	documentId: string,
): boolean {
	return (
		event.change === "source" &&
		event.references.some((reference) => reference.id === documentId)
	);
}
