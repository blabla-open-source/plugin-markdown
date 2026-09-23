import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";

/** Official offline bundle; retain its notices and both integration licenses. */
export function zenumlRuntime(): Plugin {
	const require = createRequire(import.meta.url);
	const id = "virtual:zenuml-runtime";
	return {
		name: "zenuml-runtime",
		resolveId: (source) => (source === id ? `\0${id}` : undefined),
		load(source) {
			if (source !== `\0${id}`) return undefined;
			const read = (file: string) =>
				readFileSync(require.resolve(file), "utf8");
			const coreLicense = path.resolve(
				require.resolve("@zenuml/core"),
				"../../LICENSE",
			);
			const bundle = read(
				"@mermaid-js/mermaid-zenuml/dist/mermaid-zenuml.min.js",
			);
			// The editor's unused Neon theme references a font absent from its package.
			// Native SVG uses system fonts. Keep this declaration local-only as well.
			const remoteFont =
				'src:url(/fonts/MS%20Sans%20Serif.ttf) format("truetype")';
			if (bundle.split(remoteFont).length !== 2)
				throw new Error(
					"Recheck ZenUML's offline font adaptation after upgrading.",
				);
			const script = [
				"/* Blabla offline adaptations: local font lookup and stateless editor preferences. */",
				'"use strict";',
				`/*\n${read("@mermaid-js/mermaid-zenuml/LICENSE")}\n${readFileSync(coreLicense, "utf8")}\n*/`,
				// Upstream's bundled editor initializes preferences even for native SVG.
				// Lexical defaults apply only to this library, never to window storage.
				"{ const localStorage = Object.freeze({ getItem: () => null, setItem: () => {} });",
				bundle.replace(remoteFont, 'src:local("MS Sans Serif")'),
				"}",
			].join("\n");
			return `export default ${JSON.stringify(script)};`;
		},
	};
}
