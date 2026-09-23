import { MarkdownLanguage } from "./markdown-tool-copy";
import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import type {
	BlablaHostBridge,
	BlablaHostSettingsRecord,
	BlablaHostSourceTextDocument,
	BlablaHostSourceTextRecoveryDraft,
	BlablaHostThemeState,
} from "../host/host-api";
import { MarkdownEditor } from "./markdown-editor";

type LoadState =
	| {
			error: string;
			status: "error";
	  }
	| {
			document: BlablaHostSourceTextDocument;
			host: BlablaHostBridge;
			recovery: BlablaHostSourceTextRecoveryDraft | null;
			settings: BlablaHostSettingsRecord;
			language: "zh-CN" | "en";
			status: "ready";
			theme: BlablaHostThemeState | null;
	  }
	| {
			status: "loading";
	  };

type ThemeStyle = Record<`--${"md" | "tt"}-${string}`, string>;

export function MarkdownApp() {
	const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		const host = window.blablaHost;
		if (!host) {
			setLoadState({
				error: "Blabla host bridge is unavailable.",
				status: "error",
			});
			return;
		}

		Promise.all([
			host.document.readSourceText(),
			host.document.readSourceTextRecovery(),
			host.appearance.getTheme(),
			host.settings.get(),
			host.context.get(),
		])
			.then(([document, recovery, theme, settings, context]) => {
				if (!cancelled) {
					setLoadState({
						document,
						host,
						recovery,
						settings,
						language: context.language,
						status: "ready",
						theme,
					});
				}
			})
			.catch((error) => {
				if (!cancelled) {
					setLoadState({
						error: error instanceof Error ? error.message : String(error),
						status: "error",
					});
				}
			});

		const languageSubscription = host.events.on("language.changed", (event) => {
			setLoadState((current) =>
				current.status === "ready"
					? { ...current, language: event.language }
					: current,
			);
		});
		const themeSubscription = host.events.on("theme.changed", (event) => {
			setLoadState((current) =>
				current.status === "ready"
					? { ...current, theme: event.theme }
					: current,
			);
		});

		return () => {
			cancelled = true;
			themeSubscription.dispose();
			languageSubscription.dispose();
		};
	}, []);

	useEffect(() => {
		if (loadState.status === "ready")
			globalThis.document.documentElement.lang = loadState.language;
	}, [loadState]);
	const theme = loadState.status === "ready" ? loadState.theme : null;

	useLayoutEffect(() => {
		const root = globalThis.document.documentElement;
		const variables = Object.entries(themeVars(theme) ?? {});
		for (const [name, value] of variables) root.style.setProperty(name, value);
		const effectiveTheme = theme?.effective;
		root.classList.toggle("dark", effectiveTheme === "dark");
		if (effectiveTheme) {
			root.style.colorScheme = effectiveTheme;
		}

		return () => {
			for (const [name] of variables) root.style.removeProperty(name);
			root.classList.remove("dark");
			root.style.removeProperty("color-scheme");
		};
	}, [theme]);

	if (loadState.status === "loading") {
		return <Shell>Loading</Shell>;
	}

	if (loadState.status === "error") {
		return <Shell>{loadState.error}</Shell>;
	}

	return (
		<MarkdownLanguage value={loadState.language}>
			<MarkdownEditor
				document={loadState.document}
				host={loadState.host}
				recovery={loadState.recovery}
				settings={loadState.settings}
				dark={loadState.theme?.effective === "dark"}
			/>
		</MarkdownLanguage>
	);
}

function Shell({ children }: { children: ReactNode }) {
	return <main className="markdown-shell">{children}</main>;
}

function themeVars(theme: BlablaHostThemeState | null): ThemeStyle | undefined {
	if (!theme) {
		return;
	}
	return {
		"--md-accent": theme.tokens.accent,
		"--md-accent-foreground": theme.tokens.accentForeground,
		"--md-background": theme.tokens.background,
		"--md-border": theme.tokens.border,
		"--md-caret": theme.tokens.foreground,
		"--md-code-background": theme.effective === "dark" ? "#111827" : "#f3f4f6",
		"--md-code-foreground": theme.effective === "dark" ? "#f9fafb" : "#1f2937",
		"--md-foreground": theme.tokens.foreground,
		"--md-muted": theme.tokens.muted,
		"--md-muted-foreground": theme.tokens.mutedForeground,
		"--md-primary": theme.tokens.primary,
		"--md-primary-foreground": theme.tokens.primaryForeground,
		"--md-surface": theme.tokens.surface,
		"--tt-bg-color": theme.tokens.background,
		"--tt-border-color": theme.tokens.border,
		"--tt-border-color-tint": theme.tokens.muted,
		"--tt-brand-color-400": theme.tokens.primary,
		"--tt-brand-color-500": theme.tokens.primary,
		"--tt-card-bg-color": theme.tokens.surface,
		"--tt-card-border-color": theme.tokens.border,
		"--tt-cursor-color": theme.tokens.foreground,
		"--tt-selection-color":
			theme.effective === "dark"
				? "rgb(245 245 247 / 18%)"
				: "rgb(37 99 235 / 16%)",
		"--tt-toolbar-bg-color": "transparent",
		"--tt-toolbar-border-color": "transparent",
		"--md-warning": theme.effective === "dark" ? "#fbbf24" : "#7a3e00",
		"--md-warning-background":
			theme.effective === "dark" ? "#3b2a12" : "#fff4e5",
		"--md-warning-border": theme.effective === "dark" ? "#6b4e16" : "#f0c36d",
		"--md-warning-surface":
			theme.effective === "dark" ? theme.tokens.surface : "#ffffff",
	};
}
