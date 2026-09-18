import { Renderer } from "@freelensapp/extensions";
import { useEffect, useState } from "react";
import { nodeShellSettings, validateSettings } from "../../common/store/node-shell-settings";
import { loadSettings, saveSettings } from "./settings-client";

export function NodeShellPreferences() {
  const [draft, setDraft] = useState(nodeShellSettings.toJSON());
  const [timeout, setTimeoutValue] = useState(String(draft.timeoutMinutes));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let mounted = true;
    void loadSettings()
      .then((settings) => {
        if (mounted) {
          setDraft(settings);
          setTimeoutValue(String(settings.timeoutMinutes));
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
    const settings = { ...draft, timeoutMinutes: Number(timeout) };
    const error = validateSettings(settings);
    if (error) {
      setMessage(error);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const saved = await saveSettings(settings);
      setDraft(saved);
      setTimeoutValue(String(saved.timeoutMinutes));
      setMessage(`Saved. New sessions will use a ${saved.timeoutMinutes} minute timeout.`);
    } catch (error) {
      setMessage(`Failed to save settings: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "grid", gap: 24, width: "100%" }}>
      {[
        { label: "Namespace", field: "namespace" as const },
        { label: "Container image", field: "image" as const },
        { label: "Pod prefix", field: "podPrefix" as const },
      ].map(({ label, field }) => (
        <div key={field} style={{ display: "grid", gap: 8 }}>
          <div style={{ textTransform: "uppercase", fontSize: 12, fontWeight: 600 }}>{label}</div>
          <Renderer.Component.Input
            aria-label={label}
            disabled={busy || !loaded}
            value={draft[field]}
            onChange={(value) => setDraft({ ...draft, [field]: value })}
          />
        </div>
      ))}
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ textTransform: "uppercase", fontSize: 12, fontWeight: 600 }}>Session timeout (minutes)</div>
        <Renderer.Component.Input
          aria-label="Session timeout (minutes)"
          disabled={busy || !loaded}
          type="number"
          min={1}
          max={1440}
          value={timeout}
          onChange={setTimeoutValue}
        />
        <small>Maximum session duration, including active use. Default: 60 minutes. Applies to new sessions.</small>
      </div>
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
