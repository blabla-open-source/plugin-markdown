import type flowchart from "flowchart.js";

/** Serialized into the opaque frame. Source never enters the editor DOM as SVG. */
export function startFlowchartSandbox() {
	const runtime = (window as unknown as { flowchart: typeof flowchart })
		.flowchart;
	window.addEventListener(
		"message",
		(event: MessageEvent) => {
			if (event.source !== parent || event.data !== "diagram-connect") return;
			const port = event.ports[0];
			if (!port) return;
			port.onmessage = ({ data }) => {
				const { id, source, dark } = data;
				const container = document.createElement("div");
				document.body.append(container);
				let chart:
					| (ReturnType<typeof runtime.parse> & {
							diagram?: { paper: { remove: () => void } };
					  })
					| undefined;
				try {
					if (source.length > 50_000)
						throw new Error("Diagram source exceeds 50,000 characters.");
					if (source.split("->").length > 501)
						throw new Error(
							"Diagram source exceeds 500 connection separators.",
						);
					chart = runtime.parse(source.replace(/\r/g, ""));
					const color = dark ? "#e5e7eb" : "#24292f";
					chart.drawSVG(container, {
						"font-family": "Arial, sans-serif",
						"font-color": color,
						"line-color": color,
						"element-color": color,
						fill: dark ? "#1e1e1e" : "#ffffff",
					});
					const svg = container.querySelector("svg");
					if (!svg) throw new Error("The renderer returned no SVG image.");
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
					// Raphael keeps paper/event registrations outside the DOM tree.
					chart?.diagram?.paper.remove();
					container.remove();
				}
			};
			port.postMessage({ ready: true });
		},
		{ once: true },
	);
}
