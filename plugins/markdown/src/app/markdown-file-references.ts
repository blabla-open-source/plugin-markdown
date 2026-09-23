import type { JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import { useEffect } from "react";
import type {
	BlablaHostBridge,
	BlablaHostFileReference,
} from "../host/host-api";
import {
	audioAttributesFromSource,
	audioSourceForUrl,
} from "./markdown-audio-source";
import {
	videoAttributesFromSource,
	videoSourceForUrl,
} from "./markdown-video-source";

const AUDIO_FILE_EXTENSION =
	/\.(?:aac|flac|m4a|m4p|mp3|oga|ogg|opus|vox|wav|wave|wma)$/i;
const VIDEO_FILE_EXTENSION =
	/\.(?:avi|flv|m4p|mkv|mov|mp4|mpeg|mpg|mpv|ogg|rm|rmvb|webm|wmv)$/i;

export const MARKDOWN_IMAGE_MIME_TYPES = [
	"image/avif",
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/svg+xml",
	"image/webp",
];

export const MARKDOWN_AUDIO_MIME_TYPES = [
	"audio/aac",
	"audio/flac",
	"audio/mp4",
	"audio/mpeg",
	"audio/ogg",
	"audio/wav",
	"audio/webm",
	"audio/x-wav",
];

export const MARKDOWN_VIDEO_MIME_TYPES = [
	"video/mp4",
	"video/mpeg",
	"video/ogg",
	"video/quicktime",
	"video/webm",
	"video/x-flv",
	"video/x-matroska",
	"video/x-ms-wmv",
	"video/x-msvideo",
];

export const MARKDOWN_MEDIA_MIME_TYPES = [
	...MARKDOWN_IMAGE_MIME_TYPES,
	...MARKDOWN_AUDIO_MIME_TYPES,
	...MARKDOWN_VIDEO_MIME_TYPES,
];

export function useMarkdownFileReferenceInsertions(input: {
	editor: Editor | null;
	host: BlablaHostBridge;
}): void {
	useEffect(() => {
		if (!input.editor) {
			return;
		}

		const editor = input.editor;
		const subscription = input.host.events.on(
			"surface.fileReferences.add",
			(event) => {
				const position = editorPositionFromPoint(editor, event);
				void insertMediaFileReferencesFromIds({
					editor,
					host: input.host,
					position,
					referenceIds: event.referenceIds,
				});
			},
		);
		return () => subscription.dispose();
	}, [input.editor, input.host]);
}

export function insertMediaFileReferencesFromIds(input: {
	editor: Editor;
	host: BlablaHostBridge;
	position?: number;
	referenceIds: string[];
}): Promise<void> {
	return input.host.fileReferences
		.readByIds(input.referenceIds)
		.then((references) =>
			insertMediaFileReferences({
				editor: input.editor,
				position: input.position,
				references,
			}),
		);
}

export async function importAndInsertMediaFiles(input: {
	editor: Editor;
	files: File[];
	host: BlablaHostBridge;
	position?: number;
}): Promise<void> {
	const mediaFiles = input.files.filter(isMediaFile);
	if (mediaFiles.length === 0) {
		return;
	}

	const items = await Promise.all(
		mediaFiles.map(async (file) => ({
			bytes: new Uint8Array(await file.arrayBuffer()),
			mime: file.type || "application/octet-stream",
			name: file.name || pastedMediaFileName(file),
		})),
	);
	const result = await input.host.fileReferences.importBytes({ items });

	insertMediaFileReferences({
		editor: input.editor,
		position: input.position,
		references: result.references,
	});
}

export function editorPositionFromPoint(
	editor: Editor,
	point: { clientX?: number; clientY?: number },
): number | undefined {
	if (typeof point.clientX !== "number" || typeof point.clientY !== "number") {
		return undefined;
	}

	return (
		editor.view.posAtCoords({
			left: point.clientX,
			top: point.clientY,
		})?.pos ?? undefined
	);
}

function insertMediaFileReferences(input: {
	editor: Editor;
	position?: number;
	references: BlablaHostFileReference[];
}): void {
	const nodes = input.references.flatMap<JSONContent>((reference) => {
		const src = referenceUrl(reference);
		if (!src) return [];
		if (isVideoReference(reference)) {
			const source = videoSourceForUrl(src);
			return [{ attrs: videoAttributesFromSource(source), type: "video" }];
		}
		if (isAudioReference(reference)) {
			const source = audioSourceForUrl(src);
			return [{ attrs: audioAttributesFromSource(source), type: "audio" }];
		}
		if (reference.kind === "image" || reference.mime.startsWith("image/"))
			return [
				{
					attrs: {
						alt: reference.name,
						src,
						title: reference.name,
					},
					type: "image",
				},
			];
		return [];
	});

	if (nodes.length === 0) {
		return;
	}

	const chain = input.editor.chain().focus();
	if (typeof input.position === "number") {
		chain.insertContentAt(input.position, nodes).run();
		return;
	}

	chain.insertContent(nodes).run();
}

function referenceUrl(reference: BlablaHostFileReference): string | null {
	return (
		reference.sourceUrl ?? reference.largePreviewUrl ?? reference.previewUrl
	);
}

function isAudioReference(reference: BlablaHostFileReference): boolean {
	return (
		reference.mime.startsWith("audio/") ||
		AUDIO_FILE_EXTENSION.test(reference.name)
	);
}

function isVideoReference(reference: BlablaHostFileReference): boolean {
	return (
		reference.kind === "video" ||
		reference.mime.startsWith("video/") ||
		(!reference.mime.startsWith("audio/") &&
			VIDEO_FILE_EXTENSION.test(reference.name))
	);
}

function isMediaFile(file: File): boolean {
	return (
		MARKDOWN_MEDIA_MIME_TYPES.includes(file.type) ||
		file.type.startsWith("image/") ||
		file.type.startsWith("audio/") ||
		file.type.startsWith("video/") ||
		AUDIO_FILE_EXTENSION.test(file.name) ||
		VIDEO_FILE_EXTENSION.test(file.name)
	);
}

function pastedMediaFileName(file: File, now: number = Date.now()): string {
	const timestamp = new Date(now)
		.toISOString()
		.replace(/\.\d{3}Z$/, "Z")
		.replace(/[:]/g, "-");
	if (file.type.startsWith("video/") || VIDEO_FILE_EXTENSION.test(file.name))
		return `Pasted Video ${timestamp}.mp4`;
	if (file.type.startsWith("audio/") || AUDIO_FILE_EXTENSION.test(file.name))
		return `Pasted Audio ${timestamp}.wav`;
	return `Pasted Image ${timestamp}.png`;
}
