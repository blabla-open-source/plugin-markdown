import { focusReferenceDefinition } from "@/app/markdown-reference-links";
import { validReferenceLabel } from "@/app/markdown-grammar";
import { normalizeReferenceLabel } from "@/app/markdown-grammar";
import type { Editor } from "@tiptap/react";
import * as React from "react";
// --- Icons ---
import { LinkIcon } from "@/components/tiptap-icons/link-icon";
// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";

// --- Lib ---
import { isMarkInSchema } from "@/lib/tiptap-utils";

/**
 * Configuration for the link popover functionality
 */
export interface UseLinkPopoverConfig {
	onOpenLink?: (url: string) => void;
	/**
	 * The Tiptap editor instance.
	 */
	editor?: Editor | null;
	/**
	 * Whether to hide the link popover when not available.
	 * @default false
	 */
	hideWhenUnavailable?: boolean;
	/**
	 * Callback function called when the link is set.
	 */
	onSetLink?: () => void;
}

/**
 * Configuration for the link handler functionality
 */
export interface LinkHandlerProps {
	onOpenLink?: (url: string) => void;
	/**
	 * The Tiptap editor instance.
	 */
	editor: Editor | null;
	/**
	 * Callback function called when the link is set.
	 */
	onSetLink?: () => void;
}

/**
 * Checks if a link can be set in the current editor state
 */
export function canSetLink(editor: Editor | null): boolean {
	if (!editor || !editor.isEditable) return false;
	return editor.can().setMark("link");
}

/**
 * Checks if a link is currently active in the editor
 */
export function isLinkActive(editor: Editor | null): boolean {
	if (!editor || !editor.isEditable) return false;
	return editor.isActive("link");
}

/**
 * Determines if the link button should be shown
 */
export function shouldShowLinkButton(props: {
	editor: Editor | null;
	hideWhenUnavailable: boolean;
}): boolean {
	const { editor, hideWhenUnavailable } = props;

	const linkInSchema = isMarkInSchema("link", editor);

	if (!linkInSchema || !editor) {
		return false;
	}

	if (hideWhenUnavailable && !editor.isActive("code")) {
		return canSetLink(editor);
	}

	return true;
}

/**
 * Custom hook for handling link operations in a Tiptap editor
 */
export function useLinkHandler(props: LinkHandlerProps) {
	const { editor, onSetLink, onOpenLink } = props;
	const [url, setUrl] = React.useState<string | null>(null);
	const [title, setTitle] = React.useState("");
	const [referenceLabel, setReferenceLabel] = React.useState<string | null>(null);

	React.useEffect(() => {
		if (!editor) return;

		// Get URL immediately on mount
		const { href, title: linkTitle, referenceLabel: reference } = editor.getAttributes("link");

		if (isLinkActive(editor) && url === null) {
			setUrl(href || "");
			setTitle(linkTitle || "");
			setReferenceLabel(reference ?? null);
		}
	}, [editor, url]);

	React.useEffect(() => {
		if (!editor) return;

		const updateLinkState = () => {
			const { href, title: linkTitle, referenceLabel: reference } = editor.getAttributes("link");
			setUrl(href || "");
			setTitle(linkTitle || "");
			setReferenceLabel(reference ?? null);
		};

		editor.on("selectionUpdate", updateLinkState);
		return () => {
			editor.off("selectionUpdate", updateLinkState);
		};
	}, [editor]);

	const setLink = React.useCallback(() => {
		if (!editor) return;
  if (referenceLabel !== null) {
   if (!validReferenceLabel(referenceLabel)) return;
   const old = editor.getAttributes("link");
   editor.chain().focus().extendMarkRange("link").setMark("link", {
    ...old, referenceLabel: normalizeReferenceLabel(referenceLabel),
    referenceSuffix: referenceLabel === old.referenceLabel ? old.referenceSuffix : `[${referenceLabel}]`,
   }).setMeta("preventAutolink", true).run();
   onSetLink?.();
   return;
  }
  if (!url) return;
		if (!editor.can().setLink({ href: url })) return;

		const { selection } = editor.state;
		const isEmpty = selection.empty && !editor.isActive("link");

		let chain = editor.chain().focus();

		chain = chain.extendMarkRange("link").setLink({ href: url, title: title || null });

		if (isEmpty) {
			chain = chain.insertContent({ type: "text", text: url });
		}

		chain.run();

		setUrl(null);

		onSetLink?.();
	}, [editor, onSetLink, url, title, referenceLabel]);

	const removeLink = React.useCallback(() => {
		if (!editor) return;
		editor
			.chain()
			.focus()
			.extendMarkRange("link")
			.unsetLink()
			.setMeta("preventAutolink", true)
			.run();
		setUrl("");
	}, [editor]);

	const editDefinition = React.useCallback(() => {
  if (editor && referenceLabel) focusReferenceDefinition(editor, referenceLabel);
 }, [editor, referenceLabel]);

 const openLink = React.useCallback(
		() => {
			if (url) onOpenLink?.(url);
			else editDefinition();
		},
		[url, onOpenLink, editDefinition],
	);

	return {
		url: url || "",
		referenceLabel, setReferenceLabel, editDefinition,
		setUrl,
		title,
		setTitle,
		setLink,
		removeLink,
		openLink,
		canOpenLink: Boolean((url && onOpenLink) || referenceLabel),
	};
}

