import { markdownMenuFinalFocus } from "@/app/markdown-menu-focus";
import { useToolCopy } from "@/app/markdown-tool-copy";
import { Menu } from "@base-ui/react/menu";
"use client";

import { validReferenceLabel } from "@/app/markdown-grammar";
import type { Editor } from "@tiptap/react";
import { isAllowedUri } from "@tiptap/extension-link";
import * as React from "react";
// --- Icons ---
import { CornerDownLeftIcon } from "@/components/tiptap-icons/corner-down-left-icon";
import { ExternalLinkIcon } from "@/components/tiptap-icons/external-link-icon";
import { LinkIcon } from "@/components/tiptap-icons/link-icon";
import { TrashIcon } from "@/components/tiptap-icons/trash-icon";
// --- Tiptap UI ---
import type { UseLinkPopoverConfig } from "@/components/tiptap-ui/link-popover";
import { useLinkPopover } from "@/components/tiptap-ui/link-popover";
// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button";
import { Button, ButtonGroup } from "@/components/tiptap-ui-primitive/button";
import {
	Card,
	CardBody,
	CardItemGroup,
} from "@/components/tiptap-ui-primitive/card";
import { Input, InputGroup } from "@/components/tiptap-ui-primitive/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/tiptap-ui-primitive/popover";
import { Separator } from "@/components/tiptap-ui-primitive/separator";
// --- Hooks ---
import { useIsMobile } from "@/hooks/use-mobile";
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";

export interface LinkMainProps {
	canOpenLink: boolean;
	referenceLabel: string | null;
	setReferenceLabel: React.Dispatch<React.SetStateAction<string | null>>;
	editDefinition: () => void;
	/**
	 * The URL to set for the link.
	 */
	url: string;
	/**
	 * Function to update the URL state.
	 */
	setUrl: React.Dispatch<React.SetStateAction<string | null>>;
	title: string;
	setTitle: React.Dispatch<React.SetStateAction<string>>;
	/**
	 * Function to set the link in the editor.
	 */
	setLink: () => void;
	/**
	 * Function to remove the link from the editor.
	 */
	removeLink: () => void;
	/**
	 * Function to open the link.
	 */
	openLink: () => void;
	/**
	 * Whether the link is currently active in the editor.
	 */
	isActive: boolean;
}

export interface LinkPopoverProps
	extends Omit<ButtonProps, "type">,
		UseLinkPopoverConfig {
	/**
	 * Callback for when the popover opens or closes.
	 */
	onOpenChange?: (isOpen: boolean) => void;
	/**
	 * Whether to automatically open the popover when a link is active.
	 * @default true
	 */
	autoOpenOnLinkActive?: boolean;
 menuLabel?: string;
}

/**
 * Link button component for triggering the link popover
 */
export const LinkButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, children, ...props }, ref) => {
		const t = useToolCopy();
		return (
			<Button
				type="button"
				className={className}
				data-style="ghost"
				role="button"
				tabIndex={-1}
				aria-label={t("Link")}
				tooltip={t("Link")}
				ref={ref}
				{...props}
			>
				{children || <LinkIcon className="tiptap-button-icon" />}
			</Button>
		);
	},
);

LinkButton.displayName = "LinkButton";

/**
 * Main content component for the link popover
 */
const LinkMain: React.FC<LinkMainProps> = ({
	referenceLabel, setReferenceLabel, editDefinition,
	url,
	setUrl,
	title,
	setTitle,
	setLink,
	removeLink,
	openLink,
	canOpenLink,
	isActive,
}) => {
	const isMobile = useIsMobile();
	const invalidAddress = Boolean(url) && !isAllowedUri(url);
	const t = useToolCopy();
 const canApply = referenceLabel !== null ? validReferenceLabel(referenceLabel) : Boolean(url) && !invalidAddress;

	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === "Enter") {
			event.preventDefault();
			if (canApply) setLink();
		}
	};

	return (
		<Card
			style={{
				...(isMobile ? { boxShadow: "none", border: 0 } : {}),
			}}
		>
			<CardBody
				style={{
					...(isMobile ? { padding: 0 } : {}),
				}}
			>
				{referenceLabel !== null && <label>
     {t("Reference label")}
     <Input aria-label={t("Reference label")} value={referenceLabel}
      aria-invalid={!validReferenceLabel(referenceLabel) || undefined}
      onChange={event => setReferenceLabel(event.target.value)} onKeyDown={handleKeyDown} />
    </label>}
    <CardItemGroup orientation="horizontal">
					<InputGroup>
						<Input
							type="text"
							aria-label={t("Link address")}
							readOnly={referenceLabel !== null}
							aria-invalid={invalidAddress || undefined}
							placeholder={t("Paste a link...")}
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							onKeyDown={handleKeyDown}
							autoFocus
							autoComplete="off"
							autoCorrect="off"
							autoCapitalize="off"
						/>
					</InputGroup>

					<ButtonGroup orientation="horizontal">
						<Button
							type="button"
							onClick={setLink}
							title={t("Apply link")}
							disabled={!canApply}
							data-style="ghost"
						>
							<CornerDownLeftIcon className="tiptap-button-icon" />
						</Button>
					</ButtonGroup>

					<Separator />

					<ButtonGroup orientation="horizontal">
						<Button
							type="button"
							onClick={openLink}
							title={t("Open in Blabla")}
							aria-label={t("Open in Blabla")}
							disabled={!canOpenLink}
							data-style="ghost"
						>
							<ExternalLinkIcon className="tiptap-button-icon" />
						</Button>

						<Button
							type="button"
							onClick={removeLink}
							title={t("Remove link")}
							disabled={!url && !isActive}
							data-style="ghost"
						>
							<TrashIcon className="tiptap-button-icon" />
						</Button>
					</ButtonGroup>
				</CardItemGroup>
				<InputGroup>
					<Input
						aria-label={t("Link title")}
						readOnly={referenceLabel !== null}
						placeholder={t("Title (optional)")}
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						onKeyDown={handleKeyDown}
					/>
				</InputGroup>
				{referenceLabel !== null && <Button type="button" onClick={editDefinition}>{t("Edit definition")}</Button>}
    {referenceLabel !== null && !validReferenceLabel(referenceLabel) && <p role="alert">{t("Enter a label without brackets.")}</p>}
    {invalidAddress && <p role="alert">{t("Unsupported link address.")}</p>}
			</CardBody>
		</Card>
	);
};

