import type { BlablaHostAssetKind } from "./host-assets";

export interface BlablaHostSurfaceFileReferenceAddEvent {
	clientX?: number;
	clientY?: number;
	kind: "surface.fileReferences.add";
	referenceIds: string[];
}

export interface BlablaHostFileReferenceBytesImportItem {
	bytes: Uint8Array<ArrayBuffer>;
	mime?: string;
	name: string;
}

export interface BlablaHostFileReferenceImportResult {
	references: BlablaHostFileReference[];
}

export interface BlablaHostDocumentFileReferenceResolution {
	file: string;
	reference: BlablaHostFileReference;
}

export interface BlablaHostFileReferenceChangeEvent {
	change: "import" | "remove" | "restore" | "source" | "trash" | "update";
	kind: "fileReferences.changed";
	references: BlablaHostFileReference[];
	removedReferenceIds: string[];
}

export interface BlablaHostFileReference {
	addedAt: number;
	byteSize: number;
	colorSwatches?: Array<{ hex: string; ratio: number }>;
	contentPreview?: string;
	derivativesPending?: boolean;
	duration?: number;
	height?: number;
	id: string;
	kind: BlablaHostAssetKind;
	largePreviewUrl: string | null;
	mime: string;
	missing: boolean;
	mtime: number;
	name: string;
	pageCount?: number;
	prepareError?: string;
	prepareStatus?: "failed" | "pending" | "ready";
	previewHeight?: number;
	previewUrl: string | null;
	previewWidth?: number;
	sourceFingerprint?: string;
	sourceKind: "file" | "remote-video";
	sourceStorageKind?: "external" | "library";
	sourceUrl: string | null;
	suggestedTags?: string[];
	tags: string[];
	trashedAt?: number;
	width?: number;
}
