import { Renderer } from "@freelensapp/extensions";
import { runInAction } from "mobx";
import { useState } from "react";
import { nodeShellSettings, validateSettings } from "../../common/store/node-shell-settings";

export function NodeShellPreferences() {
  const [draft, setDraft] = useState(nodeShellSettings.toJSON());
  const [message, setMessage] = useState("");
  const save = () => {
    const error = validateSettings(draft);
    if (error) {
      setMessage(error);
      return;
    }
    runInAction(() => {
      nodeShellSettings.settings = {
        ...draft,
        knownNamespaces: [...new Set([...nodeShellSettings.settings.knownNamespaces, draft.namespace])],
      };
    });
    setMessage("Saved. New sessions will use these settings.");
  };
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
      <label>
        Namespace
        <input value={draft.namespace} onChange={(event) => setDraft({ ...draft, namespace: event.target.value })} />
      </label>
      <label>
        Container image
        <input value={draft.image} onChange={(event) => setDraft({ ...draft, image: event.target.value })} />
      </label>
      <label>
        Session timeout (minutes)
        <input
          type="number"
          min={1}
          max={1440}
          value={draft.timeoutMinutes}
          onChange={(event) => setDraft({ ...draft, timeoutMinutes: Number(event.target.value) })}
        />
      </label>
      <label>
        Pod prefix
        <input value={draft.podPrefix} onChange={(event) => setDraft({ ...draft, podPrefix: event.target.value })} />
      </label>
      <Renderer.Component.Button label="Save" onClick={save} />
      <p role="status">{message}</p>
    </div>
  );
}

export const NodeShellPreferenceHint = () => (
  <span>PowerShell 5.1 terminal; Linux nodes. Existing sessions retain their original settings.</span>
);
