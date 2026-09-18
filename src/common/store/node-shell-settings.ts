import { Common } from "@freelensapp/extensions";
import { action, makeObservable, observable } from "mobx";

export interface NodeShellSettings {
  namespace: string;
  image: string;
  timeoutMinutes: number;
  podPrefix: string;
  knownNamespaces: string[];
}

export const defaults: NodeShellSettings = {
  namespace: "kube-system",
  image: "docker.io/library/alpine",
  timeoutMinutes: 60,
  podPrefix: "node-shell-exec",
  knownNamespaces: ["kube-system"],
};

export function validateSettings(settings: NodeShellSettings): string | undefined {
  const dnsLabel = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;
  if (!dnsLabel.test(settings.namespace) || settings.namespace.length > 63)
    return "Namespace must be a DNS label (1~63 characters).";
  if (!dnsLabel.test(settings.podPrefix) || settings.podPrefix.length > 26)
    return "Pod prefix must be a DNS label (1~26 characters).";
  if (!settings.image.trim() || /\s/.test(settings.image))
    return "Container image must be nonempty and contain no whitespace.";
  if (!Number.isInteger(settings.timeoutMinutes) || settings.timeoutMinutes < 1 || settings.timeoutMinutes > 1440)
    return "Session timeout must be 1~1440 whole minutes.";
  return undefined;
}

// Copy only the supported scalar fields and array values, never reactive proxies
// or extra properties supplied by a host wrapper or an older config file.
export function settingsSnapshot(value: unknown): NodeShellSettings {
  if (!value || typeof value !== "object") throw new Error("Settings must be an object.");
  const source = value as Partial<NodeShellSettings>;
  if (
    typeof source.namespace !== "string" ||
    typeof source.image !== "string" ||
    typeof source.timeoutMinutes !== "number" ||
    typeof source.podPrefix !== "string" ||
    !Array.isArray(source.knownNamespaces) ||
    !source.knownNamespaces.every((item) => typeof item === "string")
  ) {
    throw new Error("Settings contain missing or invalid fields.");
  }
  const snapshot: NodeShellSettings = {
    namespace: source.namespace,
    image: source.image,
    timeoutMinutes: source.timeoutMinutes,
    podPrefix: source.podPrefix,
    knownNamespaces: Array.from(source.knownNamespaces),
  };
  const error = validateSettings(snapshot);
  if (error) throw new Error(error);
  return snapshot;
}

export function encodeSettings(settings: unknown): string {
  return JSON.stringify(settingsSnapshot(settings));
}

export function decodeSettings(payload: unknown): NodeShellSettings {
  if (typeof payload !== "string") throw new Error("Settings IPC response must be JSON text.");
  return settingsSnapshot(JSON.parse(payload));
}

export class NodeShellSettingsStore extends Common.Store.ExtensionStore<NodeShellSettings> {
  settings: NodeShellSettings = { ...defaults };

  constructor() {
    super({ configName: "node-shell-settings", defaults });
    makeObservable(this, { settings: observable, fromStore: action });
  }

  fromStore(data: Partial<NodeShellSettings>): void {
    try {
      this.settings = settingsSnapshot({ ...defaults, ...data });
    } catch {
      this.settings = settingsSnapshot(defaults);
    }
  }

  toJSON(): NodeShellSettings {
    return settingsSnapshot(this.settings);
  }
}

export const nodeShellSettings = NodeShellSettingsStore.getInstanceOrCreate<NodeShellSettingsStore>();
