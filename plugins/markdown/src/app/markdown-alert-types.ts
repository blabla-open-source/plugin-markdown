export const ALERT_TYPES = [
	"note",
	"tip",
	"important",
	"warning",
	"caution",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export function readAlertType(value: unknown): AlertType | null {
	return ALERT_TYPES.find((type) => type === value) ?? null;
}

export function alertLabel(type: AlertType): string {
	return type.charAt(0).toUpperCase() + type.slice(1);
}

export const ALERT_ICON_PATHS: Record<AlertType, string> = {
	note: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 11v6M12 7v.1",
	tip: "M9 18h6M10 21h4M9 15c0-3-4-3-4-7a7 7 0 0 1 14 0c0 4-4 4-4 7",
	important: "M3 3h18v14h-9l-5 4v-4H3ZM12 6v5M12 14v.1",
	warning: "M12 3 22 21H2ZM12 9v5M12 18v.1",
	caution: "M8 2h8l6 6v8l-6 6H8l-6-6V8ZM12 7v6M12 17v.1",
};

/** Small monochrome icons inherit the same color as the alert header. */
export function alertIcon(type: AlertType): SVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("width", "18");
	svg.setAttribute("height", "18");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "1.8");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	svg.setAttribute("aria-hidden", "true");
	const path = document.createElementNS(svg.namespaceURI, "path");
	path.setAttribute("d", ALERT_ICON_PATHS[type]);
	svg.append(path);
	return svg;
}
