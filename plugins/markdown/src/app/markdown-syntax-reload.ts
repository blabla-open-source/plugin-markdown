import { type RefObject, useRef, useState } from "react";
import type { MarkdownSaveResult } from "./markdown-save-policy";

/** Syntax changes apply only after the current view has saved its source. */
export function useMarkdownSyntaxReload(
	root: RefObject<HTMLElement | null>,
	saveTitle: () => Promise<void>,
	saveDocument: () => Promise<MarkdownSaveResult>,
) {
	const pending = useRef(false);
	const [applying, setApplying] = useState(false);
	const [error, setError] = useState<string>();
	const apply = async (beforeReload: () => Promise<void>) => {
		if (pending.current || !root.current) return;
		const surface = root.current;
		pending.current = true;
		surface.inert = true;
		setApplying(true);
		setError(undefined);
		let reloading = false;
		try {
			await saveTitle();
			const result = await saveDocument();
			if (result.status !== "saved" && result.status !== "clean") {
				setError("Resolve the document’s unsaved changes, then try again.");
				return;
			}
			await beforeReload();
			reloading = true;
			window.location.reload();
		} catch {
			setError("Could not reload this document. Try again.");
		} finally {
			if (!reloading) {
				surface.inert = false;
				pending.current = false;
				setApplying(false);
			}
		}
	};
	return { apply, applying, error };
}
