import type {
	BlablaHostSurfaceBackground,
	BlablaHostThemeChangeEvent,
	BlablaHostThemeState,
} from "./host-appearance";

export type {
	BlablaHostSurfaceBackground,
	BlablaHostThemeChangeEvent,
	BlablaHostThemeEffectiveMode,
	BlablaHostThemeMode,
	BlablaHostThemeState,
} from "./host-appearance";

import type { BlablaHostCapabilities } from "./host-capabilities";
import type {
	BlablaHostLifecycleApi,
	BlablaHostSourceTextDocumentApi,
	BlablaHostSurfaceStateApi,
} from "./host-document-api";
import type {
	BlablaHostDocumentFileReferenceResolution,
	BlablaHostFileReference,
	BlablaHostFileReferenceBytesImportItem,
	BlablaHostFileReferenceChangeEvent,
	BlablaHostFileReferenceImportResult,
	BlablaHostSurfaceFileReferenceAddEvent,
} from "./host-file-references";

export type { BlablaHostAssetKind } from "./host-assets";
export type { BlablaHostCapabilities } from "./host-capabilities";
export type {
	BlablaHostPreservationOutcome,
	BlablaHostSourceTextDocument,
	BlablaHostSourceTextRecoveryDraft,
	BlablaHostSourceTextRevision,
	BlablaHostSourceTextWriteResult,
} from "./host-document-api";
export type {
	BlablaHostDocumentFileReferenceResolution,
	BlablaHostFileReference,
	BlablaHostFileReferenceBytesImportItem,
	BlablaHostFileReferenceChangeEvent,
	BlablaHostFileReferenceImportResult,
	BlablaHostSurfaceFileReferenceAddEvent,
} from "./host-file-references";

export interface BlablaHostBridgeContext {
	language: "zh-CN" | "en";
	apiVersion: 1;
	capabilities: BlablaHostCapabilities;
	documentId: string;
	pluginId: string;
	surface: {
		background: BlablaHostSurfaceBackground;
	};
	surfaceId: string;
	surfaceInstanceId: string;
	tabId: string;
}

export interface BlablaHostBridge {
 settingsDialog: import("./host-settings-dialog").HostSettingsDialogApi;
  menus: import("./host-menu").HostMenuApi;
	readonly apiVersion: 1;
	appearance: {
		getTheme(): Promise<BlablaHostThemeState>;
	};
	context: {
		get(): Promise<BlablaHostBridgeContext>;
	};
	document: BlablaHostSourceTextDocumentApi;
	events: {
		on<T extends BlablaHostEvent["kind"]>(
			kind: T,
			listener: (event: Extract<BlablaHostEvent, { kind: T }>) => void,
		): BlablaHostDisposable;
	};
	fileReferences: {
		importBytes(input: {
			items: BlablaHostFileReferenceBytesImportItem[];
		}): Promise<BlablaHostFileReferenceImportResult>;
		onChanged(
			listener: (event: BlablaHostFileReferenceChangeEvent) => void,
		): BlablaHostDisposable;
		readByIds(ids: string[]): Promise<BlablaHostFileReference[]>;
		resolveDocumentFiles(input: {
			files: string[];
		}): Promise<BlablaHostDocumentFileReferenceResolution[]>;
		setSourceWatchIds(ids: string[]): Promise<{ ok: true }>;
	};
	imageExports: {
		copy(input: { bytes: Uint8Array }): Promise<{ ok: true }>;
		save(input: {
			name: string;
			variants: Array<{
				bytes: Uint8Array;
				format: "jpeg" | "png" | "svg";
			}>;
		}): Promise<{
			canceled: boolean;
			format?: "jpeg" | "png" | "svg";
		}>;
	};
	lifecycle: BlablaHostLifecycleApi<
		BlablaHostBridgeContext,
		BlablaHostDisposable
	>;
	surface: BlablaHostSurfaceStateApi;
	navigation: {
		openWebPage(input: { url: string }): Promise<{ tabId: string }>;
	};
	settings: {
		get(): Promise<BlablaHostSettingsRecord>;
		save(input: {
			expectedVersion?: number;
			value: unknown;
		}): Promise<BlablaHostSettingsRecord>;
	};
}

export interface BlablaHostSettingsRecord {
	updatedAt: number | null;
	value: unknown;
	version: number;
}

export interface BlablaHostDisposable {
	dispose(): void;
}

export interface BlablaHostSurfaceCommandEvent {
	command: "redo" | "undo";
	kind: "surface.command";
}

export type BlablaHostEvent =
	| { kind: "language.changed"; language: "zh-CN" | "en" }
	| BlablaHostFileReferenceChangeEvent
	| BlablaHostSurfaceCommandEvent
	| BlablaHostSurfaceFileReferenceAddEvent
	| BlablaHostThemeChangeEvent
	| { kind: "library.reset" };

declare global {
	interface Window {
		blablaHost?: BlablaHostBridge;
	}
}
