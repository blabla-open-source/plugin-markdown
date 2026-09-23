export const diagramLabels = {
	mermaid: "Mermaid",
	flowchart: "Flowchart",
	sequence: "Sequence",
};
export type DiagramEngine = keyof typeof diagramLabels;

export function diagramEngine(language: unknown): DiagramEngine | undefined {
	if (language === "mermaid") return "mermaid";
	if (language === "flow" || language === "flowchart") return "flowchart";
	if (language === "sequence") return "sequence";
	return undefined;
}
