import { Underline } from "@tiptap/extension-underline";
import { readInlineHtml } from "./markdown-inline-html";

/** Write portable HTML while retaining the previously shipped ++ input reader. */
export const MarkdownUnderline = Underline.extend({
  renderMarkdown(node, helpers) {
    return `<u>${helpers.renderChildren(node)}</u>`;
  },
  markdownTokenizer: {
    name: "underline",
    level: "inline",
    start(source) {
      const starts = [source.search(/<u(?:\s|>)/i), source.indexOf("++")].filter(index => index >= 0);
      return starts.length ? Math.min(...starts) : -1;
    },
    tokenize(source, tokens, lexer) {
      const html = readInlineHtml(source, "u");
      if (html) return {type: "underline", raw: html.raw, tokens: lexer.inlineTokens(html.text)};
      return Underline.config.markdownTokenizer?.tokenize(source, tokens, lexer);
    },
  },
});