/**
 * Link content component for standalone use
 */
export const LinkContent: React.FC<{
	editor?: Editor | null;
	onOpenLink?: (url: string) => void;
}> = ({ editor, onOpenLink }) => {
	const linkPopover = useLinkPopover({
		editor,
		onOpenLink,
	});

	return <LinkMain {...linkPopover} />;
};

/**
 * Link popover component for Tiptap editors.
 *
 * For custom popover implementations, use the `useLinkPopover` hook instead.
 */
export const LinkPopover = React.forwardRef<
	HTMLButtonElement,
	LinkPopoverProps
>(
	(
		{
			editor: providedEditor,
			hideWhenUnavailable = false,
			onSetLink,
			onOpenLink,
			onOpenChange,
			autoOpenOnLinkActive = true,
 menuLabel,
			onClick,
			children,
			...buttonProps
		},
		ref,
	) => {
		const t = useToolCopy();
 const { editor } = useTiptapEditor(providedEditor);
		const [isOpen, setIsOpen] = React.useState(false);


		const {
			referenceLabel, setReferenceLabel, editDefinition,
			isVisible,
			canSet,
			isActive,
			url,
			setUrl,
			title,
			setTitle,
			setLink,
			removeLink,
			openLink,
			canOpenLink,
			Icon,
		} = useLinkPopover({
			editor,
			hideWhenUnavailable,
			onSetLink,
			onOpenLink,
		});

		const handleOnOpenChange = React.useCallback(
			(nextIsOpen: boolean) => {
				setIsOpen(nextIsOpen);
				onOpenChange?.(nextIsOpen);
			},
			[onOpenChange],
		);

		const handleSetLink = React.useCallback(() => {

			setLink();
			setIsOpen(false);
		}, [setLink]);

		const handleClick = React.useCallback(
			(event: React.MouseEvent<HTMLButtonElement>) => {
				onClick?.(event);
				if (event.defaultPrevented) return;
				setIsOpen(!isOpen);
			},
			[onClick, isOpen],
		);

		React.useEffect(() => {
			if (autoOpenOnLinkActive && isActive) {
				setIsOpen(true);
			}
		}, [autoOpenOnLinkActive, isActive]);

		if (!isVisible) {
			return null;
		}

		return (
			<Popover open={isOpen} onOpenChange={handleOnOpenChange}>
				<PopoverTrigger render={menuLabel ? <Menu.Item aria-label={menuLabel} disabled={!canSet} closeOnClick={false} className="markdown-command-item">{menuLabel}</Menu.Item> : <LinkButton
						disabled={!canSet}
						data-active-state={isActive ? "on" : "off"}
						data-disabled={!canSet}
						aria-label={t("Link")}
						aria-pressed={isActive}
						onClick={handleClick}
						{...buttonProps}
						ref={ref}
					>
						{children ?? <Icon className="tiptap-button-icon" />}
					</LinkButton>} />

				<PopoverContent

     finalFocus={(interaction) => markdownMenuFinalFocus(editor, interaction)}
    >
					<LinkMain
      referenceLabel={referenceLabel}
      setReferenceLabel={setReferenceLabel}
      editDefinition={() => { setIsOpen(false); requestAnimationFrame(editDefinition); }}
      url={url}
						setUrl={setUrl}
						title={title}
						setTitle={setTitle}
						setLink={handleSetLink}
						removeLink={removeLink}
						openLink={openLink}
						canOpenLink={canOpenLink}
						isActive={isActive}
					/>
				</PopoverContent>
			</Popover>
		);
	},
);

LinkPopover.displayName = "LinkPopover";

export default LinkPopover;
