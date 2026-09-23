import { InputRule, mergeAttributes } from "@tiptap/core";
import { Blockquote } from "@tiptap/extension-blockquote";
import { SourceBlockquote } from "./markdown-blockquote";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { normalizeAlertClipboard } from "./markdown-alert-clipboard";
import {
	alertMarkerSelectionPlugin,
	exitEmptyAlert,
	settleAlertMarker,
} from "./markdown-alert-marker";
import {
	ALERT_HEADER,
	ALERT_PREFIX,
	sourceAlertType,
} from "./markdown-alert-source";
import { alertLabel, readAlertType } from "./markdown-alert-types";
import { alertNodeView } from "./markdown-alert-view";

const ALERT_INPUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\] ?$/i;

/** Alerts are blockquotes with a typed header, not a second container schema. */
export const MarkdownBlockquote = SourceBlockquote.extend({
	transformPastedHTML: normalizeAlertClipboard,
	addAttributes: () => ({
		alertBlock: {
			default: false,
			parseHTML: (element: HTMLElement) =>
				element.getAttribute("data-alert-block") === "true",
			renderHTML: (attrs: Record<string, unknown>) =>
				attrs.alertBlock ? { "data-alert-block": "true" } : {},
		},
		alertSource: {
			default: false,
			parseHTML: (element: HTMLElement) =>
				element.getAttribute("data-alert-source") === "true",
			renderHTML: (attrs: Record<string, unknown>) =>
				attrs.alertSource ? { "data-alert-source": "true" } : {},
		},
		alertMarker: {
			default: null,
			parseHTML: (element: HTMLElement) => {
				const marker = element.getAttribute("data-alert-marker");
				const type = readAlertType(element.getAttribute("data-alert"));
				if (
					marker === null &&
					type &&
					element.getAttribute("data-alert-source") !== "true"
				)
					return `[!${type.toUpperCase()}]`;
				return marker !== null &&
					!/[\r\n]/.test(marker) &&
					(element.querySelector(":scope > [data-alert-body]") ||
						ALERT_HEADER.exec(marker)?.[1] === marker)
					? marker
					: null;
			},
			renderHTML: (attrs: Record<string, unknown>) =>
				attrs.alertMarker !== null
					? { "data-alert-marker": attrs.alertMarker }
					: {},
		},
		alert: {
			default: null,
			parseHTML: (element: HTMLElement) =>
				readAlertType(element.getAttribute("data-alert")),
			renderHTML: (attrs: Record<string, unknown>) =>
				attrs.alert ? { "data-alert": attrs.alert } : {},
		},
	}),
	parseHTML: () => [
		{
			tag: "blockquote",
			contentElement: (element: HTMLElement) =>
				readAlertType(element.getAttribute("data-alert")) ||
				element.hasAttribute("data-alert-marker")
					? (element.querySelector<HTMLElement>(":scope > [data-alert-body]") ??
						element)
					: element,
		},
	],
	renderHTML({ node, HTMLAttributes }) {
		const type = readAlertType(node.attrs.alert);
		const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes);
		return (type || node.attrs.alertMarker !== null) && !node.attrs.alertSource
			? [
					"blockquote",
					attrs,
					[
						"div",
						{ "data-alert-title": "", contenteditable: "false" },
						type ? alertLabel(type) : node.attrs.alertMarker,
					],
					["div", { "data-alert-body": "" }, 0],
				]
			: ["blockquote", attrs, 0];
	},
	parseMarkdown(token, helpers) {
		const tokens = token.tokens ?? [];
		const first = tokens[0];
		// Check raw syntax, not decoded text: escaped/code/link markers stay literal.
		const raw = first?.type === "paragraph" ? (first.text ?? "") : "";
		const match = ALERT_HEADER.exec(raw);
		const firstContent = tokens.find((child) => child.type !== "space");
		const rawMarker =
			firstContent?.type === "paragraph" &&
			(firstContent.text ?? "").trimStart().startsWith("[!") &&
			firstContent.tokens?.[0]?.type === "text";
		const type = readAlertType(
			(
				match?.[2] ?? (rawMarker ? ALERT_PREFIX.exec(raw)?.[1] : null)
			)?.toLowerCase(),
		);
		let bodyTokens = tokens;
		const gap = tokens[1]?.type === "space" ? tokens[1] : undefined;
		const alertBlock = Boolean(match && match[0].length === raw.length && gap);
		if (first && match && type) {
			if (!helpers.tokenizeInline)
				throw new Error(
					"Alerts require Tiptap Markdown tokenizeInline support.",
				);
			const text = (first.text ?? "").slice(match[0].length);
			// Retokenize after removing the header, so trailing spaces on its line
			// cannot leak a hard break into the body. Helpers retain reference links.
			bodyTokens = text
				? [
						{ ...first, text, tokens: helpers.tokenizeInline(text, {
							tokens: first.tokens ?? [], from: match[0].length, to: raw.length,
						}) },
						...tokens.slice(1),
					]
				: alertBlock && gap
					? [{ ...gap, raw: (gap.raw ?? "").slice(2) }, ...tokens.slice(2)]
					: tokens.slice(1);
		}
		const content = (helpers.parseBlockChildren ?? helpers.parseChildren)(
			bodyTokens,
		);
		// Marked exposes a leading soft line as a space token; block parsing
		// drops it. Keep it in the raw marker paragraph so it survives editing.
		if (rawMarker && first?.type === "space" && first.raw === "\n") {
			const text = content[0]?.content?.[0];
			if (text?.type === "text") text.text = `\n${text.text ?? ""}`;
		}
		return helpers.createNode(
			"blockquote",
			{
				alert: type,
				alertSource: Boolean(rawMarker && !match),
				alertMarker: match?.[1] ?? null,
				alertBlock,
			},
			content.length ? content : [helpers.createNode("paragraph")],
		);
	},
	renderMarkdown(node, helpers, context) {
		const body =
			Blockquote.config.renderMarkdown?.call(this, node, helpers, context) ??
			"";
		const type = readAlertType(node.attrs?.alert);
		const marker =
			node.attrs?.alertMarker ?? (type ? `[!${type.toUpperCase()}]` : null);
		return marker !== null && !node.attrs?.alertSource
			? `> ${marker}\n${node.attrs?.alertBlock ? ">\n" : ""}${body}`
			: body;
	},
	addNodeView: () => alertNodeView,
	addInputRules() {
		return [
			...(this.parent?.() ?? []),
			new InputRule({
				find: ALERT_INPUT,
				handler: ({ state, range, match }) => {
					const { $from } = state.selection;
					const parentDepth = $from.depth - 1;
					if (
						parentDepth < 1 ||
						$from.node(parentDepth).type !== this.type ||
						$from.index(parentDepth) !== 0 ||
						$from.parent.type.name !== "paragraph"
					)
						return null;
					state.tr
						.delete(range.from, range.to)
						.setNodeMarkup($from.before(parentDepth), undefined, {
							...$from.node(parentDepth).attrs,
							alert: readAlertType(match[1]?.toLowerCase()),
							alertSource: false,
							alertMarker: match[0].trimEnd(),
							alertBlock: false,
						});
					return undefined;
				},
			}),
		];
	},
	addProseMirrorPlugins() {
		return [
			...(this.parent?.() ?? []),
			alertMarkerSelectionPlugin(),
			new Plugin({
				appendTransaction: (transactions, _oldState, state) => {
					if (
						!transactions.some(
							(transaction) =>
								transaction.docChanged || transaction.selectionSet,
						)
					)
						return null;
					const tr = state.tr;
					state.doc.descendants((node, pos) => {
						if (node.type !== this.type) return;
						const mapped = tr.mapping.map(pos);
						settleAlertMarker(tr, mapped);
						if (!node.attrs.alertSource) return;
						const type = sourceAlertType(node.firstChild?.toJSON());
						if (type !== node.attrs.alert)
							tr.setNodeMarkup(mapped, undefined, {
								...node.attrs,
								alert: type,
							});
					});
					return tr.docChanged ? tr : null;
				},
			}),
		];
	},
	addKeyboardShortcuts() {
		return {
			...this.parent?.(),
			Enter: () => exitEmptyAlert(this.editor.view),
			Backspace: () => {
				const { state } = this.editor;
				const { $from, empty } = state.selection;
				const depth = $from.depth - 1;
				if (
					empty &&
					depth > 0 &&
					$from.parentOffset === 0 &&
					$from.index(depth) === 0 &&
					$from.node(depth).type === this.type &&
					$from.node(depth).attrs.alert &&
					!$from.node(depth).attrs.alertSource &&
					$from.parent.type.name === "paragraph"
				) {
					const node = $from.node(depth);
					const marker =
						node.attrs.alertMarker ?? `[!${node.attrs.alert.toUpperCase()}]`;
					const text = marker;
					const tr = closeHistory(state.tr).insert(
						$from.pos,
						state.schema.text(text),
					);
					tr.setNodeMarkup($from.before(depth), undefined, {
						...node.attrs,
						alertSource: true,
						alertMarker: null,
						alertBlock: false,
					});
					tr.setSelection(
						TextSelection.create(tr.doc, $from.pos + text.length),
					);
					this.editor.view.dispatch(tr.scrollIntoView());
					this.editor.view.dispatch(closeHistory(this.editor.state.tr));
					return true;
				}
				return this.parent?.().Backspace?.({ editor: this.editor }) ?? false;
			},
		};
	},
});

/** Disabled alerts use the official quote behavior and keep marker text editable. */
export function createMarkdownBlockquote(enabled = true) {
	if (enabled) return MarkdownBlockquote;
	return SourceBlockquote.extend({
		addAttributes: () => ({ alertSource: { default: true, rendered: false } }),
		transformPastedHTML: (html) => normalizeAlertClipboard(html, false),
		parseMarkdown(token, helpers) {
			const first = token.tokens?.find((child) => child.type !== "space");
			const rawMarker =
				first?.type === "paragraph" &&
				(first.text ?? "").trimStart().startsWith("[!") &&
				first.tokens?.[0]?.type === "text";
			return helpers.createNode(
				"blockquote",
				{ alertSource: Boolean(rawMarker) },
				(helpers.parseBlockChildren ?? helpers.parseChildren)(
					token.tokens ?? [],
				),
			);
		},
	});
}
