import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useCallback, useState } from "react";
import type { BlablaHostBridge } from "../host/host-api";
import { focusReferenceDefinition } from "./markdown-reference-links";
import { namedAnchorTarget } from "./markdown-html-anchor";
import {
	findHtmlBlockAnchor,
	focusHtmlBlockAnchor,
} from "./markdown-html-block-preview";

/** Opening is a Host operation, never a URL relative to the plugin server. */
export function useMarkdownLinkNavigation(host: BlablaHostBridge) {
	const [error, setError] = useState<string | null>(null);
	const openLink = useCallback(
		(address: string, view?: EditorView) => {
			setError(null);
			void (async () => {
				if (address.startsWith("#")) {
					if (!view || !focusDocumentAnchor(view, address))
						throw new Error("No matching heading or named anchor was found.");
					return;
				}
				if (!/^https?:\/\//i.test(address.trim())) {
					throw new Error(
						"Only HTTP and HTTPS links can be opened in Blabla. File links and cross-file anchors are not supported yet.",
					);
				}
				if (!host.navigation?.openWebPage) {
					throw new Error(
						"This version of Blabla cannot open webpage tabs. Update Blabla and try again.",
					);
				}
				await host.navigation.openWebPage({ url: address });
			})().catch((reason: unknown) => {
				setError(
					reason instanceof Error
						? reason.message
						: "Could not open the link in Blabla.",
				);
			});
		},
		[host],
	);
	const handleClick = useCallback(
		(view: EditorView, _pos: number, event: MouseEvent, editor: Editor | null) => {
			if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false;
			const link =
				event.target instanceof Element
					? event.target.closest("a[href]")
					: null;
			if (!link || !view.dom.contains(link)) return false;
			event.preventDefault();
			const address = link.getAttribute("href") ?? "";
			const reference = link.getAttribute("data-reference-label");
			if (!address && reference && editor && focusReferenceDefinition(editor, reference)) {
				setError("Add an address to this reference definition.");
			} else openLink(address, view);
			return true;
		},
		[openLink],
	);
	return { error, handleClick, openLink };
}

export function compatibleHeadingAnchor(text: string): string {
	return text
		.toLowerCase()
		.trim()
		.replace(/—/gu, "㌾㌾㌾")
		.replace(/–/gu, "㌾㌾")
		.replace(/[\s-]/gu, "㌾")
		.replace(/\p{P}|[+=]/gu, "")
		.replace(/㌾/gu, "-");
}


function headingAnchorAliases(node: ProseMirrorNode): Set<string> {
	return new Set(
		(["plain", "shortcode", "content"] as const).map((form) => {
			const text = node.textBetween(0, node.content.size, "", (leaf) => {
				if (leaf.type.name === "footnoteReference") return `[^${leaf.attrs.label}]`;
				if (leaf.type.name !== "emoji" || form === "plain") return "";
				// Native headings retain one zero-width control on each side of Emoji.
				const content = form === "shortcode" ? `:${leaf.attrs.name}:` : "";
				return `\u200b${content}\u200b`;
			});
			return compatibleHeadingAnchor(text);
		}),
	);
}

function decodedAnchor(address: string): string | null {
	try {
		return decodeURIComponent(address.slice(1));
	} catch {
		return null;
	}
}

function focusDocumentAnchor(view: EditorView, address: string): boolean {
	const target = decodedAnchor(address);
	if (!target) return false;
	const headings: { anchors: Set<string>; pos: number }[] = [];
	const named: { pos: number; preview: HTMLAnchorElement | null }[] = [];
	view.state.doc.descendants((node, pos) => {
		if (node.type.name === "heading")
			headings.push({ anchors: headingAnchorAliases(node), pos });
		if (named.length) return;
		if (
			node.type.name === "htmlAnchor" &&
			namedAnchorTarget(String(node.attrs.source ?? "")) === target
		)
			named.push({ pos, preview: null });
		if (node.type.name === "htmlBlock") {
			const preview = findHtmlBlockAnchor(view.nodeDOM(pos), target);
			if (preview) named.push({ pos, preview });
		}
	});
	if (named[0]?.preview) {
		focusHtmlBlockAnchor(named[0].preview);
		return true;
	}
	let position: number | null = named[0]?.pos ?? null;
	if (position === null) {
		position =
			headings.find((heading) => heading.anchors.has(target))?.pos ?? null;
	}
	if (position === null) {
		const duplicate = /^(.*)-(\d+)$/u.exec(target);
		const ordinal = Number(duplicate?.[2]);
		const base = duplicate?.[1];
		if (base && Number.isSafeInteger(ordinal) && ordinal > 0)
			position =
				headings.filter((heading) => heading.anchors.has(base))[
					ordinal - 1
				]?.pos ?? null;
	}
	if (position === null) return false;
	view.dispatch(
		view.state.tr
			.setSelection(TextSelection.near(view.state.doc.resolve(position + 1)))
			.scrollIntoView(),
	);
	view.focus();
	const element = view.nodeDOM(position);
	if (element instanceof HTMLElement)
		element.scrollIntoView({ behavior: "instant", block: "center" });
	return true;
}
