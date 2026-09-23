/** Serialized into the opaque frame; upstream 2.0.1's Raphael theme is synchronous. */
export function startSequenceSandbox() {
	type Parsed = { actors: unknown[]; signals: unknown[] };
	type Font = { obj_?: { glyphs: Record<string, unknown> } };
	type Drawing = {
		draw: (container: HTMLElement) => void;
		textBBox: (text: string, font: Font) => unknown;
		drawText: (
			x: number,
			y: number,
			text: string,
			font: Font,
			align: string,
		) => unknown;
		paper_?: { remove: () => void };
	};
	type Theme = new (
		diagram: Parsed,
		options: object,
		resume: (drawing: Drawing) => void,
	) => Drawing;
	const runtime = (
		window as unknown as {
			Diagram: {
				parse: (source: string) => Parsed;
				themes: {
					raphaelSimple: Theme;
					raphaelHand: Theme;
				};
			};
		}
	).Diagram;
	window.addEventListener(
		"message",
		(event: MessageEvent) => {
			if (event.source !== parent || event.data !== "diagram-connect") return;
			const port = event.ports[0];
			if (!port) return;
			port.onmessage = ({ data }) => {
				const { id, source, dark, sequenceTheme } = data;
				const container = document.createElement("div");
				document.body.append(container);
				let drawing: Drawing | undefined;
				try {
					if (source.length > 50_000)
						throw new Error("Diagram source exceeds 50,000 characters.");
					const diagram = runtime.parse(source.replace(/\r/g, ""));
					if (diagram.actors.length + diagram.signals.length > 500)
						throw new Error(
							"Diagram exceeds 500 participants, messages and notes.",
						);
					// drawSVG hides the paper. Keep its theme instance so finally can release Raphael registrations.
					const Theme =
						sequenceTheme === "hand"
							? runtime.themes.raphaelHand
							: runtime.themes.raphaelSimple;
					new Theme(
						diagram,
						sequenceTheme === "hand" ? { "font-family": "Arial, sans-serif" } : {},
						(theme) => {
							drawing = theme;
							// Cufon paths silently omit unsupported glyphs. Use SVG text for that label,
							// with the same font choice in measurement and drawing.
							const fontFor = (text: string, font: Font) =>
								font.obj_ &&
								[...text].some(
									(char) => !/\s/.test(char) && !font.obj_?.glyphs[char],
								)
									? { ...font, obj_: undefined }
									: font;
							const measure = theme.textBBox;
							const drawText = theme.drawText;
							theme.textBBox = function (text, font) {
								return measure.call(this, text, fontFor(text, font));
							};
							theme.drawText = function (x, y, text, font, align) {
								return drawText.call(
									this,
									x,
									y,
									text,
									fontFor(text, font),
									align,
								);
							};
							theme.draw(container);
						},
					);
					const svg = container.querySelector("svg");
					if (!svg) throw new Error("The renderer returned no SVG image.");
					const colors: Record<string, string> = {
						"#000": dark ? "#e5e7eb" : "#24292f",
						"#000000": dark ? "#e5e7eb" : "#24292f",
						"#fff": dark ? "#1e1e1e" : "#ffffff",
						"#ffffff": dark ? "#1e1e1e" : "#ffffff",
					};
					for (const element of svg.querySelectorAll("[fill], [stroke]")) {
						for (const attribute of ["fill", "stroke"]) {
							const color = colors[element.getAttribute(attribute) ?? ""];
							if (color) element.setAttribute(attribute, color);
						}
					}
					port.postMessage({
						id,
						svg: new XMLSerializer().serializeToString(svg),
					});
				} catch (error) {
					port.postMessage({
						id,
						error:
							error instanceof Error
								? error.message
								: "Unable to render this diagram.",
					});
				} finally {
					drawing?.paper_?.remove();
					container.remove();
				}
			};
			port.postMessage({ ready: true });
		},
		{ once: true },
	);
}
