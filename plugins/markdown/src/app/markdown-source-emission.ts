import type { MarkdownSourceBlock } from "./markdown-source-blocks";

export interface MarkdownEmittedBlock extends MarkdownSourceBlock { nodeIndex: number }

/** Coordinates are written by the same operations that assemble source bytes. */
export class MarkdownSourceEmission {
	markdown = "";
	readonly blocks: MarkdownEmittedBlock[] = [];

	separator(value: string): void {
		const previous = this.blocks.at(-1);
		this.markdown += value;
		if (previous?.synthetic && previous.start === previous.end) previous.end = this.markdown.length;
	}

	block(nodeIndex: number, source: string, synthetic = false): void {
		const start = this.markdown.length;
		this.markdown += source;
		this.blocks.push({ nodeIndex, start, end: this.markdown.length, ...(synthetic ? { synthetic: true } : {}) });
	}

	prepend(value: string): void {
		this.markdown = value + this.markdown;
		for (const block of this.blocks) { block.start += value.length; block.end += value.length; }
	}

	truncate(end: number): void {
		this.markdown = this.markdown.slice(0, end);
		for (const block of this.blocks) { block.start = Math.min(block.start, end); block.end = Math.min(block.end, end); }
	}

	lineEndings(lineBreak: string): void {
		const breaks = [...this.markdown.matchAll(/\r\n|\r|\n/g)];
		const deltas = [0];
		for (const match of breaks) deltas.push(deltas.at(-1)! + lineBreak.length - match[0].length);
		const map = (offset: number) => {
			let low = 0, high = breaks.length;
			while (low < high) {
				const middle = (low + high) >>> 1;
				if (breaks[middle]!.index < offset) low = middle + 1;
				else high = middle;
			}
			return offset + deltas[low]!;
		};
		for (const block of this.blocks) { block.start = map(block.start); block.end = map(block.end); }
		this.markdown = this.markdown.replace(/\r\n|\r|\n/g, lineBreak);
	}
}
