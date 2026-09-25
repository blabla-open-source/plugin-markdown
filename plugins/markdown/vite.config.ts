import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { flowchartRuntime } from "./scripts/flowchart-runtime";
import { sequenceRuntime } from "./scripts/sequence-runtime";
import { zenumlRuntime } from "./scripts/zenuml-runtime";

const port = Number.parseInt(process.env.BLABLA_MARKDOWN_PORT ?? "43219", 10);
const devWatchIgnored = [
	"tests/**",
	"dist/**",
	".tmp/**",
	"coverage/**",
	"**/*.md",
	"**/*.markdown",
	"**/*.blabla-canvas",
	"**/*.pdf",
	"**/*.pptx",
	"**/*.docx",
	"**/*.xlsx",
	"**/*.csv",
	"**/*.mp4",
	"**/*.obj",
	"**/*.mtl",
	"**/*.db",
	"**/*.db-wal",
	"**/*.db-shm",
	"**/*.sqlite",
	"**/*.sqlite3",
	"**/*.log",
	"**/*.ndjson",
];

export default defineConfig({
	build: {
		outDir: "dist",
		license: { fileName: "third-party-licenses.json" },
		sourcemap: false,
		target: "es2024",
	},
	plugins: [react(), flowchartRuntime(), sequenceRuntime(), zenumlRuntime()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	server: {
		host: "127.0.0.1",
		port,
		strictPort: false,
		watch: {
			ignored: devWatchIgnored,
		},
	},
});
