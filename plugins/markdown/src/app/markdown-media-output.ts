import type { DOMOutputSpec } from "@tiptap/pm/model";
import { renderHtmlBlockPreview } from "./markdown-html-block-preview";
import { authoredMediaSource } from "./markdown-media-resources";
import { isSafeMediaSource } from "./markdown-media-source";

/** Serialize authored candidates, never the preview's Host-resolved URLs. */
export function mediaSourceOutput(
	source: string,
	tag: "audio" | "video",
): DOMOutputSpec[] {
	const media = renderHtmlBlockPreview(source).fragment.querySelector(tag);
	return [...(media?.children ?? [])]
		.filter(
			(child) =>
				child instanceof HTMLSourceElement || child instanceof HTMLTrackElement,
		)
		.map((child) => {
			const original = authoredMediaSource(child);
			const attributes: Record<string, string> = {};
			if (original && isSafeMediaSource(original)) attributes.src = original;
			const names =
				child instanceof HTMLTrackElement
					? ["kind", "srclang", "label", "default"]
					: ["type", "media"];
			for (const name of names) {
				const value = child.getAttribute(name);
				if (value !== null) attributes[name] = value;
			}
			return [child.localName, attributes];
		});
}
