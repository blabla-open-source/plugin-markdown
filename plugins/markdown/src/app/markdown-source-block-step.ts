import { type Node, type Schema, Slice } from "@tiptap/pm/model";
import { type Mappable, ReplaceStep, Step, StepMap } from "@tiptap/pm/transform";

export type ColorSourceSplit = {
	paragraph: boolean;
	source: string;
	anchor: number;
	head: number;
	after: number;
};

/** A source edit owns its parent block, including changes to the block's kind.
 * Outward endpoints retain that span through non-history view replacements. */
export class MarkdownSourceBlockStep extends Step {
	private positionMap: StepMap | null = null;
	constructor(
		private readonly inner: ReplaceStep,
		readonly split?: ColorSourceSplit & { offset: number; undo: boolean },
		private readonly presentation = false,
	) {
		super();
	}
	get sourcePosition() {
		return this.inner.from + 1 + (this.split?.offset ?? 0);
	}
	apply(doc: Node) {
		const result = this.inner.apply(doc);
		this.positionMap = this.inner.getMap();
		const before = doc.nodeAt(this.inner.from);
		const after = this.inner.slice.content.firstChild;
		// Content edits retain ReplaceStep's invertible map. Only non-history
		// presentation replacements project inline positions through syntax;
		// changing a history Step's range shape would break mirror recovery.
		if (this.presentation && result.doc && before?.isTextblock && after?.isTextblock &&
			this.inner.to === this.inner.from + before.nodeSize &&
			this.inner.slice.openStart === 0 && this.inner.slice.openEnd === 0 &&
			this.inner.slice.content.childCount === 1) {
			const text = before.content.textBetween(0, before.content.size, "", "\ufffc");
			// The parsed block kind owns its syntax prefix. Equal text elsewhere
			// in the block (including a literal #) is not its source position.
			const prefix = after.type.name === "heading"
				? /^ {0,3}#{1,6}[ \t]*/.exec(text)?.[0]
				: ["linkDefinition", "footnoteDefinition"].includes(after.type.name)
					? /^ {0,3}\[[^\]\r\n]+\]:[ \t]*/.exec(text)?.[0]
					: "";
			const offset = prefix?.length ?? -1;
			if (offset >= 0 && before.content.cut(offset, offset + after.content.size).eq(after.content)) {
				this.positionMap = new StepMap([
					this.inner.from + 1, offset, 0,
					this.inner.from + 1 + offset + after.content.size,
					before.content.size - offset - after.content.size, 0,
				]);
				return result;
			}
			const start = before.content.findDiffStart(after.content);
			const end = before.content.findDiffEnd(after.content);
			if (start === null || !end) this.positionMap = StepMap.empty;
			else {
				const overlap = Math.max(0, start - Math.min(end.a, end.b));
				this.positionMap = new StepMap([
					this.inner.from + 1 + start,
					end.a + overlap - start,
					end.b + overlap - start,
				]);
			}
		}
		return result;
	}
	getMap() {
		return this.positionMap ?? this.inner.getMap();
	}
	invert(doc: Node) {
		return new MarkdownSourceBlockStep(
			this.inner.invert(doc),
			this.split ? { ...this.split, undo: !this.split.undo } : undefined,
			this.presentation,
		);
	}
	map(mapping: Mappable) {
		const from = mapping.mapResult(this.inner.from, -1);
		const to = mapping.mapResult(this.inner.to, 1);
		return from.deletedAcross && to.deletedAcross
			? null
			: new MarkdownSourceBlockStep(
					new ReplaceStep(
						from.pos,
						Math.max(from.pos, to.pos),
						this.inner.slice,
					),
					this.split,
					this.presentation,
				);
	}
	toJSON() {
		return {
			...this.inner.toJSON(),
			stepType: "markdownColorSource",
			...(this.split ? { split: this.split } : {}),
			...(this.presentation ? { presentation: true } : {}),
		};
	}
	static fromJSON(
		schema: Schema,
		json: {
			from: number;
			to: number;
			slice?: unknown;
			split?: MarkdownSourceBlockStep["split"];
			presentation?: boolean;
		},
	) {
		return new MarkdownSourceBlockStep(
			new ReplaceStep(json.from, json.to, Slice.fromJSON(schema, json.slice)),
			json.split,
			json.presentation === true,
		);
	}
}
Step.jsonID("markdownColorSource", MarkdownSourceBlockStep);
