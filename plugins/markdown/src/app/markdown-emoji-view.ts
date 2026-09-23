import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import type { EmojiCandidate } from "./markdown-emoji-data";

export const renderEmojiCandidates: NonNullable<
	SuggestionOptions<EmojiCandidate, EmojiCandidate>["render"]
> = () => {
	const list = document.createElement("div");
	list.className = "markdown-emoji-candidates";
	list.setAttribute("role", "listbox");
	list.setAttribute("aria-label", "Emoji");
	let current: SuggestionProps<EmojiCandidate, EmojiCandidate>;
	let selected = 0;
	let unmount: (() => void) | undefined;
	const highlight = () => {
		[...list.children].forEach((child, index) => {
			child.setAttribute("aria-selected", String(index === selected));
		});
		list.children[selected]?.scrollIntoView({ block: "nearest" });
	};
	const choose = (index: number) => {
		const item = current.items[index];
		if (item) current.command(item);
	};
	const update = (props: SuggestionProps<EmojiCandidate, EmojiCandidate>) => {
		current = props;
		selected = 0;
		list.replaceChildren(
			...props.items.map((item, index) => {
				const option = document.createElement("button");
				option.type = "button";
				option.setAttribute("role", "option");
				option.setAttribute("aria-label", `:${item.name}:`);
				const glyph = document.createElement("span");
				glyph.className = "markdown-emoji-glyph";
				glyph.setAttribute("aria-hidden", "true");
				glyph.textContent = item.emoji;
				option.append(glyph, `  :${item.name}:`);
				option.addEventListener("mousedown", (event) => event.preventDefault());
				option.addEventListener("click", () => choose(index));
				return option;
			}),
		);
		list.hidden = props.items.length === 0;
		highlight();
	};
	return {
		onStart: (props) => {
			update(props);
			unmount = props.mount(list);
		},
		onUpdate: update,
		onExit: () => {
			unmount?.();
			unmount = undefined;
		},
		onKeyDown: ({ event }) => {
			if (!current.items.length) return false;
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				selected =
					(selected +
						(event.key === "ArrowDown" ? 1 : -1) +
						current.items.length) %
					current.items.length;
				highlight();
				return true;
			}
			if (event.key !== "Enter" && event.key !== "Tab") return false;
			choose(selected);
			return true;
		},
	};
};
