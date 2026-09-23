import { ALERT_TYPES } from "./markdown-alert-types";


export function normalizeAlertClipboard(html: string, enabled = true): string {
	if (!html.includes("md-alert") && (enabled || !html.includes("data-alert")))
		return html;
	const template = document.createElement("template");
	template.innerHTML = html;
	for (const block of template.content.querySelectorAll(
		'div.md-alert[mdtype="blockquote"]',
	)) {
		const type = ALERT_TYPES.find((value) =>
			block.classList.contains(`md-alert-${value}`),
		);
		if (!type) continue;
		const title = block.querySelector(
			`:scope > p:first-child > span[md-inline="alert_text"].md-alert-text-${type}`,
		);
		if (!title) continue;
		const softBreak = title.nextSibling;
		if (
			softBreak instanceof Element &&
			softBreak.matches('span[md-inline="softbreak"]') &&
			softBreak.textContent === "\n"
		)
			softBreak.remove();
		title.remove();
		const quote = document.createElement("blockquote");
		quote.dataset.alert = type;
		quote.dataset.alertMarker = `[!${type.toUpperCase()}]`;
		quote.append(...block.childNodes);
		block.replaceWith(quote);
	}
	if (!enabled) {
		for (const quote of template.content.querySelectorAll<HTMLElement>(
			"blockquote[data-alert-marker]",
		)) {
			const marker = quote.dataset.alertMarker;
			if (!marker) continue;
			const body = quote.querySelector(":scope > [data-alert-body]");
			if (body) quote.replaceChildren(...body.childNodes);
			const header = document.createElement("p");
			header.textContent = marker;
			quote.prepend(header);
			for (const name of [
				"data-alert",
				"data-alert-marker",
				"data-alert-source",
				"data-alert-block",
			])
				quote.removeAttribute(name);
		}
	}
	return template.innerHTML;
}
