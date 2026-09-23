import {
	defaultCodeEditorConfiguration,
	type CodeEditorConfiguration,
} from "./markdown-code-editing";
import {
	codeLanguageSuggestion,
	suggestedCodeLanguage,
	type CodeCreationPreferences,
} from "./markdown-code-creation";
import { getExtensionField } from "@tiptap/core";
import { CodeBlock, type CodeBlockOptions } from "@tiptap/extension-code-block";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin } from "@tiptap/pm/state";
import { exitDiagramCode, diagramNodeView } from "./markdown-diagram-view";
import { diagramEngine } from "./markdown-diagram-engine";
import { plainCodeNodeView } from "./markdown-plain-code-view";
import type { BlablaHostBridge } from "../host/host-api";

const fenceAttribute = (name: string) => ({
	default: null,
	parseHTML: (element: HTMLElement) =>
		element.getAttribute(`data-diagram-${name}`),
	renderHTML: (attrs: Record<string, unknown>) =>
		attrs[name] ? { [`data-diagram-${name}`]: attrs[name] } : {},
});

export const MarkdownCodeBlock = (host: BlablaHostBridge) =>
	CodeBlock.extend<
		CodeBlockOptions & {
			diagrams: boolean;
			getCodeEditorConfiguration: () => CodeEditorConfiguration;
			getCodeCreationPreferences: () => CodeCreationPreferences;
		},
		{ lastLanguage: string }
	>({
		addOptions() {
			return {
				...this.parent!(),
				diagrams: true,
				getCodeEditorConfiguration: () => defaultCodeEditorConfiguration,
				getCodeCreationPreferences: () => ({
					codeDefaultLanguage: "",
					codeDefaultFor: "fences",
				}),
			};
		},
		addStorage() {
			return { lastLanguage: "" };
		},
		onTransaction() {
			const node = this.editor.state.selection.$from.parent;
			if (node.type === this.type)
				this.storage.lastLanguage = node.attrs.language ?? "";
		},
		addInputRules() {
			return [
				codeLanguageSuggestion(() =>
					suggestedCodeLanguage(
						this.options.getCodeCreationPreferences(),
						"fences",
						this.storage.lastLanguage,
					),
				),
				...(this.parent?.() ?? []),
			];
		},
		addCommands() {
			return {
				...this.parent?.(),
				toggleCodeBlock:
					(attributes) =>
					({ commands }) =>
						commands.toggleNode(this.name, "paragraph", {
							language:
								suggestedCodeLanguage(
									this.options.getCodeCreationPreferences(),
									"commands",
									this.storage.lastLanguage,
								) || null,
							...attributes,
						}),
			};
		},
		addProseMirrorPlugins() {
			return [
				...(this.parent?.() ?? []),
				new Plugin({
					appendTransaction: (transactions, before, after) => {
						if (
							!this.options.diagrams ||
							transactions.some((tr) => tr.docChanged) ||
							!transactions.some((tr) => tr.selectionSet)
						)
							return null;
						const { $from, $to } = before.selection;
						if (
							$from.parent.type !== this.type ||
							!$from.sameParent($to) ||
							!diagramEngine($from.parent.attrs.language)
						)
							return null;
						if (
							after.selection.from >= $from.start() &&
							after.selection.to <= $from.end()
						)
							return null;
						// Leaving source ends its edit group, just like entering via
						// the preview. A later document replacement must undo alone.
						return closeHistory(after.tr);
					},
				}),
			];
		},
		addAttributes() {
			return {
				...this.parent?.(),
				opening: fenceAttribute("opening"),
				closing: fenceAttribute("closing"),
			};
		},
		parseMarkdown(token, helpers) {
			const parse = getExtensionField<
				NonNullable<typeof CodeBlock.config.parseMarkdown>
			>(CodeBlock, "parseMarkdown", this);
			const parsed = parse.call(this, token, {
				...helpers,
				createTextNode(text, marks) {
					if (text !== token.text || marks?.length) throw new Error("Code body differs from its producing token.");
					return helpers.createTokenText(token);
				},
			});
			if (!parsed || Array.isArray(parsed)) return parsed ?? [];
			const lines = (token.raw ?? "").trimEnd().split(/\r?\n/);
			const opening = lines[0]?.match(/^(`{3,}|~{3,})/)?.[1];
			if (!opening) return parsed;
			const closing =
				lines.at(-1)?.match(/^\s*(`{3,}|~{3,})\s*$/)?.[1] ?? opening;
			return { ...parsed, attrs: { ...parsed.attrs, opening, closing } };
		},
		renderMarkdown(node, helpers, context) {
			if (!node.attrs?.opening && !diagramEngine(node.attrs?.language)) {
				const render = getExtensionField<
					NonNullable<typeof CodeBlock.config.renderMarkdown>
				>(CodeBlock, "renderMarkdown", this);
				return render.call(this, node, helpers, context);
			}
			const source = helpers.renderChildren(node.content ?? []);
			const saved = String(node.attrs?.opening ?? "```");
			let opening = /^(?:`{3,}|~{3,})$/.test(saved) ? saved : "```";
			const delimiter = opening.charAt(0);
			for (const line of source.split("\n")) {
				const closing = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)?.[1];
				if (closing?.[0] === delimiter && closing.length >= opening.length)
					opening = delimiter.repeat(closing.length + 1);
			}
			const savedClose = String(node.attrs?.closing ?? opening);
			const closing =
				savedClose[0] === delimiter &&
				savedClose.length >= opening.length &&
				/^(?:`{3,}|~{3,})$/.test(savedClose)
					? savedClose
					: opening;
			return `${opening}${node.attrs?.language ?? ""}\n${source}${source ? "\n" : ""}${closing}`;
		},
		addNodeView() {
			return (props) => {
				if (this.options.diagrams && diagramEngine(props.node.attrs.language))
					return diagramNodeView(props, host);
				return plainCodeNodeView(props);
			};
		},
		addKeyboardShortcuts() {
			const parent = this.parent?.() ?? {};
			return {
				...parent,
				"Mod-Enter": () =>
					this.options.diagrams
						? exitDiagramCode(this.editor)
						: (parent["Mod-Enter"]?.({ editor: this.editor }) ?? false),
				"Mod-a": () => {
					const { $from, $to } = this.editor.state.selection;
					if (
						!this.options.diagrams ||
						!diagramEngine($from.parent.attrs.language) ||
						!$from.sameParent($to)
					)
						return false;
					return this.editor.commands.setTextSelection({
						from: $from.start(),
						to: $from.end(),
					});
				},
				Enter: () => {
					const { $from, $to, empty } = this.editor.state.selection;
					const opening = $from.parent.textContent;
					const marker = opening.match(/^(`{3,}|~{3,})([^`~\r\n]*)$/);
					if (
						(empty ||
							($from.sameParent($to) &&
								$from.parentOffset === marker?.[1]?.length)) &&
						$from.parent.type.name === "paragraph" &&
						$to.parentOffset === opening.length &&
						marker
					) {
						const fence = marker[1];
						return this.editor
							.chain()
							.deleteRange({ from: $from.start(), to: $from.end() })
							.setCodeBlock({ language: marker[2]?.trim() || "" })
							.updateAttributes(this.name, { opening: fence, closing: fence })
							.run();
					}
					return parent.Enter?.({ editor: this.editor }) ?? false;
				},
			};
		},
	});
