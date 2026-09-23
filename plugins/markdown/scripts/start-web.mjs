import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.BLABLA_MARKDOWN_HOST ?? "127.0.0.1";
const port = Number.parseInt(
	process.env.BLABLA_PLUGIN_PORT ??
		process.env.PORT ??
		process.env.BLABLA_MARKDOWN_PORT ??
		"43219",
	10,
);
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

const server = await createServer({
	configFile: resolve(root, "vite.config.ts"),
	root,
	server: {
		host,
		port,
		strictPort: true,
		watch: {
			ignored: devWatchIgnored,
		},
	},
});

await server.listen();

const resolved = server.resolvedUrls?.local?.[0] ?? `http://${host}:${port}/`;
console.log(`Blabla Markdown: ready ${resolved}`);

const close = async () => {
	await server.close();
	process.exit(0);
};

process.once("SIGINT", close);
process.once("SIGTERM", close);
