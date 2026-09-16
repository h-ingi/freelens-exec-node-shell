import { Common } from "@freelensapp/extensions";
import { makeObservable, observable } from "mobx";

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

export class NodeShellSettingsStore extends Common.Store.ExtensionStore<NodeShellSettings> {
  @observable settings: NodeShellSettings = { ...defaults };

  constructor() {
    super({ configName: "node-shell-settings", defaults });
    makeObservable(this);
  }

  fromStore(data: Partial<NodeShellSettings>): void {
    const next = { ...defaults, ...data };
    this.settings = validateSettings(next) ? { ...defaults } : next;
  }

  toJSON(): NodeShellSettings {
    return { ...this.settings, knownNamespaces: [...this.settings.knownNamespaces] };
  }
}

export const nodeShellSettings = NodeShellSettingsStore.getInstanceOrCreate<NodeShellSettingsStore>();
