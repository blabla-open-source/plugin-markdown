import createDOMPurify from "dompurify";
import { captureHtmlBlockIframe } from "./markdown-html-block-iframes";
import { HTML_CONTAINER_TAGS } from "./markdown-html-block-source";
import { filterHtmlBlockStyles } from "./markdown-html-block-style";
import { captureImageSources } from "./markdown-image-resources";
import { captureMediaSource } from "./markdown-media-resources";
import { captureSvgImageSource } from "./markdown-svg-image-resources";

const svgTags = new Set([
	"svg",
	"title",
	"desc",
	"g",
	"rect",
	"circle",
	"ellipse",
	"line",
	"polyline",
	"polygon",
	"path",
	"text",
	"tspan",
	"image",
]);
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const tags = [
	"audio",
	"video",
	"source",
	"track",
	"img",
	"map",
	"area",
	"iframe",
	...svgTags,
	...HTML_CONTAINER_TAGS,
	..."body details summary center left right bdo bdi dialog form fieldset legend label input select datalist optgroup option textarea output object applet menu p span strong b em i s strike del u sup sub mark kbd code tt font button pre br wbr hr blockquote ul ol li dl dt dd table caption thead tbody tfoot tr th td h1 h2 h3 h4 h5 h6 ruby rt rp a abbr acronym cite q dfn data time var samp ins progress meter small big figcaption".split(
		" ",
	),
];

// Names belong to the rendered preview, not the browser's named properties.
const anchorTargets = new WeakMap<HTMLAnchorElement, string[]>();
const fontAttributes = new Set(["color", "face", "size"]);
const buttonAttributes = new Set(["disabled", "name", "type", "value"]);
const inputAttributes = new Set([
	"autocomplete",
	"checked",
	"disabled",
	"max",
	"maxlength",
	"min",
	"minlength",
	"multiple",
	"name",
	"pattern",
	"placeholder",
	"readonly",
	"required",
	"step",
	"type",
	"value",
]);
const selectAttributes = new Set([
	"autocomplete",
	"disabled",
	"multiple",
	"name",
	"required",
	"size",
]);
const optionAttributes = new Set(["disabled", "label", "selected", "value"]);
const optgroupAttributes = new Set(["disabled", "label"]);
const textareaAttributes = new Set([
	"autocomplete",
	"cols",
	"disabled",
	"maxlength",
	"minlength",
	"name",
	"placeholder",
	"readonly",
	"required",
	"rows",
	"wrap",
]);
const mediaAttributes = new Set([
	"controls",
	"controlslist",
	"loop",
	"muted",
	"crossorigin",
	"disableremoteplayback",
]);
const videoAttributes = new Set(["playsinline", "disablepictureinpicture"]);
const trackAttributes = new Set(["kind", "srclang", "label", "default"]);
const progressAttributes = new Set(["value", "max"]);
const meterAttributes = new Set([
	"value",
	"min",
	"max",
	"low",
	"high",
	"optimum",
]);
const svgPresentationAttributes = new Set([
	"fill",
	"fill-opacity",
	"fill-rule",
	"opacity",
	"stroke",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-opacity",
	"stroke-width",
]);
const svgElementAttributes = new Map<string, Set<string>>([
	["svg", new Set(["aria-label", "preserveaspectratio", "role", "viewbox"])],
	["g", new Set(["transform"])],
	["rect", new Set(["x", "y", "rx", "ry"])],
	["circle", new Set(["cx", "cy", "r"])],
	["ellipse", new Set(["cx", "cy", "rx", "ry"])],
	["line", new Set(["x1", "y1", "x2", "y2"])],
	["polyline", new Set(["points"])],
	["polygon", new Set(["points"])],
	["path", new Set(["d"])],
	[
		"text",
		new Set([
			"dominant-baseline",
			"dx",
			"dy",
			"font-family",
			"font-size",
			"font-style",
			"font-weight",
			"lengthadjust",
			"text-anchor",
			"textlength",
			"x",
			"y",
		]),
	],
	[
		"tspan",
		new Set([
			"dx",
			"dy",
			"font-family",
			"font-size",
			"font-style",
			"font-weight",
			"x",
			"y",
		]),
	],
	["image", new Set(["preserveaspectratio", "x", "y"])],
]);
let purifier: ReturnType<typeof createDOMPurify> | undefined;

