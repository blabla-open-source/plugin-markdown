export type HostMenuItem =
	| {
			type: "item";
			actionId: string;
			label: string;
			icon?: string;
			checked?: boolean;
			disabled?: boolean;
			itemType?: "checkbox" | "radio";
			accelerator?: string;
	  }
	| { type: "separator" }
	| { type: "submenu"; label: string; icon?: string; items: HostMenuItem[] };
export interface HostMenuApi {
	popup(input: {
		items: HostMenuItem[];
		position: { x: number; y: number };
	}): Promise<{ actionId: string | null; active: boolean }>;
}
