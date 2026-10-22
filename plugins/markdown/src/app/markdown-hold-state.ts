/**
 * Which library switch holds the editor, if any. A hold freezes the editor
 * only at the moment it is ready to, and not at all when the Host released
 * it before that: a late hold never freezes an editor the Host gave up on,
 * and never touches a newer hold.
 */
export class MarkdownHoldState {
	private held: string | null = null;
	// Releases that came before their hold froze the editor.
	private readonly released = new Set<string>();

	get active(): boolean {
		return this.held !== null;
	}

	/** Freezes for `switchId` unless it was released meanwhile. */
	freeze(switchId: string): boolean {
		if (this.released.delete(switchId)) return false;
		this.held = switchId;
		return true;
	}

	holds(switchId: string): boolean {
		return this.held === switchId;
	}

	/** True when this ended the hold; otherwise remembered for its freeze. */
	release(switchId: string): boolean {
		if (this.held === switchId) {
			this.held = null;
			return true;
		}
		this.released.add(switchId);
		return false;
	}

	/** A held editor accepts no change to its content or field drafts. */
	accepts(change: { docChanged: boolean; fieldDraftChanged: boolean }): boolean {
		return this.held === null || !(change.docChanged || change.fieldDraftChanged);
	}
}
