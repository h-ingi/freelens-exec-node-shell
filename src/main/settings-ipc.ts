import { Main } from "@freelensapp/extensions";
import { runInAction } from "mobx";
import { SETTINGS_GET, SETTINGS_SAVE } from "../common/settings-channels";
import { type NodeShellSettings, nodeShellSettings, validateSettings } from "../common/store/node-shell-settings";

export class SettingsMainIpc extends Main.Ipc {
  register(): void {
    this.handle(SETTINGS_GET, () => nodeShellSettings.toJSON());
    this.handle(SETTINGS_SAVE, (_event, settings: NodeShellSettings) => {
      const error = validateSettings(settings);
      if (error) throw new Error(error);
      runInAction(() => {
        nodeShellSettings.settings = {
          namespace: settings.namespace,
          image: settings.image,
          timeoutMinutes: settings.timeoutMinutes,
          podPrefix: settings.podPrefix,
          knownNamespaces: [...new Set([...nodeShellSettings.settings.knownNamespaces, settings.namespace])],
        };
      });
      return nodeShellSettings.toJSON();
    });
  }
}
