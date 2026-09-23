import { normalizeInlineStyle } from "./markdown-inline-style";

type TextTransformMode =
	| "none"
	| "capitalize"
	| "uppercase"
	| "lowercase"
	| "full-width";

type FontVariantMode = "normal" | "small-caps";

const fullWidthSentinel = "var(--blabla-full-width)";

const properties = {
	color: "color",
	backgroundColor: "background-color",
	fontFamily: "font-family",
	fontSize: "font-size",
	fontStyle: "font-style",
	fontVariant: "font-variant",
	fontWeight: "font-weight",
	letterSpacing: "letter-spacing",
	listStyleType: "list-style-type",
	lineHeight: "line-height",
	textAlign: "text-align",
	textIndent: "text-indent",
	textDecoration: "text-decoration",
	textTransform: "text-transform",
} as const;

function normalizePreviewStyle(key: keyof typeof properties, value: string) {
	if (
		key === "color" ||
		key === "backgroundColor" ||
		key === "fontFamily" ||
		key === "fontSize"
	)
		return normalizeInlineStyle(key, value);
	if (key === "textAlign")
		return /^(left|right|center|justify|start|end|match-parent|inherit|initial|unset|revert(?:-layer)?)$/.test(
			value,
		)
				? value
				: null;
	if (key === "fontVariant") return normalizeFontVariant(value);
	if (key === "textTransform")
		return normalizeTextTransform(value);
	return normalizeStaticTextStyle(key, value);
}

function normalizeFontVariant(value: string): FontVariantMode | null {
	const normalized = value.trim().toLowerCase();
	return /^(normal|small-caps)$/.test(normalized)
		? (normalized as FontVariantMode)
		: null;
}

function normalizeTextTransform(value: string): TextTransformMode | null {
	const normalized = value.trim().toLowerCase();
	return /^(none|capitalize|uppercase|lowercase|full-width)$/.test(normalized)
		? (normalized as TextTransformMode)
		: null;
}

function parseTextTransform(raw: string): TextTransformMode | null {
	const style = document.createElement("span").style;
	style.cssText = raw.replace(
		/(^|;)(\s*text-transform\s*:\s*)full-width(\s*(?:!important\s*)?)(?=;|$)/giu,
		`$1$2${fullWidthSentinel}$3`,
	);
	return style.textTransform === fullWidthSentinel
		? "full-width"
		: normalizeTextTransform(style.textTransform);
}

function collectTextTransforms(fragment: DocumentFragment) {
	const transforms = new Map<HTMLElement, TextTransformMode>();
	for (const element of fragment.querySelectorAll<HTMLElement>("[style]")) {
		const transform = parseTextTransform(element.getAttribute("style") ?? "");
		if (transform) transforms.set(element, transform);
	}
	return transforms;
}

function toFullWidth(value: string) {
	return value.replace(/[ !-~]/g, (character) =>
		character === " "
			? "　"
			: String.fromCharCode(character.charCodeAt(0) + 0xfee0),
	);
}

function applyFullWidthText(
	fragment: DocumentFragment,
	transforms: ReadonlyMap<HTMLElement, TextTransformMode>,
) {
	const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		for (let element = node.parentElement; element; element = element.parentElement) {
			const transform = transforms.get(element);
			if (!transform) continue;
			if (transform === "full-width" && node.nodeValue)
				node.nodeValue = toFullWidth(node.nodeValue);
			break;
		}
	}
}

function normalizeStaticTextStyle(
	key:
		| "fontStyle"
		| "fontWeight"
		| "letterSpacing"
		| "listStyleType"
		| "lineHeight"
		| "textIndent"
		| "textDecoration",
	value: string,
) {
	if (/[<>;&]|\b(?:url|var|env)\s*\(/i.test(value)) return null;
	const style = document.createElement("span").style;
	style[key] = value.trim();
	return style[key] || null;
}

/** Clean the detached preview only. Never change the source document. */
function filterElementStyle(
	element: HTMLElement,
	textTransform: TextTransformMode | undefined,
): boolean {
	const raw = element.getAttribute("style") ?? "";
	const source = document.createElement("span").style;
	source.cssText = raw;
	const accepted = document.createElement("span").style;
	const background = normalizeInlineStyle("backgroundColor", source.background);
	// Recognize the default longhands from a color-only background shorthand.
	if (background)
		accepted.setProperty(
			"background",
			background,
			source.getPropertyPriority("background"),
		);
	element.removeAttribute("style");
	for (const key of Object.keys(properties) as (keyof typeof properties)[]) {
		const property = properties[key];
		const value = normalizePreviewStyle(key, source[key]);
		if (!value) continue;
		// An image-only shorthand's implicit initial color is not authored color.
		if (
			key === "backgroundColor" &&
			value === "initial" &&
			source.background &&
			!background
		)
			continue;
		const priority = source.getPropertyPriority(property);
		accepted.setProperty(property, value, priority);
		element.style.setProperty(property, value, priority);
	}
	const dimensionProperties =
		element instanceof HTMLImageElement
			? ["width", "height", "max-width", "max-height"]
			: element instanceof HTMLHRElement
				? ["width", "height"]
				: element instanceof HTMLTableElement
					? ["width"]
				: [];
	for (const property of dimensionProperties) {
		const value = source.getPropertyValue(property);
		if (!/^(?:auto|\d{1,5}(?:\.\d+)?(?:px|%))$/.test(value)) continue;
		const priority = source.getPropertyPriority(property);
		accepted.setProperty(property, value, priority);
		element.style.setProperty(property, value, priority);
	}
	if (element instanceof HTMLTableElement) {
		const borderCollapse = source.borderCollapse;
		if (/^(?:collapse|separate)$/.test(borderCollapse)) {
			const priority = source.getPropertyPriority("border-collapse");
			accepted.setProperty("border-collapse", borderCollapse, priority);
			element.style.setProperty("border-collapse", borderCollapse, priority);
		}
	}
	return (
		(Boolean(raw.trim()) &&
			source.length === 0 &&
			textTransform !== "full-width") ||
		Array.from(source).some(
			(property) =>
				source.getPropertyValue(property) !==
					accepted.getPropertyValue(property) ||
				source.getPropertyPriority(property) !==
					accepted.getPropertyPriority(property),
		)
	);
}

export function filterHtmlBlockStyles(fragment: DocumentFragment): boolean {
	let filtered = false;
	const transforms = collectTextTransforms(fragment);
	for (const element of fragment.querySelectorAll<HTMLElement>("[style]")) {
		if (filterElementStyle(element, transforms.get(element))) filtered = true;
	}
	applyFullWidthText(fragment, transforms);
	return filtered;
}
