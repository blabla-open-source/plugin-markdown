import { defaultProseCreation, type ProseCreationPreferences } from "./markdown-prose-style";
import type { CodeEditingPreferences } from "./markdown-code-editing";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	BlablaHostBridge,
	BlablaHostSettingsRecord,
} from "../host/host-api";
import type { CodeCreationPreferences } from "./markdown-code-creation";
import type { InlineFormatPreferences } from "./markdown-inline-formats";

export type SequenceTheme = "simple" | "hand";
export type MarkdownPreferences = ProseCreationPreferences & InlineFormatPreferences &
	CodeCreationPreferences &
	CodeEditingPreferences & {
		sequenceTheme: SequenceTheme;
 expandSimpleBlock: boolean;
		emojiAutoComplete: boolean;
		inlineMath: boolean;
		autoLink: boolean;
		strictMode: boolean;
		alerts: boolean;
		diagrams: boolean;
	};

const channelName = "blabla-markdown-preferences";

function settingsObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function readPreferences(
	record: BlablaHostSettingsRecord,
): MarkdownPreferences {
	const value = settingsObject(record.value);
	return {
		proseIndent: ["auto", "tab", "2", "3", "4", "5"].includes(String(value.proseIndent)) ? String(value.proseIndent) as ProseCreationPreferences["proseIndent"] : "2",
		proseAlign: value.proseAlign === true,
		headingStyle: ["atx", "setext", "closed-atx", "wide-setext"].includes(String(value.headingStyle)) ? value.headingStyle as ProseCreationPreferences["headingStyle"] : defaultProseCreation.headingStyle,
		bulletMarker: value.bulletMarker === "+" || value.bulletMarker === "*" ? value.bulletMarker : "-",
		orderedMarker: value.orderedMarker === "fixed" ? "fixed" : "increment",
		codeIndentSize:
			typeof value.codeIndentSize === "number" &&
			[2, 3, 4, 5].includes(value.codeIndentSize)
				? value.codeIndentSize
				: 4,
		codePairing: value.codePairing !== false,
		codeLineNumbers: value.codeLineNumbers === true,
		codeLineWrapping: value.codeLineWrapping !== false,
		codeSmartIndent: value.codeSmartIndent === true,
		codeDefaultLanguage:
			typeof value.codeDefaultLanguage === "string"
				? value.codeDefaultLanguage
				: "",
		codeDefaultFor:
			value.codeDefaultFor === "commands" || value.codeDefaultFor === "both"
				? value.codeDefaultFor
				: "fences",
		expandSimpleBlock: value.expandSimpleBlock === true,
 sequenceTheme: value.sequenceTheme === "hand" ? "hand" : "simple",
		emojiAutoComplete: value.emojiAutoComplete !== false,
		inlineMath: value.inlineMath !== false,
		autoLink: value.autoLink !== false,
		strictMode: value.strictMode !== false,
		alerts: value.alerts !== false,
		diagrams: value.diagrams !== false,
		highlight: value.highlight !== false,
		subscript: value.subscript !== false,
		superscript: value.superscript !== false,
	};
}

async function persistPreferences(
	host: BlablaHostBridge,
	patch: Partial<MarkdownPreferences>,
) {
	for (let attempt = 0; attempt < 2; attempt++) {
		const current = await host.settings.get();
		try {
			return await host.settings.save({
				expectedVersion: current.version,
				value: { ...settingsObject(current.value), ...patch },
			});
		} catch (error) {
			if (attempt) throw error;
		}
	}
	throw new Error("Could not save preferences.");
}

export function useMarkdownPreferences(
	host: BlablaHostBridge,
	initial: BlablaHostSettingsRecord,
) {
	const [record, setRecord] = useState(initial);
	const [error, setError] = useState<string>();
	const [saving, setSaving] = useState(false);
	const pending = useRef(false);
	const channel = useRef<BroadcastChannel | undefined>(undefined);
	const preferences = readPreferences(record);
	const apply = useCallback((next: BlablaHostSettingsRecord) => {
		setRecord((current) => (next.version >= current.version ? next : current));
	}, []);

	useEffect(() => {
		let disposed = false;
		const refresh = () => {
			void host.settings
				.get()
				.then((next) => {
					if (!disposed) apply(next);
				})
				.catch(() => {
					// Keep the last confirmed preference; writes report their own failure.
				});
		};
		const next = new BroadcastChannel(channelName);
		next.onmessage = refresh;
		channel.current = next;
		window.addEventListener("focus", refresh);
		refresh();
		return () => {
			disposed = true;
			next.close();
			channel.current = undefined;
			window.removeEventListener("focus", refresh);
		};
	}, [apply, host]);

	useEffect(() => {
		const root = document.documentElement;
		root.dataset.sequenceTheme = preferences.sequenceTheme;
		return () => {
			delete root.dataset.sequenceTheme;
		};
	}, [preferences.sequenceTheme]);

	const save = useCallback(
		async (patch: Partial<MarkdownPreferences>) => {
			if (pending.current) return false;
			pending.current = true;
			setError(undefined);
			setSaving(true);
			try {
				apply(await persistPreferences(host, patch));
				channel.current?.postMessage("changed");
                return true;
			} catch {
				setError("Could not save preferences. Try again.");
                return false;
			} finally {
				pending.current = false;
				setSaving(false);
			}
		},
		[apply, host],
	);

	return { error, save, saving, ...preferences };
}
