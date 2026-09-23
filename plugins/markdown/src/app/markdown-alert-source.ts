import type { JSONContent } from "@tiptap/core";
import { readAlertType } from "./markdown-alert-types";

export const ALERT_HEADER =
	/^([\t ]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][\t ]*)(?:\n|$)/i;
export const ALERT_PREFIX = /^[\t ]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
const RAW_MARKER = /^[\t \n]*\[![^\s[\]]*(?:\n[^\s[\]]*\])?\]?/;

export function sourceAlertType(first?: JSONContent) {
	const text = first?.type === "paragraph" ? first.content?.[0] : undefined;
	return text?.type === "text" && !text.marks?.length
		? readAlertType(ALERT_PREFIX.exec(text.text ?? "")?.[1]?.toLowerCase())
		: null;
}

/** Preserve authored marker syntax only on a raw-marker quote, not escaped prose. */
export function protectAlertSource(
	node: JSONContent,
	protect: (source: string) => string,
): JSONContent {
	if (node.type !== "blockquote" || !node.attrs?.alertSource) return node;
	let atMarker = true;
	let continued = false;
	return {
		...node,
		content: node.content?.map((paragraph) => {
			if (
				atMarker &&
				paragraph.type === "paragraph" &&
				!paragraph.content?.length
			)
				return paragraph;
			const text =
				paragraph.type === "paragraph" ? paragraph.content?.[0] : undefined;
			const marker =
				text?.type === "text" && !text.marks?.length
					? ((atMarker ? RAW_MARKER.exec(text.text ?? "")?.[0] : null) ??
						(continued ? /^[^\s[\]]*\]/.exec(text.text ?? "")?.[0] : null))
					: null;
			atMarker = false;
			// A split header may finish in the next paragraph. Do not protect
			// unrelated brackets, formatted text, links or code as marker syntax.
			continued = Boolean(
				marker &&
					!marker.endsWith("]") &&
					marker === text?.text &&
					paragraph.content?.length === 1,
			);
			if (!marker || !text) return paragraph;
			return {
				...paragraph,
				content: [
					{
						...text,
						// Keep line breaks visible to the quote renderer for indentation.
						text:
							marker.replace(/[^\n]+/g, protect) +
							(text.text ?? "").slice(marker.length),
					},
					...(paragraph.content?.slice(1) ?? []),
				],
			};
		}),
	};
}