/**
 * Custom hook for link popover state management
 */
export function useLinkState(props: {
	editor: Editor | null;
	hideWhenUnavailable: boolean;
}) {
	const { editor, hideWhenUnavailable = false } = props;

	const canSet = canSetLink(editor);
	const isActive = isLinkActive(editor);

	const [isVisible, setIsVisible] = React.useState(false);

	React.useEffect(() => {
		if (!editor) return;

		const handleSelectionUpdate = () => {
			setIsVisible(
				shouldShowLinkButton({
					editor,
					hideWhenUnavailable,
				}),
			);
		};

		handleSelectionUpdate();

		editor.on("selectionUpdate", handleSelectionUpdate);

		return () => {
			editor.off("selectionUpdate", handleSelectionUpdate);
		};
	}, [editor, hideWhenUnavailable]);

	return {
		isVisible,
		canSet,
		isActive,
	};
}

/**
 * Main hook that provides link popover functionality for Tiptap editor
 *
 * @example
 * ```tsx
 * // Simple usage
 * function MyLinkButton() {
 *   const { isVisible, canSet, isActive, Icon, label } = useLinkPopover()
 *
 *   if (!isVisible) return null
 *
 *   return <button disabled={!canSet}>Link</button>
 * }
 *
 * // Advanced usage with configuration
 * function MyAdvancedLinkButton() {
 *   const { isVisible, canSet, isActive, Icon, label } = useLinkPopover({
 *     editor: myEditor,
 *     hideWhenUnavailable: true,
 *     onSetLink: () => console.log('Link set!')
 *   })
 *
 *   if (!isVisible) return null
 *
 *   return (
 *     <MyButton
 *       disabled={!canSet}
 *       aria-label={label}
 *       aria-pressed={isActive}
 *     >
 *       <Icon />
 *       {label}
 *     </MyButton>
 *   )
 * }
 * ```
 */
export function useLinkPopover(config?: UseLinkPopoverConfig) {
	const {
		editor: providedEditor,
		hideWhenUnavailable = false,
		onSetLink,
		onOpenLink,
	} = config || {};

	const { editor } = useTiptapEditor(providedEditor);

	const { isVisible, canSet, isActive } = useLinkState({
		editor,
		hideWhenUnavailable,
	});

	const linkHandler = useLinkHandler({
		editor,
		onSetLink,
		onOpenLink,
	});

	return {
		isVisible,
		canSet,
		isActive,
		label: "Link",
		Icon: LinkIcon,
		...linkHandler,
	};
}
