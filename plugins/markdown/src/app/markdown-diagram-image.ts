export type DiagramImageFormat = "jpeg" | "png" | "svg";

export async function diagramImageBytes(
	svg: string,
	format: DiagramImageFormat,
	background: string,
): Promise<Uint8Array> {
	if (format === "svg") return new TextEncoder().encode(svg);
	// A self-contained SVG data image remains canvas-readable even when labels
	// contain foreignObject. Blob-backed SVG images taint Chromium's canvas.
	const image = new Image();
	image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	await image.decode();
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, image.naturalWidth);
	canvas.height = Math.max(1, image.naturalHeight);
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Image canvas is unavailable.");
	context.fillStyle = background;
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.drawImage(image, 0, 0);
	const mime = format === "png" ? "image/png" : "image/jpeg";
	const blob = await new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(value) =>
				value ? resolve(value) : reject(new Error("Image export failed.")),
			mime,
			0.92,
		),
	);
	return new Uint8Array(await blob.arrayBuffer());
}
