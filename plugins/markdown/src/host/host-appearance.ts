export type BlablaHostThemeMode = "dark" | "light" | "system";
export type BlablaHostThemeEffectiveMode = "dark" | "light";
export type BlablaHostSurfaceBackground = "host-material" | "page" | "theme";

export interface BlablaHostThemeState {
	accentColor: {
		color: string;
		foreground: string;
		id: string;
	};
	effective: BlablaHostThemeEffectiveMode;
	mode: BlablaHostThemeMode;
	tokens: {
		accent: string;
		accentForeground: string;
		assetAction: string;
		background: string;
		border: string;
		foreground: string;
		muted: string;
		mutedForeground: string;
		primary: string;
		primaryForeground: string;
		surface: string;
	};
}

export interface BlablaHostThemeChangeEvent {
	kind: "theme.changed";
	theme: BlablaHostThemeState;
}
