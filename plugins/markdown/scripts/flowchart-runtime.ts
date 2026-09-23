import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build, type Plugin } from "vite";

/** flowchart.js ships CommonJS only; build one offline script for the sandbox. */
export function flowchartRuntime(): Plugin {
	const require = createRequire(import.meta.url);
	const id = "virtual:flowchart-runtime";
	let compiled: Promise<string> | undefined;
	const compile = async () => {
		const raphaelRequire = createRequire(require.resolve("raphael"));
		const notices = [
			"Bundled and minified for Blabla's offline renderer.\nRaphael: Copyright (c) 2008-2016 Dmitry Baranovskiy and Sencha Labs.",
			readFileSync(require.resolve("flowchart.js/license"), "utf8"),
			readFileSync(require.resolve("raphael/license.txt"), "utf8"),
			readFileSync(raphaelRequire.resolve("eve-raphael/LICENSE"), "utf8"),
		].join("\n\n");
		const result = await build({
			configFile: false,
			logLevel: "error",
			build: {
				write: false,
				lib: {
					entry: require.resolve("flowchart.js"),
					name: "flowchart",
					formats: ["iife"],
				},
			},
		});
		const outputs = Array.isArray(result) ? result : [result];
		const chunks = outputs
			.flatMap((output) => ("output" in output ? output.output : []))
			.filter((output) => output.type === "chunk");
		if (chunks.length !== 1 || !chunks[0])
			throw new Error("Flowchart must bundle as one offline script.");
		return `export default ${JSON.stringify(`/*\n${notices}\n*/\n${chunks[0].code}`)};`;
	};
	return {
		name: "flowchart-runtime",
		resolveId: (source) => (source === id ? `\0${id}` : undefined),
		load(source) {
			if (source !== `\0${id}`) return undefined;
			compiled ??= compile();
			return compiled;
		},
	};
}
