import { markdownBlockStart } from "./markdown-grammar";
import { encodeHtmlEntities, type JSONContent } from "@tiptap/core";

export function readInlineMath(source: string, enableDollarMath = true) {
	const patterns = [
		{
			opening: "\\(",
			closing: "\\)",
			pattern: /^\\\(((?:\\[\s\S]|[^\\])*?)\\\)/,
		},
		{
			opening: "\\[",
			closing: "\\]",
			pattern: /^\\\[((?:\\[\s\S]|[^\\])*?)\\\]/,
		},
		// Keep dollar syntax while retaining the complete LaTeX source.
		{
			opening: "$",
			closing: "$",
			pattern: /^\$(?!\$)((?:\\[\s\S]|[^$\\])+)\$(?!\$)/,
		},
	];
	for (const { opening, closing, pattern } of patterns) {
		if (opening === "$" && !enableDollarMath) continue;
		const match = pattern.exec(source);
		if (match)
			return { raw: match[0], latex: match[1] ?? "", opening, closing };
	}
	return null;
}

export function mathBlockOpening(line: string) {
	if (/^ {0,3}\$\$[ \t]*$/.test(line))
		return { closing: "$$", pattern: /^ {0,3}\$\$[ \t]*$/ };
	if (/^ {0,3}\\\[[ \t]*$/.test(line))
		return { closing: "\\]", pattern: /^ {0,3}\\\][ \t]*$/ };
	const fence = /^ {0,3}(`{3,}|~{3,})[ \t]*math[ \t]*$/i.exec(line)?.[1];
	return fence
		? {
				closing: fence,
				pattern: new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`),
			}
		: null;
}

export function readMathBlock(source: string) {
	const opening = source.split("\n", 1)[0] ?? "";
	const compact = /^ {0,3}\$\$(?!\$)(.+?)\$\$[ \t]*$/.exec(opening);
	if (compact)
		return {
			raw: opening,
			latex: compact[1] ?? "",
			opening: "$$",
			closing: "$$",
			compact: true,
		};
	const delimiter = mathBlockOpening(opening);
	if (!delimiter) return null;
	const lines = source.split("\n");
	const end = lines.findIndex(
		(line, index) => index > 0 && delimiter.pattern.test(line),
	);
	if (end < 0) return null;
	return {
		raw: lines.slice(0, end + 1).join("\n"),
		latex: lines.slice(1, end).join("\n"),
		opening,
		closing: lines[end] ?? delimiter.closing,
		compact: false,
	};
}

export function renderInlineMath(
	node: JSONContent,
	enableDollarMath = true,
): string {
	const latex = node.attrs?.latex ?? "";
	for (const opening of [node.attrs?.opening, "$", "\\(", "\\["]) {
		if (opening === "$" && !enableDollarMath) continue;
		if (!["$", "\\(", "\\["].includes(opening)) continue;
		const closing = opening === "\\(" ? "\\)" : opening === "\\[" ? "\\]" : "$";
		const source = `${opening}${latex}${closing}`;
		if (readInlineMath(source)?.raw === source && !readMathBlock(source))
			return source;
	}
	// Malformed input can contain every closing delimiter. Official node HTML
	// preserves that input without inventing another math syntax or truncating it.
	return `<span data-type="inline-math" data-latex="${encodeHtmlEntities(latex).replaceAll('"', "&quot;")}"></span>`;
}

export function renderBlockMath(node: JSONContent): string {
	const latex: string = node.attrs?.latex ?? "";
	let opening: string = node.attrs?.opening ?? "$$";
	if (!mathBlockOpening(opening)) opening = "$$";
	const delimiter = mathBlockOpening(opening);
	let closing: string = delimiter?.pattern.test(node.attrs?.closing ?? "")
		? node.attrs?.closing
		: (delimiter?.closing ?? "$$");
	if (
		node.attrs?.compact &&
		opening === "$$" &&
		!latex.includes("\n") &&
		!latex.includes("$$") &&
		latex
	)
		return `${opening}${latex}${closing}`;
	// A source line equal to the closing delimiter must not truncate the formula.
	if (
		latex
			.split("\n")
			.some((line) => mathBlockOpening(opening)?.pattern.test(line))
	) {
		const length = Math.max(
			3,
			...[...latex.matchAll(/`+/g)].map((match) => match[0].length + 1),
		);
		closing = "`".repeat(length);
		opening = `${closing}math`;
	}
	return `${opening}\n${latex}\n${closing}`;
}

export function mathBlockStart(source: string): number {
	return markdownBlockStart(source,
		/\n(?= {0,3}(?:\$\$|\\\[|`{3,}[ \t]*math\b|~{3,}[ \t]*math\b))/i, 1,
	);
}
