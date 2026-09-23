import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

/** Upstream browser distributions, pinned in the lockfile; never fetched at runtime. */
export function sequenceRuntime(): Plugin {
	const require = createRequire(import.meta.url);
	const id = "virtual:sequence-runtime";
	return {
		name: "sequence-runtime",
		resolveId: (source) => (source === id ? `\0${id}` : undefined),
		load(source) {
			if (source !== `\0${id}`) return undefined;
			const read = (file: string) =>
				readFileSync(require.resolve(file), "utf8").replace(
					/^\s*\/\/[#@] sourceMappingURL=.*$/gm,
					"",
				);
			const raphaelRequire = createRequire(require.resolve("raphael"));
			const underscoreRequire = createRequire(
				require.resolve("underscore/package.json"),
			);
			const notices = [
				"Raphael: Copyright (c) 2008-2016 Dmitry Baranovskiy and Sencha Labs.",
				read("raphael/license.txt"),
				readFileSync(raphaelRequire.resolve("eve-raphael/LICENSE"), "utf8"),
				readFileSync(underscoreRequire.resolve("./LICENSE"), "utf8"),
				read("js-sequence-diagrams/LICENCE"),
			].join("\n\n");
			// The upstream minifier omitted this mandatory notice for its embedded font.
			const fontSource = read(
				"js-sequence-diagrams/fonts/daniel/daniel_700.font.js",
			);
			const fontNotice = fontSource.slice(0, fontSource.indexOf("*/") + 2);
			const script = [
				`/*\n${notices}\n*/`,
				fontNotice,
				read("raphael/raphael.min.js"),
				read("underscore/underscore-umd-min.js"),
				read("js-sequence-diagrams/dist/sequence-diagram-raphael-min.js"),
			].join("\n;\n");
			return `export default ${JSON.stringify(script)};`;
		},
	};
}
