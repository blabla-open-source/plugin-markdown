import type { TableOfContentData } from "@tiptap/extension-table-of-contents";
import { type Editor, EditorContent } from "@tiptap/react";
import { type RefObject, useCallback, useEffect } from "react";

export type MarkdownTableOfContentsItem = {
	dom: HTMLHeadingElement;
	id: string;
	level: HeadingLevel;
	sectionRatio: number;
	title: string;
};

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export function MarkdownEditorSurface({
	editor,
	items,
	shellRef,
}: {
	editor: Editor | null;
	items: TableOfContentData;
	shellRef: RefObject<HTMLElement | null>;
}) {
	useTableOfContentsScrollState(editor);

	const selectItem = useCallback(
		(item: MarkdownTableOfContentsItem) => {
			scrollToTableOfContentsItem(item, shellRef.current);
		},
		[shellRef],
	);

	return (
		<section
			className="editor-shell"
			data-testid="markdown-document-scroll"
			onScroll={() => editor?.storage.tableOfContents.scrollHandler()}
			ref={shellRef}
		>
			<EditorContent
				className="simple-editor-content markdown-editor-content"
				editor={editor}
				role="presentation"
			/>
			<MarkdownTableOfContents
				items={items}
				onSelect={selectItem}
				scrollContainer={shellRef.current}
			/>
		</section>
	);
}

export function MarkdownTableOfContents({
	items,
	onSelect,
	scrollContainer,
}: {
	items: TableOfContentData;
	onSelect: (item: MarkdownTableOfContentsItem) => void;
	scrollContainer: HTMLElement | null;
}) {
	if (!(items.length > 0 && scrollContainer)) {
		return null;
	}

	const outlineItems = createOutlineItems(items, scrollContainer);
	if (outlineItems.length === 0) {
		return null;
	}

	const activeId = activeTableOfContentsItemId(outlineItems, scrollContainer);
	const maxSectionRatio = Math.max(
		...outlineItems.map((item) => item.sectionRatio),
		1 / outlineItems.length,
	);

	return (
		<nav
			aria-label="Document outline"
			className="markdown-outline-rail"
			data-testid="markdown-outline-rail"
		>
			<div className="markdown-outline-rail-hitbox">
				<MarkdownOutlinePanel
					activeId={activeId}
					items={outlineItems}
					onSelect={onSelect}
				/>
				<div className="markdown-outline-tick-list">
					{outlineItems.map((item) => {
						const active = item.id === activeId;
						const tickWidth = outlineTickWidth(
							item.sectionRatio,
							maxSectionRatio,
						);

						return (
							<button
								aria-current={active ? "location" : undefined}
								aria-label={`Jump to ${item.title}`}
								className="markdown-outline-tick"
								data-active={active ? "true" : "false"}
								data-heading-level={item.level}
								data-section-ratio={item.sectionRatio.toFixed(4)}
								data-testid="markdown-outline-tick"
								key={item.id}
								onClick={() => onSelect(item)}
								type="button"
							>
								<span style={{ width: tickWidth }} />
							</button>
						);
					})}
				</div>
			</div>
		</nav>
	);
}

