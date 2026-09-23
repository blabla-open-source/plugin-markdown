import type { MarkdownMediaSourceResolver } from "./markdown-media-source";

const sources = new WeakMap<Element, string | null>();
const posters = new WeakMap<HTMLVideoElement, string>();

/** Capture resource paths while the sanitized preview is still detached. */
export function captureMediaSource(element: Element): void {
	if (
		!(
			element instanceof HTMLMediaElement ||
			element instanceof HTMLSourceElement ||
			element instanceof HTMLTrackElement
		)
	)
		return;
	sources.set(element, element.getAttribute("src"));
	element.removeAttribute("src");
	if (element instanceof HTMLVideoElement) {
		posters.set(element, element.getAttribute("poster") ?? "");
		element.removeAttribute("poster");
	}
}

export function authoredMediaSource(element: Element): string | null {
	return sources.get(element) ?? null;
}

function bindVideoPoster(
	video: HTMLVideoElement,
	resolver: MarkdownMediaSourceResolver,
	setNotice: (message: string) => void,
) {
	const source = posters.get(video);
	if (!source) return () => undefined;
	let disposed = false;
	const image = new Image();
	setNotice("Resolving video poster…");
	const failed = () => {
		if (!disposed)
			setNotice("Video poster is unavailable. HTML source is preserved.");
	};
	image.onload = () => {
		if (disposed) return;
		video.poster = image.src;
		setNotice("");
	};
	image.onerror = failed;
	const unsubscribe = resolver.subscribe(source, (url) => {
		if (disposed) return;
		if (url) image.src = url;
		else failed();
	});
	return () => {
		disposed = true;
		unsubscribe();
		image.onload = null;
		image.onerror = null;
		image.removeAttribute("src");
		video.removeAttribute("poster");
	};
}

export function bindMediaResources(
	media: HTMLMediaElement,
	resolver: MarkdownMediaSourceResolver,
	setNotice: (message: string) => void,
) {
	let mediaNotice = "";
	let posterNotice = "";
	let trackNotice = "";
	const updateNotice = () =>
		setNotice(mediaNotice || posterNotice || trackNotice);
	const tracks = bindMediaTracks(media, resolver, (message) => {
		trackNotice = message;
		updateNotice();
	});
	const cleanup = bindMediaSources(media, resolver, (message) => {
		mediaNotice = message;
		updateNotice();
	});
	const poster =
		media instanceof HTMLVideoElement
			? bindVideoPoster(media, resolver, (message) => {
					posterNotice = message;
					updateNotice();
				})
			: () => undefined;
	return () => {
		tracks();
		cleanup();
		poster();
	};
}

/** A same-origin preview URL keeps captions independent of the video's CORS mode. */
function bindMediaTracks(
	media: HTMLMediaElement,
	resolver: MarkdownMediaSourceResolver,
	setNotice: (message: string) => void,
) {
	const notices = new Map<HTMLTrackElement, string>();
	const credentials =
		media.crossOrigin === "use-credentials" ? "include" : "same-origin";
	const cleanups = [...media.children]
		.filter(
			(child): child is HTMLTrackElement => child instanceof HTMLTrackElement,
		)
		.map((track) =>
			bindMediaTrack(media, track, resolver, credentials, (message) => {
				notices.set(track, message);
				setNotice([...notices.values()].find(Boolean) ?? "");
			}),
		);
	return () => {
		for (const cleanup of cleanups) cleanup();
	};
}

