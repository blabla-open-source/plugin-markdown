import "./markdown-language-choices.css";

/** Keep suggestions in the same surface as their input, including native views. */
export function languageChoices(
	input: HTMLInputElement,
	languages: string[],
	commit: () => boolean,
) {
	const dom = document.createElement("div");
	dom.className = "markdown-language-choices";
	dom.popover = "auto";
	dom.id = `code-languages-${crypto.randomUUID()}`;
	dom.setAttribute("role", "listbox");
	dom.setAttribute("aria-label", "Code languages");
	input.setAttribute("role", "combobox");
	input.setAttribute("aria-autocomplete", "list");
	input.setAttribute("aria-controls", dom.id);
	input.setAttribute("aria-expanded", "false");
	let selected = -1;
	const close = () => {
		dom.hidePopover();
		input.setAttribute("aria-expanded", "false");
		input.removeAttribute("aria-activedescendant");
	};
	const choose = (value: string) => {
		input.value = value;
		input.dispatchEvent(new Event("input"));
		close();
		commit();
	};
	const show = () => {
		const query = input.value.toLowerCase();
		const matches = languages.filter((language) => language.includes(query));
		dom.replaceChildren();
		selected = -1;
		input.removeAttribute("aria-activedescendant");
		for (const [index, language] of matches.entries()) {
			const option = document.createElement("div");
			option.id = `${dom.id}-${index}`;
			option.setAttribute("role", "option");
			option.textContent = language;
			option.addEventListener("pointerdown", (event) => event.preventDefault());
			option.addEventListener("click", () => choose(language));
			dom.append(option);
		}
		if (!matches.length) return close();
		const rect = input.getBoundingClientRect();
		const below = window.innerHeight - rect.bottom - 8;
		const above = rect.top - 8;
		const down = below >= Math.min(240, above);
		dom.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - 244))}px`;
		dom.style.top = down ? `${rect.bottom + 4}px` : "auto";
		dom.style.bottom = down ? "auto" : `${window.innerHeight - rect.top + 4}px`;
		dom.style.maxHeight = `${Math.max(0, Math.min(240, down ? below : above))}px`;
		dom.showPopover();
		input.setAttribute("aria-expanded", "true");
	};
	input.addEventListener("focus", show);
	input.addEventListener("click", show);
	input.addEventListener("input", show);
	input.addEventListener("blur", close);
	input.addEventListener("keydown", (event) => {
		if (event.isComposing) return;
		if (event.key === "Escape" && dom.matches(":popover-open")) {
			close();
		} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (!dom.matches(":popover-open")) show();
			const options = [...dom.children] as HTMLElement[];
			if (!options.length) return;
			const step = event.key === "ArrowDown" ? 1 : -1;
			if (selected < 0) selected = step > 0 ? 0 : options.length - 1;
			else selected = (selected + step + options.length) % options.length;
			options.forEach((option, index) => {
				option.setAttribute("aria-selected", String(index === selected));
			});
			const option = options[selected]!;
			input.setAttribute("aria-activedescendant", option.id);
			option.scrollIntoView({ block: "nearest" });
		} else if (
			event.key === "Enter" &&
			selected >= 0 &&
			dom.matches(":popover-open")
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
			choose(dom.children[selected]!.textContent ?? "");
		}
	});
	const onScroll = (event: Event) => {
		if (!dom.contains(event.target as Node)) close();
	};
	const detach = () => {
		document.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", close);
	};
	dom.addEventListener("toggle", () => {
		detach();
		if (dom.matches(":popover-open")) {
			document.addEventListener("scroll", onScroll, true);
			window.addEventListener("resize", close);
		} else {
			input.setAttribute("aria-expanded", "false");
			input.removeAttribute("aria-activedescendant");
		}
	});
	return {
		dom,
		destroy() {
			close();
			detach();
		},
	};
}
