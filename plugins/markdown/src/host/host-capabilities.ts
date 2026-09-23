export interface BlablaHostCapabilities {
	documentAttachments: Array<"read" | "write">;
	documentMetadata: Array<"title:write">;
	fileReferences: Array<
		"import" | "open" | "quickView" | "read" | "reveal" | "watch"
	>;
	imageExports: Array<"clipboard" | "save">;
	materials: Array<"prepare" | "read">;
	navigation: Array<"open">;
	pluginDocument: Array<"read" | "write">;
	settings: Array<"read" | "write">;
	sourceText: Array<"read" | "recovery" | "write">;
	surface: Array<"dirty">;
}
