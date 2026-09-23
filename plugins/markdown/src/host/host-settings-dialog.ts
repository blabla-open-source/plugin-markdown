export type HostSettingsField = {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
} & (
  | { type: "checkbox"; value: boolean }
  | {
      type: "select";
      value: string;
      options: { value: string; label: string }[];
    }
  | { type: "text"; value: string; placeholder?: string }
);
export interface HostSettingsState {
  apply?: { label: string; description: string };
  busy: boolean;
  description: string;
  doneLabel: string;
  error?: string;
  sections: {
    id: string;
    title: string;
    description?: string;
    fields: HostSettingsField[];
  }[];
  title: string;
}
export type HostSettingsAction =
  | { type: "cancel" | "apply" }
  | { type: "complete"; changes: { id: string; value: string }[] }
  | { type: "change"; id: string; value: string | boolean };
export interface HostSettingsDialogApi {
  onAction(
    listener: (event: {
      sessionId: string;
      actionId: number;
      action: HostSettingsAction;
    }) => void
  ): { dispose(): void };
  sync(input: {
    sessionId: string;
    acknowledgedActionId: number;
    state: HostSettingsState | null;
  }): Promise<void>;
}
