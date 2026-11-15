import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MarkdownApp } from "./app/markdown-app";

const root = document.getElementById("root");

if (!root) {
	throw new Error("Missing #root");
}

createRoot(root).render(
	<StrictMode>
		<MarkdownApp />
	</StrictMode>,
);
