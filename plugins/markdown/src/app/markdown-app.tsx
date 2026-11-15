import { MarkdownLanguage } from "./markdown-tool-copy";
import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import type { BlablaHostThemeState } from "../host/host-api";
import {
	activateMarkdown,
	type MarkdownActivationState,
} from "./markdown-activation";

type LoadState = MarkdownActivationState<
	typeof import("./markdown-editor").MarkdownEditor
>;

type ThemeStyle = Record<`--${"md" | "tt"}-${string}`, string>;

export function MarkdownApp() {
	const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

	useEffect(() => {
		const host = window.blablaHost;
		if (!host) {
			setLoadState({
				error: "Blabla host bridge is unavailable.",
				status: "error",
			});
			return;
		}

		const dispose = activateMarkdown(
			host,
			() => import("./markdown-editor"),
			setLoadState,
		);

		const languageSubscription = host.events.on("language.changed", (event) => {
			setLoadState((current) =>
				current.status === "mountable"
					? { ...current, language: event.language }
					: current,
			);
		});
		const themeSubscription = host.events.on("theme.changed", (event) => {
			setLoadState((current) =>
				current.status === "mountable"
					? { ...current, theme: event.theme }
					: current,
			);
		});

		return () => {
			dispose();
			themeSubscription.dispose();
			languageSubscription.dispose();
		};
	}, []);

	useEffect(() => {
		if (loadState.status === "mountable")
			globalThis.document.documentElement.lang = loadState.language;
	}, [loadState]);
	const theme = loadState.status === "mountable" ? loadState.theme : null;

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
		return <Shell />;
	}

	if (loadState.status === "error") {
		return <Shell>{loadState.error}</Shell>;
	}

	const MarkdownEditor = loadState.Editor;
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

function Shell({ children }: { children?: ReactNode }) {
	if (children !== undefined)
		return (
			<main className="markdown-startup" role="alert">
				<h1>Could not open Markdown</h1>
				<p>{children}</p>
			</main>
		);
	return (
		<main
			className="markdown-startup"
			data-markdown-startup=""
			aria-label="Loading Markdown"
			aria-busy="true"
		>
			<div className="markdown-startup-skeleton" aria-hidden="true">
				<span />
				<span />
				<span />
				<span />
			</div>
		</main>
	);
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
