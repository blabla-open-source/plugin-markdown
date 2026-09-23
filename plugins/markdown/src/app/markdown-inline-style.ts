import type { JSONContent } from "@tiptap/core";

const properties = {
	color: "color",
	backgroundColor: "background-color",
	fontFamily: "font-family",
	fontSize: "font-size",
} as const;
export type InlineStyleProperty = keyof typeof properties;
type StyleValues = Record<string, unknown>;

/** One declaration value, not a CSS rule or an external resource. */
export function normalizeInlineStyle(
	property: InlineStyleProperty,
	value: unknown,
): string | null {
	if (typeof value !== "string" || /[<>;&]|\b(?:url|var|env)\s*\(/i.test(value))
		return null;
	if (property !== "fontFamily" && /["']/.test(value)) return null;
	const style = document.createElement("span").style;
	style[property] = value.trim();
	return style[property] || null;
}

export type FontProperty = "fontFamily" | "fontSize";
type FontStyle = Record<FontProperty, string | null>;

function fontStyle(value: unknown): FontStyle[] {
	if (!value || typeof value !== "object") return [];
	const attrs = value as StyleValues;
	const font = {
		fontFamily: normalizeInlineStyle("fontFamily", attrs.fontFamily),
		fontSize: normalizeInlineStyle("fontSize", attrs.fontSize),
	};
	return font.fontFamily || font.fontSize ? [font] : [];
}

export function fontParents(attrs: StyleValues = {}): FontStyle[] {
	return Array.isArray(attrs.fontParents)
		? attrs.fontParents.flatMap(fontStyle)
		: [];
}

export function fontPropertyValue(
	attrs: StyleValues,
	property: FontProperty,
): string {
	return (
		[...fontParents(attrs), ...fontStyle(attrs)]
			.map((font) => font[property])
			.findLast(Boolean) ?? ""
	);
}

/** Keep CSS declaration order. Font-relative units need the real parent metrics. */
function inheritFonts(parent: StyleValues, child: StyleValues): StyleValues {
	const fonts = [parent, child].flatMap((attrs) => [
		...fontParents(attrs),
		...fontStyle(attrs),
	]);
	const leaf = fonts.pop();
	return {
		fontFamily: leaf?.fontFamily ?? null,
		fontSize: leaf?.fontSize ?? null,
		fontParents: fonts.length ? fonts : null,
	};
}

export function inheritInlineStyleValues(
	parent: StyleValues = {},
	child: StyleValues = {},
): StyleValues {
	const attrs: StyleValues = {};
	for (const key of ["color", "backgroundColor"] as const) {
		const outer = normalizeInlineStyle(key, parent[key]);
		const inner = normalizeInlineStyle(key, child[key]);
		let value = inner || outer;
		if (
			inner === "inherit" ||
			(key !== "backgroundColor" && inner === "unset") ||
			(key === "color" && inner === "currentcolor")
		)
			value = outer;
		attrs[key] = value;
	}
	return { ...attrs, ...inheritFonts(parent, child) };
}

export function readInlineStyles(
	element: HTMLElement,
	ancestors = false,
): StyleValues {
	const chain: HTMLElement[] = [element];
	if (ancestors) {
		for (
			let parent = element.parentElement;
			parent;
			parent = parent.parentElement
		)
			if (parent.tagName === "SPAN") chain.unshift(parent);
	}
	return chain.reduce<StyleValues>(
		(values, current) =>
			inheritInlineStyleValues(
				values,
				Object.fromEntries(
					(Object.keys(properties) as InlineStyleProperty[]).map((key) => [
						key,
						current.style[key],
					]),
				),
			),
		{},
	);
}

export function inheritInlineStyles(
	nodes: JSONContent[],
	parent: StyleValues,
	applyMarks: (node: JSONContent, marks: JSONContent["marks"]) => JSONContent = (node, marks) => ({...node, marks}),
): JSONContent[] {
	return nodes.map((node) => {
		const inner = node.marks?.find((mark) => mark.type === "textStyle");
		const attrs = inheritInlineStyleValues(parent, inner?.attrs);
		const marks = node.marks?.filter((mark) => mark.type !== "textStyle") ?? [];
		if (Object.values(attrs).some(Boolean))
			marks.unshift({ type: "textStyle", attrs });
		return applyMarks(node, marks);
	});
}

export function inlineStyleAttribute(property: InlineStyleProperty) {
	return {
		default: null,
		parseHTML: (element: HTMLElement) =>
			readInlineStyles(element, true)[property],
		renderHTML: (attrs: StyleValues) => {
			const value = normalizeInlineStyle(property, attrs[property]);
			return value ? { style: `${properties[property]}: ${value}` } : {};
		},
	};
}

export function inlineStyleDeclarations(attrs: StyleValues = {}): string {
	return (Object.keys(properties) as InlineStyleProperty[])
		.map((key) => {
			const value = normalizeInlineStyle(key, attrs[key]);
			return value ? `${properties[key]}: ${value}` : "";
		})
		.filter(Boolean)
		.join("; ");
}

export function serializeInlineStyles(attrs: StyleValues = {}): string {
	return inlineStyleDeclarations(attrs)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;");
}
