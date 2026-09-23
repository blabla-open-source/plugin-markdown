import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import { MarkdownApp } from "./app/markdown-app";
import "./official-tiptap.scss";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
	throw new Error("Missing #root");
}

createRoot(root).render(
	<StrictMode>
		<MarkdownApp />
	</StrictMode>,
);
