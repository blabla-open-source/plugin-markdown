import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
for (const [name, expected, packagePath = "../package.json"] of [["@tiptap/core", "3.31.3"], ["@tiptap/extension-list", "3.31.3"], ["@tiptap/markdown", "3.31.3"], ["marked", "17.0.6"], ["parse5", "8.0.1"], ["prosemirror-model", "1.25.11"], ["flowchart.js", "1.18.0", "package.json"]]) {
	const packageFile = resolve(dirname(require.resolve(name)), packagePath);
	const { version } = JSON.parse(readFileSync(packageFile, "utf8"));
	if (version !== expected) {
		throw new Error(`${name} patches require ${expected}; found ${version}. Review and rebase the source patches before upgrading.`);
	}
}
execFileSync(process.execPath, [require.resolve("patch-package/index.js"), "--error-on-fail"], { stdio: "inherit" });
