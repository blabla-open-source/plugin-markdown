import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useState } from "react";

const HEADING_TRIGGER = "/h1";

interface SlashHeadingRange {
	from: number;
	to: number;
}

export function useMarkdownSlashHeading(editor: Editor | null) {
	const [active, setActive] = useState(false);

	const refresh = useCallback(() => {
		setActive(editor ? slashHeadingRange(editor) !== null : false);
	}, [editor]);

	useEffect(() => {
		if (!editor) {
			setActive(false);
			return;
		}

		refresh();
		editor.on("selectionUpdate", refresh);
		editor.on("transaction", refresh);
		return () => {
			editor.off("selectionUpdate", refresh);
			editor.off("transaction", refresh);
		};
	}, [editor, refresh]);

	const apply = useCallback(() => {
		const range = editor ? slashHeadingRange(editor) : null;
		if (!(editor && range)) {
			return false;
		}

		return editor
			.chain()
			.focus()
			.deleteRange(range)
			.setHeading({ level: 1 })
			.run();
	}, [editor]);

	return { active, apply };
}

export function MarkdownSlashHeadingMenu({
	active,
	onSelect,
}: {
	active: boolean;
	onSelect: () => boolean;
}) {
	if (!active) {
		return null;
	}

	return (
		<div
			aria-label="Markdown commands"
			className="slash-command-menu"
			role="listbox"
		>
			<button
				aria-selected="true"
				className="slash-command-option"
				onMouseDown={(event) => {
					event.preventDefault();
					onSelect();
				}}
				role="option"
				type="button"
			>
				Heading 1
			</button>
		</div>
	);
}

function slashHeadingRange(editor: Editor): SlashHeadingRange | null {
	const { selection } = editor.state;
	if (!selection.empty) {
		return null;
	}

	const { $from } = selection;
	const parent = $from.parent;
	if (
		parent.type.name !== "paragraph" ||
		parent.textContent !== HEADING_TRIGGER
	) {
		return null;
	}

	return {
		from: $from.start(),
		to: $from.end(),
	};
}
