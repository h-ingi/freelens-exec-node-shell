import { Renderer } from "@freelensapp/extensions";
import { useEffect, useState } from "react";
import { nodeShellSettings, validateSettings } from "../../common/store/node-shell-settings";
import { loadSettings, saveSettings } from "./settings-client";

export function NodeShellPreferences() {
  const [draft, setDraft] = useState(nodeShellSettings.toJSON());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let mounted = true;
    void loadSettings()
      .then((settings) => {
        if (mounted) {
          setDraft(settings);
          setLoaded(true);
        }
      })
      .catch((error: unknown) => {
        if (mounted) setMessage(`Failed to load settings: ${String(error)}`);
      })
      .finally(() => {
        if (mounted) setBusy(false);
      });
    return () => {
      mounted = false;
    };
  }, []);
  const save = async () => {
    const error = validateSettings(draft);
    if (error) {
      setMessage(error);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const saved = await saveSettings(draft);
      setDraft(saved);
      setMessage(`Saved. New sessions will use a ${saved.timeoutMinutes} minute timeout.`);
    } catch (error) {
      setMessage(`Failed to save settings: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
      <label>
        Namespace
        <input
          disabled={busy || !loaded}
          value={draft.namespace}
          onChange={(event) => setDraft({ ...draft, namespace: event.target.value })}
        />
      </label>
      <label>
        Container image
        <input
          disabled={busy || !loaded}
          value={draft.image}
          onChange={(event) => setDraft({ ...draft, image: event.target.value })}
        />
      </label>
      <label>
        Session timeout (minutes)
        <input
          disabled={busy || !loaded}
          type="number"
          min={1}
          max={1440}
          value={draft.timeoutMinutes}
          onChange={(event) => setDraft({ ...draft, timeoutMinutes: Number(event.target.value) })}
        />
      </label>
      <label>
        Pod prefix
        <input
          disabled={busy || !loaded}
          value={draft.podPrefix}
          onChange={(event) => setDraft({ ...draft, podPrefix: event.target.value })}
        />
      </label>
      <Renderer.Component.Button
        label={busy ? "Please wait…" : "Save"}
        disabled={busy || !loaded}
        onClick={() => {
          void save();
        }}
      />
      <p role="status">{message}</p>
    </div>
  );
}

export const NodeShellPreferenceHint = () => (
  <span>PowerShell 5.1 terminal; Linux nodes. Existing sessions retain their original settings.</span>
);