function bindMediaTrack(
	media: HTMLMediaElement,
	track: HTMLTrackElement,
	resolver: MarkdownMediaSourceResolver,
	credentials: RequestCredentials,
	setNotice: (message: string) => void,
) {
	const controller = new AbortController();
	let previewUrl: string | undefined;
	let unsubscribe: (() => void) | undefined;
	const failed = () => {
		if (!controller.signal.aborted)
			setNotice("Text track is unavailable. HTML source is preserved.");
	};
	const loaded = () => setNotice("");
	const load = async (url: string) => {
		const response = await fetch(url, {
			credentials,
			signal: controller.signal,
		});
		if (!response.ok) throw new Error("Unavailable text track");
		const blob = await response.blob();
		if (controller.signal.aborted) return;
		previewUrl = URL.createObjectURL(blob);
		track.src = previewUrl;
	};
	track.addEventListener("error", failed);
	track.addEventListener("load", loaded);
	const start = () => {
		if (
			controller.signal.aborted ||
			unsubscribe ||
			!track.isConnected ||
			track.track.mode === "disabled"
		)
			return;
		unsubscribe = resolver.subscribe(
			authoredMediaSource(track) ?? "",
			(url) => {
				if (url) void load(url).catch(failed);
				else failed();
			},
		);
	};
	// Native selection owns demand. Detached serialization views must not fetch.
	media.textTracks.addEventListener("change", start);
	media.addEventListener("loadstart", start);
	queueMicrotask(start);
	return () => {
		controller.abort();
		unsubscribe?.();
		media.textTracks.removeEventListener("change", start);
		media.removeEventListener("loadstart", start);
		track.removeEventListener("error", failed);
		track.removeEventListener("load", loaded);
		track.removeAttribute("src");
		track.remove();
		if (previewUrl) URL.revokeObjectURL(previewUrl);
	};
}

function bindMediaSources(
	media: HTMLMediaElement,
	resolver: MarkdownMediaSourceResolver,
	setNotice: (message: string) => void,
) {
	const label = media instanceof HTMLVideoElement ? "Video" : "Audio";
	setNotice(`Resolving ${label.toLowerCase()}…`);
	const preload = media.preload;
	media.preload = "none";
	const children = [...media.children].filter(
		(child): child is HTMLSourceElement => child instanceof HTMLSourceElement,
	);
	const directSource = sources.get(media);
	const candidates: (HTMLMediaElement | HTMLSourceElement)[] =
		directSource !== null && directSource !== undefined ? [media] : children;
	const urls = new Map<Element, string>();
	const failedSources = new Set<Element>();
	const cleanups: (() => void)[] = [];
	let disposed = false;
	let remaining = candidates.length;
	const failed = () => {
		if (disposed) return;
		setNotice(`${label} source is unavailable. HTML source is preserved.`);
	};
	const loaded = () => {
		if (disposed) return;
		setNotice("");
	};
	media.addEventListener("error", failed);
	media.addEventListener("loadedmetadata", loaded);
	const start = () => {
		if (disposed) return;
		// All candidates are resolved together; Chromium owns codec and error fallback.
		for (const child of children) if (!urls.has(child)) child.remove();
		if (!urls.size) {
			failed();
			return;
		}
		for (const [element, url] of urls) element.setAttribute("src", url);
		media.preload = preload;
		loaded();
		media.load();
	};
	for (const candidate of candidates) {
		const onError = () => {
			if (!urls.has(candidate)) return;
			failedSources.add(candidate);
			if (failedSources.size === urls.size) failed();
		};
		if (candidate instanceof HTMLSourceElement) {
			candidate.addEventListener("error", onError);
			cleanups.push(() => candidate.removeEventListener("error", onError));
		}
		cleanups.push(
			resolver.subscribe(sources.get(candidate) ?? "", (url) => {
				if (disposed) return;
				if (url) urls.set(candidate, url);
				remaining -= 1;
				if (!remaining) start();
			}),
		);
	}
	if (!candidates.length) failed();
	return () => {
		disposed = true;
		for (const cleanup of cleanups) cleanup();
		media.removeEventListener("error", failed);
		media.removeEventListener("loadedmetadata", loaded);
		media.pause();
		media.removeAttribute("src");
		for (const child of children) {
			child.removeAttribute("src");
			child.remove();
		}
		media.load();
	};
}
