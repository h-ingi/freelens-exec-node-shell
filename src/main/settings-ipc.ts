import { Main } from "@freelensapp/extensions";
import { runInAction } from "mobx";
import { SETTINGS_GET, SETTINGS_SAVE } from "../common/settings-channels";
import { decodeSettings, encodeSettings, nodeShellSettings } from "../common/store/node-shell-settings";

export class SettingsMainIpc extends Main.Ipc {
  register(): void {
    this.handle(SETTINGS_GET, () => encodeSettings(nodeShellSettings.toJSON()));
    this.handle(SETTINGS_SAVE, (_event, payload: unknown) => {
      const settings = decodeSettings(payload);
      runInAction(() => {
        nodeShellSettings.settings = {
          namespace: settings.namespace,
          image: settings.image,
          timeoutMinutes: settings.timeoutMinutes,
          podPrefix: settings.podPrefix,
          knownNamespaces: [...new Set([...nodeShellSettings.settings.knownNamespaces, settings.namespace])],
        };
      });
      return encodeSettings(nodeShellSettings.toJSON());
    });
  }
}
