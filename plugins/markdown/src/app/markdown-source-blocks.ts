export interface MarkdownSourceBlock {
	end: number;
	start: number;
	synthetic?: boolean;
}

/** The boundary before block i; the last entry is the document suffix.
 * Offsets are UTF-16 source offsets, never ProseMirror positions or file bytes.
 * Non-rendered syntax stays opaque and must not be consumed as whitespace.
 */
export interface MarkdownSourceGap {
  start: number;
  end: number;
  kind: "whitespace" | "syntax";
}

export function collectMarkdownSourceGaps(markdown: string, blocks: readonly MarkdownSourceBlock[]): MarkdownSourceGap[] {
  return Array.from({ length: blocks.length + 1 }, (_, index) => {
    const start = blocks[index - 1]?.end ?? 0;
    const end = blocks[index]?.start ?? markdown.length;
    return { start, end, kind: /^[\t \r\n]*$/.test(markdown.slice(start, end)) ? "whitespace" : "syntax" };
  });
}

export const MARKDOWN_LINE_BREAK_GLOBAL_PATTERN = /\r\n|\n|\r/gu;
export const MARKDOWN_LINE_BREAK_PATTERN = /\r\n|\n|\r/u;
