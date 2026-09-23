import { type DiagramEngine, diagramLabels } from "./markdown-diagram-engine";
import { startFlowchartSandbox } from "./markdown-flowchart-sandbox";
import { startMermaidSandbox } from "./markdown-mermaid-sandbox";
import type { SequenceTheme } from "./markdown-preferences";
import { startSequenceSandbox } from "./markdown-sequence-sandbox";

const engines = {
	mermaid: {
		load: () => import("mermaid/dist/mermaid.min.js?raw"),
		start: startMermaidSandbox,
	},
	flowchart: {
		load: () => import("virtual:flowchart-runtime"),
		start: startFlowchartSandbox,
	},
	sequence: {
		load: () => import("virtual:sequence-runtime"),
		start: startSequenceSandbox,
	},
};

type RenderResult = { svg?: string; error?: string };
type RenderJob = {
	id: number;
	source: string;
	dark: boolean;
	sequenceTheme: SequenceTheme;
	complete: (result: RenderResult) => void;
};

/** One lazy, offline renderer per editor and engine; newer edits replace queued work. */
function createDiagramRenderer(engine: DiagramEngine) {
	const frame = document.createElement("iframe");
	frame.title = `Isolated ${diagramLabels[engine]} renderer`;
	frame.setAttribute("sandbox", "allow-scripts");
	frame.setAttribute("aria-hidden", "true");
	frame.tabIndex = -1;
	frame.style.cssText =
		"position:fixed;left:-10000px;top:0;width:1200px;height:1px;border:0;pointer-events:none";
	const channel = new MessageChannel();
	const pending = new Map<object, RenderJob>();
	let sequence = 0;
	let active: RenderJob | undefined;
	let ready = false;
	let disposed = false;
	let failure: string | undefined;
	let deadline: ReturnType<typeof setTimeout>;
	const fail = (message: string) => {
		if (disposed) return;
		failure = message;
		clearTimeout(deadline);
		frame.remove();
		active?.complete({ error: message });
		active = undefined;
		for (const job of pending.values()) job.complete({ error: message });
		pending.clear();
	};
	const pump = () => {
		if (disposed || failure || !ready || active) return;
		const entry = pending.entries().next().value;
		if (!entry) return;
		const [owner, job] = entry;
		pending.delete(owner);
		active = job;
		deadline = setTimeout(
			() => fail("Diagram rendering timed out. Reopen this document to retry."),
			15_000,
		);
		channel.port1.postMessage({
			id: job.id,
			source: job.source,
			dark: job.dark,
			sequenceTheme: job.sequenceTheme,
		});
	};
	channel.port1.onmessage = ({ data }) => {
		// Only Mermaid's known offline extension can request another script.
		// Keep the active render deadline running while its bundle loads.
		if (engine === "mermaid" && data.load === "zenuml") {
			void import("virtual:zenuml-runtime")
				.then(({ default: script }) => {
					if (!disposed && !failure)
						channel.port1.postMessage({ extension: "zenuml", script });
				})
				.catch(() => {
					if (!disposed && !failure)
						channel.port1.postMessage({
							extension: "zenuml",
							error: "ZenUML could not load. Reopen this document to retry.",
						});
				});
			return;
		}
		clearTimeout(deadline);
		if (data.ready) ready = true;
		else if (active && data.id === active.id) {
			const done = active.complete;
			active = undefined;
			done(data);
		}
		pump();
	};
	deadline = setTimeout(
		() =>
			fail("Diagram renderer could not start. Reopen this document to retry."),
		15_000,
	);
	frame.addEventListener(
		"load",
		() => {
			frame.contentWindow?.postMessage("diagram-connect", "*", [channel.port2]);
		},
		{ once: true },
	);
	const { load, start } = engines[engine];
	void load()
		.then(({ default: script }) => {
			if (disposed || failure) return;
			const nonce = crypto.randomUUID();
			const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
			// Only trusted, bundled code is inserted here. Diagram text uses the port.
			frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><body><script nonce="${nonce}">${script.replace(/<\/script/gi, "<\\/script")}</script><script nonce="${nonce}">(${start.toString()})();</script>`;
			document.body.append(frame);
		})
		.catch(() => {
			fail("Diagram renderer could not load. Reopen this document to retry.");
		});
	return {
		render(
			owner: object,
			source: string,
			dark: boolean,
			complete: RenderJob["complete"],
			sequenceTheme: SequenceTheme = "simple",
		) {
			if (disposed) return;
			if (failure) {
				complete({ error: failure });
				return;
			}
			pending.set(owner, {
				id: ++sequence,
				source,
				dark,
				sequenceTheme,
				complete,
			});
			pump();
		},
		cancel(owner: object) {
			pending.delete(owner);
		},
		destroy() {
			disposed = true;
			clearTimeout(deadline);
			pending.clear();
			active = undefined;
			channel.port1.close();
			channel.port2.close();
			frame.remove();
		},
	};
}

type Renderer = ReturnType<typeof createDiagramRenderer>;
const renderers = new WeakMap<
	object,
	Map<DiagramEngine, { renderer: Renderer; users: number }>
>();

export function acquireDiagramRenderer(editor: object, engine: DiagramEngine) {
	let engines = renderers.get(editor);
	if (!engines) {
		engines = new Map();
		renderers.set(editor, engines);
	}
	let shared = engines.get(engine);
	if (!shared) {
		shared = { renderer: createDiagramRenderer(engine), users: 0 };
		engines.set(engine, shared);
	}
	shared.users++;
	const current = shared;
	return {
		renderer: current.renderer,
		release() {
			if (--current.users) return;
			current.renderer.destroy();
			engines.delete(engine);
			if (!engines.size) renderers.delete(editor);
		},
	};
}
