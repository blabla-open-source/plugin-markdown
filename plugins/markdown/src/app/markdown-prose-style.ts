import type { JSONContent, MarkdownToken } from "@tiptap/core";
import stringWidth from "string-width";
import { recordMarkdownSerializedPrefix } from "./markdown-serialized-point";

export type ProseCreationPreferences = {
	proseIndent: "auto" | "tab" | "2" | "3" | "4" | "5";
	proseAlign: boolean;
	headingStyle: "atx" | "setext" | "closed-atx" | "wide-setext";
	bulletMarker: "-" | "+" | "*";
	orderedMarker: "increment" | "fixed";
};
export const defaultProseCreation: ProseCreationPreferences = {
	proseIndent: "2",
	proseAlign: false,
	headingStyle: "atx",
	bulletMarker: "-",
	orderedMarker: "increment",
};
export type ProseStyle = {
	heading?: ProseCreationPreferences["headingStyle"];
	underline?: number;
  closing?: string;
	marker?: string;
	gap?: number;
	indent?: string;
	fixed?: boolean;
};

export function generatedProseStyle(
	type: string,
	prefs: ProseCreationPreferences,
): ProseStyle {
	const size = Number(prefs.proseIndent) || 2;
	const ordered = type === "orderedList";
	return type === "heading"
		? { heading: prefs.headingStyle }
		: {
				marker:
					type === "blockquote" ? ">" : ordered ? "." : prefs.bulletMarker,
				gap: prefs.proseAlign ? Math.max(1, size - (ordered ? 2 : 1)) : 1,
				indent: prefs.proseIndent === "tab" ? "\t" : " ".repeat(size),
				fixed: ordered && prefs.orderedMarker === "fixed",
			};
}

/** Called only for tokens already admitted by the document's official lexer. */
export function parsedProseStyle(
	type: string,
	token: MarkdownToken,
): ProseStyle {
	const raw = token.raw ?? "";
	if (type === "heading") {
		const underline = raw.trimEnd().match(/\n *(=+|-+) *$/)?.[1];
		return underline
			? { heading: "setext", underline: underline.length }
			: {
					heading: /\s#+\s*$/.test(raw.trimEnd()) ? "closed-atx" : "atx",
          closing: /[ \t]+#+[ \t]*$/.exec(raw.replace(/[\r\n]+$/, ""))?.[0],
				};
	}
	const prefix = raw.match(/^ {0,3}(\d+[.)]|[-+*>])([ \t]*)/);
	const marker = prefix?.[1] ?? "-";
	const numbers = (token.items ?? []).map(
		(item) => (item.raw ?? "").match(/^ *(\d+)[.)]/)?.[1],
	);
	const nestedIndent = raw.match(/\n([ \t]+)\S/)?.[1];
	return {
		marker: type === "orderedList" ? marker.slice(-1) : marker,
		gap: prefix?.[2]?.length ?? 1,
		indent: nestedIndent ?? "  ",
		fixed:
			numbers.length > 1 && numbers.every((number) => number === numbers[0]),
	};
}

export function renderStyledHeading(
	node: JSONContent,
	content: string,
	inList: boolean,
): string {
	// An empty heading remains a heading when saved and reopened.
	const level = Number(node.attrs?.level) || 1;
	const style = node.attrs?.proseStyle as ProseStyle | null;
	if (
		content.trim() &&
		!inList &&
		level <= 2 &&
		(style?.heading === "setext" || style?.heading === "wide-setext")
	) {
		const width =
			style.underline ??
			(style.heading === "wide-setext" ? stringWidth(content) : 3);
		return `${content}\n${(level === 1 ? "=" : "-").repeat(Math.max(1, width))}`;
	}
	const marker = "#".repeat(level);
	recordMarkdownSerializedPrefix(node, marker.length + 1);
	return `${marker} ${content}${style?.heading === "closed-atx" ? (style.closing ?? ` ${marker}`) : ""}`;
}
