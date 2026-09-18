import { Renderer } from "@freelensapp/extensions";
import { SETTINGS_GET, SETTINGS_SAVE } from "../../common/settings-channels";
import { type NodeShellSettings, nodeShellSettings, validateSettings } from "../../common/store/node-shell-settings";

class SettingsRendererIpc extends Renderer.Ipc {}
let ipc: SettingsRendererIpc | undefined;

export function initializeSettingsClient(extension: Renderer.LensExtension): void {
  ipc = SettingsRendererIpc.createInstance(extension);
}

async function requestSettings(channel: string, settings?: NodeShellSettings): Promise<NodeShellSettings> {
  if (!ipc) throw new Error("Node Shell settings client is not initialized.");
  const result: NodeShellSettings = await ipc.invoke(channel, ...(settings ? [settings] : []));
  const error = validateSettings(result);
  if (error) throw new Error(`Invalid settings received from main: ${error}`);
  nodeShellSettings.fromStore(result);
  return nodeShellSettings.toJSON();
}

export function loadSettings(): Promise<NodeShellSettings> {
  return requestSettings(SETTINGS_GET);
}

export function saveSettings(settings: NodeShellSettings): Promise<NodeShellSettings> {
  return requestSettings(SETTINGS_SAVE, settings);
}
