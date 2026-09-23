import { useToolCopy, type ToolText } from "./markdown-tool-copy";
import { useState } from "react";
import { Button } from "@/components/tiptap-ui-primitive/button";
import {
	type InlineStyleProperty,
	normalizeInlineStyle,
} from "./markdown-inline-style";

export function MarkdownStyleField({
	label,
	property,
	placeholder,
	value,
	apply,
}: {
	label: "Text color" | "Background color" | "Font family" | "Font size";
	property: InlineStyleProperty;
	placeholder: string;
	value: string;
	apply: (value: string | null) => void;
}) {
	const t = useToolCopy();
	const [draft, setDraft] = useState(value);
	const [error, setError] = useState(false);
	const kind =
		property === "color" || property === "backgroundColor"
			? "color"
			: label.toLowerCase();
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				const normalized = normalizeInlineStyle(property, draft);
				if (!normalized && draft.trim()) {
					setError(true);
					return;
				}
				apply(normalized);
			}}
		>
			<label>
				{t(label)}
				<input
					aria-label={t(label)}
					value={draft}
					placeholder={placeholder}
					aria-invalid={error}
					onChange={(event) => {
						setDraft(event.target.value);
						setError(false);
					}}
				/>
			</label>
			<div>
				<Button
					type="submit"
					aria-label={t(`Apply ${label.toLowerCase()}` as ToolText)}
				>
					{t("Apply")}
				</Button>
				<Button
					type="button"
					aria-label={t(`Reset ${label.toLowerCase()}` as ToolText)}
					onClick={() => apply(null)}
				>
					{t("Reset")}
				</Button>
			</div>
			{error && (
				<small role="alert">
					{t(`Enter a valid CSS ${kind}.` as ToolText)}
				</small>
			)}
		</form>
	);
}
