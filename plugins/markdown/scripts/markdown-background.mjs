const WINDOWS_LINE_ENDING_PATTERN = /\r\n?/g;
const XML_ESCAPE_PATTERN = /[&<>"]/gu;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/gu;
const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/gu;
const PREVIEW_SOURCE_MAX_LINES = 64;
const SEMANTIC_BODY_MAX_LINES = 42;
const TITLE_MAX_LINES = 2;
const BODY_MAX_LINES_MIN = 24;
const BODY_MAX_LINES_MAX = 38;
const COVER_MIN_WIDTH = 202, COVER_MAX_WIDTH = 244;
const COVER_HEIGHT_RATIO = Math.SQRT2;
const PAGE_INSET_X = 4, PAGE_INSET_Y = PAGE_INSET_X * COVER_HEIGHT_RATIO;
const COVER_PADDING_X = 17;
const COVER_PADDING_TOP = 16;
const COVER_PADDING_BOTTOM = 14;
const COVER_TITLE_GAP = 6;
const TITLE_FONT_SIZE = 8.4, TITLE_LINE_HEIGHT = 10.8, TITLE_CHAR_WIDTH = 4.3;
const BODY_FONT_SIZE = 5.4, BODY_LINE_HEIGHT = 7.1, BODY_CHAR_WIDTH = 3.25;
const BODY_MIN_UNITS = 46, BODY_MAX_UNITS = 60;
export function handleRequest(method, params) {
	if (method !== "derivative.render") {
		throw new Error(`Unknown Markdown background method: ${method}`);
	}
	return renderDerivative(params);
}
function renderDerivative(params) {
	if (params?.providerId !== "markdown-cover") {
		throw new Error("Unknown Markdown derivative provider.");
	}
	if (params?.input?.kind !== "sourceText") {
		throw new Error("Markdown derivative provider requires sourceText input.");
	}
	const sourceText = String(params.input.text ?? "");
	const assetName = assetFileName(params.asset?.name);
	const model = markdownCoverModel(sourceText, assetName);
	const previewLayout = coverLayout(model, true);
	const layout = params.role === "preview" ? previewLayout : thumbnailLayout(model, previewLayout);
	const svg = derivativeSvg(layout);
	return {
		bytesBase64: Buffer.from(svg, "utf8").toString("base64"),
		height: layout.height,
		mime: "image/svg+xml",
		width: layout.width,
	};
}
function markdownCoverModel(sourceText, assetName) {
	const lines = sourceTextPreviewLines(sourceText);
	const heading = firstHeading(lines);
	const title = heading?.text || fileTitle(assetName);
	const bodyLines = [];
	const openingLines = [];
	for (let index = 0; index < lines.length; index += 1) {
		const normalized = normalizeRawMarkdownLine(lines[index]);
		openingLines.push(normalized);
		if (index === heading?.index) {
			continue;
		}
		bodyLines.push(normalized);
		if (bodyLines.length >= SEMANTIC_BODY_MAX_LINES) {
			break;
		}
	}
	return {
		bodyLines,
		openingLines,
		title,
		totalUnits: estimatedLineUnits(title) + bodyLines.reduce((sum, line) => sum + estimatedLineUnits(line), 0),
	};
}
function coverLayout(model, showTitle) {
	let bodyUnits = coverBodyUnits(model);
	let layout = coverLayoutForBodyUnits(model, bodyUnits, showTitle);
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const fittedUnits = clamp(Math.floor((layout.width - (PAGE_INSET_X + COVER_PADDING_X) * 2) / BODY_CHAR_WIDTH), 1, bodyUnits);
		if (fittedUnits === bodyUnits) {
			break;
		}
		bodyUnits = fittedUnits;
		layout = coverLayoutForBodyUnits(model, bodyUnits, showTitle);
	}
	return layout;
}
function thumbnailLayout(model, previewLayout) {
	return {
		...coverLayoutForBodyUnits(model, previewLayout.bodyUnits, false),
		height: previewLayout.height,
		width: previewLayout.width,
	};
}
function coverLayoutForBodyUnits(model, bodyUnits, showTitle) {
	const contentWidth = bodyUnits * BODY_CHAR_WIDTH;
	const width = clamp(Math.round(contentWidth + (PAGE_INSET_X + COVER_PADDING_X) * 2), COVER_MIN_WIDTH, COVER_MAX_WIDTH);
	const height = Math.round(width * COVER_HEIGHT_RATIO);
	const titleUnits = Math.max(12, contentWidth / TITLE_CHAR_WIDTH);
	const titleLines = showTitle ? limitLines(wrapMeasuredLine(model.title, titleUnits), TITLE_MAX_LINES, titleUnits) : [];
	const bodySourceLines = coverBodySourceLines(model, showTitle);
	const bodyLinesAll = bodySourceLines.flatMap((line) => wrapMeasuredLine(line, bodyUnits));
	const titleHeight = showTitle ? titleLines.length * TITLE_LINE_HEIGHT + COVER_TITLE_GAP : 0;
	const availableBodyHeight = height - PAGE_INSET_Y * 2 - COVER_PADDING_TOP - COVER_PADDING_BOTTOM - titleHeight;
	const bodyMaxLines = Math.min(coverBodyMaxLines(model), Math.max(1, Math.floor(availableBodyHeight / BODY_LINE_HEIGHT)));
	const bodyLines = limitLines(bodyLinesAll, bodyMaxLines, bodyUnits);
	return {
		bodyLines,
		bodyUnits,
		height,
		showTitle,
		titleLines,
		width,
	};
}
function coverBodySourceLines(model, showTitle) {
	if (!showTitle && model.openingLines.length > 0) {
		return model.openingLines;
	}
	return model.bodyLines.length > 0 ? model.bodyLines : [model.title];
}
function coverBodyUnits(model) {
	const bodyLineUnits = [...model.openingLines, ...model.bodyLines]
		.map(estimatedLineUnits)
		.filter((units) => units >= 8);
	const baseUnits =
		bodyLineUnits.length > 0
			? percentile(bodyLineUnits, 0.68)
			: estimatedLineUnits(model.title) * 0.72;
	const volumeBonus = clamp(Math.round(Math.sqrt(model.totalUnits) / 7), 0, 10);
	const titleFloor = Math.ceil(
		(estimatedLineUnits(model.title) * TITLE_CHAR_WIDTH * 0.36) /
			BODY_CHAR_WIDTH,
	);
	return clamp(
		Math.round(Math.max(baseUnits + volumeBonus, titleFloor, BODY_MIN_UNITS)),
		BODY_MIN_UNITS,
		BODY_MAX_UNITS,
	);
}
function coverBodyMaxLines(model) {
	return clamp(
		Math.round(BODY_MAX_LINES_MIN + Math.sqrt(model.totalUnits) / 4),
		BODY_MAX_LINES_MIN,
		BODY_MAX_LINES_MAX,
	);
}
function derivativeSvg(layout) {
	const textX = PAGE_INSET_X + COVER_PADDING_X;
	const contentTop = PAGE_INSET_Y + COVER_PADDING_TOP;
	const titleText = layout.titleLines
		.map((line, index) => {
			const y = contentTop + TITLE_FONT_SIZE * 0.86 + index * TITLE_LINE_HEIGHT;
			return `<text class="page-title" x="${textX}" y="${y}" font-size="${TITLE_FONT_SIZE}" font-weight="620" xml:space="preserve">${escapeXml(line)}</text>`;
		})
		.join("\n");
	const bodyStartY = layout.showTitle ? contentTop + layout.titleLines.length * TITLE_LINE_HEIGHT + COVER_TITLE_GAP : contentTop;
	const bodyText = layout.bodyLines
		.map((line, index) => {
			const y = bodyStartY + BODY_FONT_SIZE * 0.82 + index * BODY_LINE_HEIGHT;
			return `<text class="page-body" x="${textX}" y="${y}" font-size="${BODY_FONT_SIZE}" font-weight="400" xml:space="preserve">${escapeXml(line)}</text>`;
		})
		.join("\n");
	const pageWidth = Math.max(1, layout.width - PAGE_INSET_X * 2 - 1), pageHeight = Math.max(1, layout.height - PAGE_INSET_Y * 2 - 1);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">
<style>
:root { color-scheme: light dark; }
.page { fill: #fbfbfd; stroke: #d8d8de; stroke-opacity: 0.9; }
.page-title { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; letter-spacing: 0; }
.page-body { font-family: 'SF Mono', 'Cascadia Code', 'Segoe UI Mono', Consolas, Menlo, monospace; letter-spacing: 0; }
.page-title { fill: #1d1d1f; }
.page-body { fill: #6e6e73; }
@media (prefers-color-scheme: dark) { .page { fill: #252528; stroke: #4a4a4f; } .page-title { fill: #f5f5f7; } .page-body { fill: #b8b8be; } }
</style>
<rect class="page" x="${PAGE_INSET_X + 0.5}" y="${PAGE_INSET_Y + 0.5}" width="${pageWidth}" height="${pageHeight}" rx="2.5"/>
${titleText}
${bodyText}
</svg>`;
}
function sourceTextPreviewLines(sourceText) {
	return String(sourceText ?? "")
		.replace(WINDOWS_LINE_ENDING_PATTERN, "\n")
		.split("\n")
		.slice(0, PREVIEW_SOURCE_MAX_LINES);
}
function firstHeading(lines) {
	for (let index = 0; index < Math.min(lines.length, 12); index += 1) {
		const match = /^#{1,6}\s+(.+)$/u.exec(String(lines[index] ?? "").trim());
		if (!match?.[1]) {
			continue;
		}
		return {
			index,
			text: stripMarkdownInline(match[1]).trim(),
		};
	}
	return null;
}
function normalizeRawMarkdownLine(line) {
	return String(line ?? "").replace(/\t/gu, "    ").replace(/\s+$/u, "");
}
function stripMarkdownInline(value) {
	return String(value ?? "")
		.replace(MARKDOWN_IMAGE_PATTERN, (_match, alt) => alt || "image")
		.replace(MARKDOWN_LINK_PATTERN, "$1")
		.replace(/[*_~`]+/gu, "")
		.trim();
}
function limitLines(lines, maxLines, maxLineUnits) {
	if (lines.length <= maxLines) {
		return lines;
	}
	const limited = lines.slice(0, maxLines);
	limited[limited.length - 1] = ellipsizeLine(
		limited[limited.length - 1] ?? "",
		maxLineUnits,
	);
	return limited;
}
function ellipsizeLine(line, maxLineUnits) {
	const suffix = "...";
	const suffixUnits = estimatedLineUnits(suffix);
	let next = "";
	let units = 0;
	for (const character of String(line ?? "")) {
		const charUnits = estimatedCharacterUnits(character);
		if (units + charUnits + suffixUnits > maxLineUnits) {
			break;
		}
		next += character;
		units += charUnits;
	}
	return `${next.trimEnd()}${suffix}`;
}
function wrapMeasuredLine(line, maxLineUnits) {
	if (line === "") {
		return [""];
	}
	const chunks = [];
	let chunk = "";
	let chunkUnits = 0;
	for (const character of line) {
		const nextUnits = estimatedCharacterUnits(character);
		if (chunk && chunkUnits + nextUnits > maxLineUnits) {
			chunks.push(chunk);
			chunk = character;
			chunkUnits = nextUnits;
			continue;
		}
		chunk += character;
		chunkUnits += nextUnits;
	}
	if (chunk) {
		chunks.push(chunk);
	}
	return chunks;
}
function estimatedLineUnits(line) {
	let units = 0;
	for (const character of String(line ?? "")) {
		units += estimatedCharacterUnits(character);
	}
	return units;
}
function estimatedCharacterUnits(character) {
	if (character === "\t") {
		return 4;
	}
	return (character.codePointAt(0) ?? 0) < 128 ? 1 : 1.65;
}
function percentile(values, ratio) {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.round((sorted.length - 1) * ratio)),
	);
	return sorted[index] ?? 0;
}
function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max);
}
function assetFileName(name) {
	const value = String(name ?? "").trim();
	return value || "Untitled.md";
}
function fileTitle(name) {
	const basename = assetFileName(name).replace(/\\/gu, "/").split("/").pop();
	return String(basename ?? "Untitled").replace(/\.[^.]+$/u, "") || "Untitled";
}
function escapeXml(value) {
	return String(value ?? "").replace(
		XML_ESCAPE_PATTERN,
		(character) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
			})[character],
	);
}
