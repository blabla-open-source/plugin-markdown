/** CommonMark code spans need a delimiter longer than any run in the text.
 * Padding prevents edge backticks joining the delimiter and preserves spaces.
 * Used only by the source projection; editor and Host state contain plain text.
 */
export function renderInlineCode(text: string): string {
	let longest = 0;
	for (const match of text.matchAll(/`+/g))
		longest = Math.max(longest, match[0].length);
	const delimiter = "`".repeat(longest + 1);
	const padding =
		/^`|`$/.test(text) || (/^ | $/.test(text) && !/^ +$/.test(text)) ? " " : "";
	return `${delimiter}${padding}${text}${padding}${delimiter}`;
}
