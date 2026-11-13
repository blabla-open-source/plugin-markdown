import type * as pele from "pele";

/** Runs inside the opaque frame; the editor receives only a self-contained image. */
export function startPeleSandbox() {
	const runtime = (window as unknown as { pele: typeof pele }).pele;
	// External SVG readers may not implement custom properties. Preview and
	// exports share these resolved presentation values, never a second render.
	function resolvePresentation(root: SVGSVGElement) {
		document.body.append(root);
		try {
			for (const element of [root, ...root.querySelectorAll<SVGElement>("*")]) {
				const computed = getComputedStyle(element);
				for (const attribute of [...element.attributes]) {
					if (attribute.name !== "style" && attribute.value.includes("var("))
						element.setAttribute(attribute.name, computed.getPropertyValue(attribute.name));
				}
				for (const property of [...element.style]) {
					if (!property.startsWith("--") && element.style.getPropertyValue(property).includes("var("))
						element.style.setProperty(property, computed.getPropertyValue(property));
				}
			}
		} finally {
			root.remove();
		}
	}
	window.addEventListener(
		"message",
		(event: MessageEvent) => {
			if (event.source !== parent || event.data !== "diagram-connect") return;
			const port = event.ports[0];
			if (!port) return;
			port.onmessage = ({ data }) => {
				const { id, source, dark } = data;
				try {
					const { svg } = runtime.render(source, {
						fontFamily: "Arial, sans-serif",
						limit: 50_000,
						maxEdges: 500,
						links: false,
						images: false,
					});
					const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
					const root = parsed.querySelector("svg");
					if (!root || parsed.querySelector("parsererror"))
						throw new Error("The renderer returned no valid SVG image.");
					// Blob images and exported files cannot inherit the editor's CSS.
					const colors = {
						bg: ["#ffffff", "#1e1e1e"],
						fg: ["#24292f", "#e5e7eb"],
						muted: ["#57606a", "#9ca3af"],
						line: ["#57606a", "#d1d5db"],
						surface: ["#f6f8fa", "#292d34"],
						"surface-alt": ["#eaeef2", "#363c46"],
						border: ["#8c959f", "#9ca3af"],
						accent: ["#0969da", "#8ab4f8"],
						critical: ["#cf222e", "#f28b82"],
						"series-1": ["#0969da", "#8ab4f8"],
						"series-2": ["#9a6700", "#fdd663"],
						"series-3": ["#1a7f37", "#81c995"],
						"series-4": ["#cf222e", "#f28b82"],
						"series-5": ["#0f766e", "#78d9d2"],
						"series-6": ["#8250df", "#c58af9"],
						"series-7": ["#bf3989", "#f6aea9"],
						"series-8": ["#57606a", "#a8c7fa"],
					} as const;
					for (const [name, pair] of Object.entries(colors))
						root.style.setProperty(`--pele-${name}`, pair[dark ? 1 : 0]);
					resolvePresentation(root);
					port.postMessage({
						id,
						svg: new XMLSerializer().serializeToString(root),
					});
				} catch (error) {
					port.postMessage({
						id,
						error: error instanceof Error ? error.message : "Unable to render this diagram.",
					});
				}
			};
			port.postMessage({ ready: true });
		},
		{ once: true },
	);
}
