import type {
  HostSettingsField,
  HostSettingsState,
} from "../host/host-settings-dialog";
import type { CodeCreationPreferences } from "./markdown-code-creation";
import type { CodeEditingPreferences } from "./markdown-code-editing";
import type { MarkdownPreferences } from "./markdown-preferences";
import type { ProseCreationPreferences } from "./markdown-prose-style";
import type { useToolCopy } from "./markdown-tool-copy";
export interface MarkdownPreferencesDialogProps {
  alerts: boolean;
  autoLink: boolean;
  codeCreation: CodeCreationPreferences & CodeEditingPreferences;
  diagrams: boolean;
  emojiAutoComplete: boolean;
  error?: string;
  expandSimpleBlock: boolean;
  highlight: boolean;
  inlineMath: boolean;
  needsReload: boolean;
  onApply: (beforeReload: () => Promise<void>) => Promise<void>;
  onChange: (patch: Partial<MarkdownPreferences>) => Promise<boolean>;
  proseCreation: ProseCreationPreferences;
  saving: boolean;
  sequenceTheme: MarkdownPreferences["sequenceTheme"];
  strictMode: boolean;
  subscript: boolean;
  superscript: boolean;
}
export function preferencesDialogState(
  p: MarkdownPreferencesDialogProps,
  translate: ReturnType<typeof useToolCopy>
): HostSettingsState {
  const t = (text: string) =>
    translate(text as Parameters<typeof translate>[0]);
  const toggle = (
    id: string,
    label: string,
    value: boolean
  ): HostSettingsField => ({ id, label: t(label), type: "checkbox", value });
  const select = (
    id: string,
    label: string,
    value: string,
    options: readonly (readonly [string, string])[]
  ): HostSettingsField => ({
    id,
    label: t(label),
    type: "select",
    value,
    options: options.map(([value, label]) => ({
      value,
      label: t(label) ?? label,
    })),
  });
  const last = p.codeCreation.codeDefaultLanguage === "__LAST";
  return {
    title: t("Markdown preferences"),
    description: t(
      "Applies to Markdown views. Does not change document content."
    ),
    doneLabel: t("Done"),
    busy: p.saving,
    error: p.error ? t(p.error) : undefined,
    sections: [
      {
        id: "editing",
        title: t("Editing"),
        fields: [
          toggle(
            "expandSimpleBlock",
            "Show block markers while editing",
            p.expandSimpleBlock
          ),
          toggle(
            "emojiAutoComplete",
            "Suggest emoji while typing",
            p.emojiAutoComplete
          ),
        ],
      },
      {
        id: "format",
        title: t("Source format"),
        description: t(
          "Used by formatting commands. Typed markers and existing source keep their style. Setext applies to headings 1 and 2 outside lists."
        ),
        fields: [
          ...(
            [
              [
                "headingStyle",
                "New heading style",
                [
                  ["atx", "# Heading"],
                  ["setext", "Setext (===)"],
                  ["closed-atx", "# Heading #"],
                  ["wide-setext", "Setext matched to text width"],
                ],
              ],
              [
                "bulletMarker",
                "New bullet marker",
                [
                  ["-", "-"],
                  ["+", "+"],
                  ["*", "*"],
                ],
              ],
              [
                "orderedMarker",
                "New list numbering",
                [
                  ["increment", "1. 2. 3."],
                  ["fixed", "1. 1. 1."],
                ],
              ],
              [
                "proseIndent",
                "List and quote indentation",
                [
                  ["auto", "Automatic"],
                  ["2", "2 spaces"],
                  ["3", "3 spaces"],
                  ["4", "4 spaces"],
                  ["5", "5 spaces"],
                  ["tab", "Tab"],
                ],
              ],
            ] as const
          ).map(([id, label, options]) =>
            select(id, label, p.proseCreation[id], options)
          ),
          toggle(
            "proseAlign",
            "Align text after list and quote markers",
            p.proseCreation.proseAlign
          ),
        ],
      },
      {
        id: "code",
        title: t("Code blocks"),
        description: t(
          "Wrapping and indentation also apply to block formula and HTML source. Line numbers also apply to block formulas."
        ),
        fields: [
          select(
            "codeIndentSize",
            "Code indentation",
            String(p.codeCreation.codeIndentSize),
            [2, 3, 4, 5].map((n) => [String(n), `${n} ${t("columns")}`])
          ),
          ...(
            [
              ["codePairing", "Pair brackets and quotes in code"],
              ["codeLineNumbers", "Show code line numbers"],
              ["codeLineWrapping", "Wrap code lines"],
              ["codeSmartIndent", "Reindent code with Shift+Tab"],
            ] as const
          ).map(([id, label]) => toggle(id, label, p.codeCreation[id])),
          {
            id: "codeDefaultLanguage",
            type: "text",
            label: t("Default code language"),
            value: last ? "" : p.codeCreation.codeDefaultLanguage,
            placeholder: t("Plain text"),
            disabled: last,
          },
          toggle("lastLanguage", "Use last used language", last),
          select(
            "codeDefaultFor",
            "Apply default language when",
            p.codeCreation.codeDefaultFor,
            [
              ["fences", "Typing a code fence"],
              ["commands", "Using a command"],
              ["both", "Either"],
            ]
          ),
        ],
      },
      {
        id: "rendering",
        title: t("Rendering"),
        fields: [
          toggle("inlineMath", "Render $…$ as inline math", p.inlineMath),
          ...(
            [
              ["autoLink", "Automatically recognize links"],
              ["strictMode", "Strict Markdown syntax"],
              ["alerts", "Render GitHub alerts"],
              ["diagrams", "Render diagrams"],
              ["highlight", "Render ==…== as highlight"],
              ["subscript", "Render ~…~ as subscript"],
              ["superscript", "Render ^…^ as superscript"],
            ] as const
          ).map(([id, label]) => toggle(id, label, p[id])),
          select("sequenceTheme", "Sequence style", p.sequenceTheme, [
            ["simple", "Simple"],
            ["hand", "Hand drawn"],
          ]),
        ],
      },
    ],
    apply: p.needsReload
      ? {
          label: t("Apply to document"),
          description: t(
            "Reloads this document after saving. Undo history will reset."
          ),
        }
      : undefined,
  };
}

const invalidLanguage = /[\r\n`~]/;
export function preferencesDialogPatch(p: MarkdownPreferencesDialogProps, t: ReturnType<typeof useToolCopy>, action: Extract<import("../host/host-settings-dialog").HostSettingsAction, {type: "change"}>): Partial<MarkdownPreferences> | null {
 const field = preferencesDialogState(p, t).sections.flatMap(section => section.fields).find(field => field.id === action.id);
 if (!field || field.disabled) return null;
 if (field.type === "checkbox" && typeof action.value !== "boolean") return null;
 if (field.type === "select" && !field.options.some(option => option.value === action.value)) return null;
 if (field.type === "text" && typeof action.value !== "string") return null;
 if (action.id === "lastLanguage") return {codeDefaultLanguage: action.value ? "__LAST" : ""};
 if (action.id === "codeIndentSize") return {codeIndentSize: Number(action.value)};
 if (action.id === "codeDefaultLanguage") {
  const value = String(action.value).trim();
  if (invalidLanguage.test(value) || value === "__LAST") throw new Error("Enter a language without backticks or tildes.");
  return {codeDefaultLanguage: value};
 }
 return {[action.id]: action.value};
}
