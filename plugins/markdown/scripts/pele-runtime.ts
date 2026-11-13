import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";

/** Bundle the official offline browser runtime with its complete license notices. */
export function peleRuntime(): Plugin {
	const require = createRequire(import.meta.url);
	const id = "virtual:pele-runtime";
	return {
		name: "pele-runtime",
		resolveId: (source) => (source === id ? `\0${id}` : undefined),
		load(source) {
			if (source !== `\0${id}`) return undefined;
			const license = readFileSync(
				path.join(path.dirname(require.resolve("pele/package.json")), "LICENSE"),
				"utf8",
			);
			const script = readFileSync(require.resolve("pele/global"), "utf8");
			return `export default ${JSON.stringify(`/*\n${license}\n*/\n${script}`)};`;
		},
	};
}