function isAllowedSvgAttribute(attribute: string, tag: string): boolean {
	if (!svgTags.has(tag)) return false;
	return (
		svgPresentationAttributes.has(attribute) ||
		svgElementAttributes.get(tag)?.has(attribute) === true
	);
}

function createPreviewPurifier() {
	const instance = createDOMPurify();
	instance.addHook("beforeSanitizeAttributes", (element) => {
		captureHtmlBlockIframe(element);
		captureMediaSource(element);
		captureImageSources(element);
		captureSvgImageSource(element);
		if (!(element instanceof HTMLAnchorElement)) return;
		const targets = [
			element.getAttribute("id"),
			element.getAttribute("name"),
		].filter((value): value is string => Boolean(value));
		if (!targets.length) return;
		anchorTargets.set(element, targets);
		element.removeAttribute("id");
		element.removeAttribute("name");
	});
	return instance;
}

export function renderHtmlBlockPreview(source: string) {
	purifier ??= createPreviewPurifier();
	const fragment = purifier.sanitize(source, {
		ALLOWED_TAGS: tags,
		ADD_ATTR: (attribute, tag) =>
			isAllowedSvgAttribute(attribute, tag) ||
			((tag === "ol" || tag === "ul") && attribute === "type") ||
			(tag === "img" && (attribute === "sizes" || attribute === "usemap")) ||
			(tag === "map" && attribute === "name") ||
			(tag === "area" && (attribute === "coords" || attribute === "shape")) ||
			(tag === "fieldset" && attribute === "disabled") ||
			(tag === "iframe" && attribute === "sandbox") ||
			(tag === "font" && fontAttributes.has(attribute)) ||
			(tag === "button" && buttonAttributes.has(attribute)) ||
			(tag === "input" && inputAttributes.has(attribute)) ||
			(tag === "select" && selectAttributes.has(attribute)) ||
			(tag === "option" && optionAttributes.has(attribute)) ||
			(tag === "optgroup" && optgroupAttributes.has(attribute)) ||
			(tag === "textarea" && textareaAttributes.has(attribute)) ||
			((tag === "audio" || tag === "video") &&
				mediaAttributes.has(attribute)) ||
			(tag === "video" && videoAttributes.has(attribute)) ||
			(tag === "track" && trackAttributes.has(attribute)) ||
			(tag === "source" && (attribute === "type" || attribute === "media")) ||
			((tag === "q" || tag === "ins") && attribute === "cite") ||
			((tag === "time" || tag === "ins") && attribute === "datetime") ||
			((tag === "data" || tag === "li") && attribute === "value") ||
			(tag === "progress" && progressAttributes.has(attribute)) ||
			(tag === "meter" && meterAttributes.has(attribute)),
		ALLOWED_ATTR: [
			"alt",
			"width",
			"height",
			"href",
			"open",
			"colspan",
			"rowspan",
			"start",
			"reversed",
			"dir",
			"lang",
			"title",
			"style",
		],
		ALLOW_DATA_ATTR: false,
		ALLOW_ARIA_ATTR: false,
		RETURN_DOM_FRAGMENT: true,
	});
	let htmlTitleFiltered = false;
	for (const title of fragment.querySelectorAll("title")) {
		if (title.namespaceURI === SVG_NAMESPACE) continue;
		title.remove();
		htmlTitleFiltered = true;
	}
	const stylesFiltered = filterHtmlBlockStyles(fragment);
	return {
		fragment,
		filtered: purifier.removed.length > 0 || htmlTitleFiltered || stylesFiltered,
	};
}

export function findHtmlBlockAnchor(
	root: globalThis.Node | null,
	target: string,
) {
	if (!(root instanceof HTMLElement)) return null;
	for (const element of root.querySelectorAll<HTMLAnchorElement>("a")) {
		if (anchorTargets.get(element)?.includes(target)) return element;
	}
	return null;
}

export function focusHtmlBlockAnchor(element: HTMLAnchorElement) {
	for (
		let ancestor = element.parentElement;
		ancestor;
		ancestor = ancestor.parentElement
	) {
		if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
	}
	element.tabIndex = -1;
	element.focus({ preventScroll: true });
	element.scrollIntoView({ behavior: "instant", block: "center" });
}