function MarkdownOutlinePanel({
	activeId,
	items,
	onSelect,
}: {
	activeId: string | null;
	items: MarkdownTableOfContentsItem[];
	onSelect: (item: MarkdownTableOfContentsItem) => void;
}) {
	return (
		<div
			aria-label="Document outline"
			className="markdown-outline-panel"
			data-testid="markdown-outline-panel"
			role="dialog"
		>
			<div className="markdown-outline-panel-card">
				<div className="markdown-outline-panel-scroll">
					{items.map((item) => {
						const active = item.id === activeId;

						return (
							<button
								aria-current={active ? "location" : undefined}
								aria-label={`Jump to ${item.title}`}
								className="markdown-outline-panel-row"
								data-active={active ? "true" : "false"}
								data-heading-level={item.level}
								data-testid="markdown-outline-panel-item"
								key={item.id}
								onClick={() => onSelect(item)}
								type="button"
							>
								{item.title}
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
}

function createOutlineItems(
	items: TableOfContentData,
	scrollContainer: HTMLElement,
): MarkdownTableOfContentsItem[] {
	const liveItems = liveTableOfContentsItems(items, scrollContainer);
	const headingTops = itemTops(liveItems, scrollContainer);
	const timelineStart = headingTops[0] ?? 0;
	const timelineEnd = Math.max(scrollContainer.scrollHeight, timelineStart + 1);
	const timelineLength = timelineEnd - timelineStart;

	return liveItems.map((item, index) => {
		const startTop = headingTops[index] ?? timelineStart;
		const nextTop = headingTops[index + 1] ?? timelineEnd;
		const sectionLength = Math.max(1, nextTop - startTop);

		return {
			dom: item.dom,
			id: item.id,
			level: item.level,
			sectionRatio: clampNumber(sectionLength / timelineLength, 0, 1),
			title: item.title,
		};
	});
}

type LiveTableOfContentsItem = {
	dom: HTMLHeadingElement;
	id: string;
	level: HeadingLevel;
	title: string;
};

function liveTableOfContentsItems(
	items: TableOfContentData,
	scrollContainer: HTMLElement,
): LiveTableOfContentsItem[] {
	// The official index owns membership, order, labels and heading identity.
	// DOM is used only to measure the indexed headings in this scroll surface.
	return items.filter((item) => scrollContainer.contains(item.dom)).map((item) => ({
		dom: item.dom,
		id: item.id,
		level: outlineLevel(item.level),
		title: item.textContent.trim(),
	}));
}

function itemTops(
	items: LiveTableOfContentsItem[],
	scrollContainer: HTMLElement,
): number[] {
	const containerRect = scrollContainer.getBoundingClientRect();
	return items.map(
		(item) =>
			scrollContainer.scrollTop +
			item.dom.getBoundingClientRect().top -
			containerRect.top,
	);
}

function activeTableOfContentsItemId(
	items: MarkdownTableOfContentsItem[],
	scrollContainer: HTMLElement,
): string | null {
	const containerRect = scrollContainer.getBoundingClientRect();
	const readingLineY =
		containerRect.top +
		Math.min(220, Math.max(96, containerRect.height * 0.24));
	let activeId = items[0]?.id ?? null;

	for (const item of items) {
		if (item.dom.getBoundingClientRect().top <= readingLineY) {
			activeId = item.id;
		}
	}

	return activeId;
}

function outlineLevel(level: number): HeadingLevel {
	if (level <= 1) {
		return 1;
	}
	if (level >= 6) {
		return 6;
	}
	return level as HeadingLevel;
}

function useTableOfContentsScrollState(editor: Editor | null): void {
	useEffect(() => {
		if (!editor) {
			return;
		}

		const updateScrollState = () => {
			editor.storage.tableOfContents.scrollHandler();
		};

		const frame = window.requestAnimationFrame(updateScrollState);
		return () => window.cancelAnimationFrame(frame);
	}, [editor]);
}

function scrollToTableOfContentsItem(
	item: MarkdownTableOfContentsItem,
	scrollParent: HTMLElement | null,
): void {
	if (!scrollParent) {
		item.dom.scrollIntoView({ behavior: "instant", block: "start" });
		return;
	}

	const parentRect = scrollParent.getBoundingClientRect();
	const headingRect = item.dom.getBoundingClientRect();
	const targetTop =
		scrollParent.scrollTop + headingRect.top - parentRect.top - 96;

	scrollParent.scrollTop = Math.max(0, targetTop);
}

function outlineTickWidth(
	sectionRatio: number,
	maxSectionRatio: number,
): number {
	if (maxSectionRatio <= 0) {
		return 14;
	}

	return Math.round(7 + (sectionRatio / maxSectionRatio) * 7);
}

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
