import type mermaid from "mermaid";
import type { ExternalDiagramDefinition } from "mermaid";

/** Runs only inside the opaque sandbox. No editor, Host API, or source path. */
export function startMermaidSandbox() {
	const runtime = (window as unknown as { mermaid: typeof mermaid }).mermaid;
	const nonce = (document.currentScript as HTMLScriptElement | null)?.nonce;
	// ZenUML's geometry omits left-hand sequence glyphs and long titles. Measure
	// its live SVG before Mermaid serializes it; preserve the diagram's layout.
	function fitZenUmlFrame(id: string) {
		const root = document.getElementById(id) as SVGSVGElement | null;
		const content = root?.querySelector<SVGGElement>(":scope > g");
		const outer = root?.querySelector<SVGRectElement>(".frame-border-outer");
		const inner = root?.querySelector<SVGRectElement>(".frame-border-inner");
		const header = root?.querySelector<SVGLineElement>(".frame-header-line");
		const title = root?.querySelector<SVGTextElement>(".frame-title");
		const transform = content?.transform.baseVal.consolidate()?.matrix;
		if (!root || !content || !outer || !inner || !header || !transform)
			throw new Error("ZenUML frame layout changed. Recheck its SVG adapter.");
		const box = content.getBBox();
		const titleBox = title?.getBBox();
		const padding = 11; // One-pixel frame plus the upstream ten-pixel padding.
		const shift = Math.max(0, padding - (box.x + transform.e));
		const width = Math.ceil(
			Math.max(
				root.viewBox.baseVal.width + shift,
				box.x + transform.e + box.width + shift + padding,
				(titleBox ? titleBox.x + titleBox.width : 0) + padding,
			),
		);
		const height = Math.ceil(
			Math.max(
				root.viewBox.baseVal.height,
				box.y + transform.f + box.height + padding,
			),
		);
		content.setAttribute(
			"transform",
			`translate(${shift}, 0) ${content.getAttribute("transform") ?? ""}`,
		);
		outer.setAttribute("width", String(width));
		outer.setAttribute("height", String(height));
		inner.setAttribute("width", String(width - 2));
		inner.setAttribute("height", String(height - 2));
		header.setAttribute("x2", String(width - 1));
		root.setAttribute("viewBox", `0 0 ${width} ${height}`);
		root.style.maxWidth = `${width}px`;
	}
	window.addEventListener(
		"message",
		(event: MessageEvent) => {
			if (event.source !== parent || event.data !== "diagram-connect") return;
			const port = event.ports[0];
			if (!port) return;
			let extension: Promise<ExternalDiagramDefinition> | undefined;
			let receiveExtension: (data: { script?: string; error?: string }) => void;
			const registered = runtime.registerExternalDiagrams([
				{
					id: "zenuml",
					detector: (text) => /^\s*zenuml/.test(text),
					loader: async () => {
						extension ??= new Promise((resolve, reject) => {
							receiveExtension = ({ script, error }) => {
								if (error || !script) {
									reject(new Error(error ?? "ZenUML returned no renderer."));
									return;
								}
								const element = document.createElement("script");
								element.nonce = nonce ?? "";
								element.textContent = script;
								document.body.append(element);
								element.remove();
								const definition = (
									window as unknown as {
										"mermaid-zenuml"?: ExternalDiagramDefinition;
									}
								)["mermaid-zenuml"];
								if (definition) resolve(definition);
								else reject(new Error("ZenUML could not start."));
							};
							port.postMessage({ load: "zenuml" });
						});
						const loaded = await (await extension).loader();
						const draw = loaded.diagram.renderer.draw;
						loaded.diagram.renderer.draw = async (...args) => {
							await draw(...args);
							fitZenUmlFrame(args[1]);
						};
						return loaded;
					},
				},
			]);
			port.onmessage = async ({ data }) => {
				if (data.extension === "zenuml") {
					receiveExtension?.(data);
					return;
				}
				const { id, source, dark } = data;
				const container = document.createElement("div");
				document.body.append(container);
				try {
					if (source.length > 50_000)
						throw new Error("Diagram source exceeds 50,000 characters.");
					await registered;
					runtime.initialize({
						startOnLoad: false,
						securityLevel: "strict",
						suppressErrorRendering: true,
						theme: dark ? "dark" : "default",
						fontFamily: "Arial, sans-serif",
						maxTextSize: 50_000,
						maxEdges: 500,
						// Source directives cannot lower these controls.
						secure: [
							"secure",
							"securityLevel",
							"startOnLoad",
							"suppressErrorRendering",
							"maxTextSize",
							"maxEdges",
						],
					});
					const { svg } = await runtime.render(
						`diagram-${id}`,
						source,
						container,
					);
					// Mermaid includes HTML void tags in foreignObject labels. Serialize
					// the inert DOM as XML so the final SVG is valid in an image context.
					const root = new DOMParser()
						.parseFromString(svg, "text/html")
						.querySelector("svg");
					if (!root) throw new Error("The renderer returned no SVG image.");
					const box = root.getAttribute("viewBox")?.split(/\s+/).map(Number);
					if (box?.length === 4 && (box[2] ?? 0) > 0 && (box[3] ?? 0) > 0) {
						root.setAttribute("width", String(box[2]));
						root.setAttribute("height", String(box[3]));
					}
					port.postMessage({
						id,
						svg: new XMLSerializer().serializeToString(root),
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
					container.remove();
				}
			};
			port.postMessage({ ready: true });
		},
		{ once: true },
	);
}
