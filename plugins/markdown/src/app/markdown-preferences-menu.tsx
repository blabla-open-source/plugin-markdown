import { SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/tiptap-ui-primitive/button";

import {
  type MarkdownPreferencesDialogProps,
  preferencesDialogState,
  preferencesDialogPatch,
} from "./markdown-preferences-dialog-model";
import { useToolCopy } from "./markdown-tool-copy";

export function MarkdownPreferencesMenu(props: MarkdownPreferencesDialogProps) {
  const t = useToolCopy();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);
  const [ack, setAck] = useState(0);
  const latest = useRef({ props, t });
  latest.current = { props, t };
  const state = JSON.stringify(
    preferencesDialogState({ ...props, error: error ?? props.error }, t)
  );
  const api = window.blablaHost?.settingsDialog;
  if (!api) throw new Error("Host settings dialog is unavailable.");
  useEffect(() => {
    if (!sessionId) {
      return;
    }
    const subscription = api.onAction(async (event) => {
      if (event.sessionId !== sessionId) {
        return;
      }
      const action = event.action;
      if (action.type === "cancel") {
        try {
          await api.sync({sessionId, acknowledgedActionId: event.actionId, state: null});
          setSessionId(null);
        } catch {
          setError("Could not close settings. Try again.");
          setAck(event.actionId);
        }
        return;
      }
      setError(undefined);
      try {
        if (action.type === "complete") {
          const patches = action.changes.map(change => preferencesDialogPatch(latest.current.props, latest.current.t, { type: "change", ...change }));
          if (patches.some(patch => !patch)) throw new Error("Could not save preferences. Try again.");
          const saved = !patches.length || await latest.current.props.onChange(Object.assign({}, ...patches));
          if (saved) {
            await api.sync({ sessionId, acknowledgedActionId: event.actionId, state: null });
            setSessionId(null);
          }
        } else if (action.type === "apply") {
          await latest.current.props.onApply(async () => {
            await api.sync({ sessionId, acknowledgedActionId: event.actionId, state: null });
            setSessionId(null);
          });
        } else if (action.type === "change") {
          const patch = preferencesDialogPatch(latest.current.props, latest.current.t, action);
          if (patch) await latest.current.props.onChange(patch);
        }
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not save preferences. Try again."
        );
      } finally {
        setAck(event.actionId);
      }
    });
    return () => {
      subscription.dispose();
      api
        .sync({ sessionId, acknowledgedActionId: 0, state: null })
        .catch((cause) => console.warn("Settings dialog cleanup failed", cause));
    };
  }, [api, sessionId]);
  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let disposed = false;
    api
      .sync({ sessionId, acknowledgedActionId: ack, state: JSON.parse(state) })
      .then(() => {
        if (!disposed) {
          setReady(true);
        }
      })
      .catch(() => {
        if (disposed) return;
        setError("Could not open settings. Try again.");
        setSessionId(null);
      });
    return () => {
      disposed = true;
    };
  }, [api, sessionId, state, ack]);
  return (
    <>
      <Button
        aria-expanded={!!sessionId && ready}
        aria-haspopup="dialog"
        aria-label={t("Markdown preferences")}
        data-style="ghost"
        onClick={() => {
          setError(undefined);
          setReady(false);
          setAck(0);
          setSessionId(crypto.randomUUID());
        }}
        onMouseDown={(event) => event.preventDefault()}
        tooltip={t("Markdown preferences")}
        type="button"
      >
        <SlidersHorizontal className="tiptap-button-icon" />
      </Button>
      {!sessionId && (error || props.error) && (
        <span role="alert">{t((error || props.error) as Parameters<typeof t>[0])}</span>
      )}
    </>
  );
}
