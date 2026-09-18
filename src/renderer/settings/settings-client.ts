import { Renderer } from "@freelensapp/extensions";
import { SETTINGS_GET, SETTINGS_SAVE } from "../../common/settings-channels";
import {
  decodeSettings,
  encodeSettings,
  type NodeShellSettings,
  nodeShellSettings,
} from "../../common/store/node-shell-settings";

class SettingsRendererIpc extends Renderer.Ipc {}
let ipc: SettingsRendererIpc | undefined;

export function initializeSettingsClient(extension: Renderer.LensExtension): void {
  ipc = SettingsRendererIpc.createInstance(extension);
}

async function requestSettings(channel: string, settings?: NodeShellSettings): Promise<NodeShellSettings> {
  if (!ipc) throw new Error("Node Shell settings client is not initialized.");
  // Electron cannot clone MobX proxies. Transfer validated JSON text in both directions.
  const payload: unknown = await ipc.invoke(channel, ...(settings ? [encodeSettings(settings)] : []));
  const result = decodeSettings(payload);
  nodeShellSettings.fromStore(result);
  return nodeShellSettings.toJSON();
}

export function loadSettings(): Promise<NodeShellSettings> {
  return requestSettings(SETTINGS_GET);
}

export function saveSettings(settings: NodeShellSettings): Promise<NodeShellSettings> {
  return requestSettings(SETTINGS_SAVE, settings);
}
