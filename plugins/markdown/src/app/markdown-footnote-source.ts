export const FOOTNOTE_DEFINITION =
	/^ {0,3}\[\^([^\]\r\n]+)\]:[\t ]*([^\r\n]*)(?:\r\n|\n|\r|$)/d;
export const FOOTNOTE_REFERENCE = /^\[\^([^\]\r\n]+)\]/;
export const FOOTNOTE_DEFINITION_START = /^ {0,3}\[\^([^\]\r\n]+)\]:/m;

export function isFootnoteLabel(label: string | undefined): label is string {
	return (
		typeof label === "string" &&
		label.trim().length > 0 &&
		!/[\]\r\n]/.test(label)
	);
}
