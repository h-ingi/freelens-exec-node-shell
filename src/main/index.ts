import { Main } from "@freelensapp/extensions";
import { nodeShellSettings } from "../common/store/node-shell-settings";
import { SettingsMainIpc } from "./settings-ipc";

export default class ExecNodeShellMain extends Main.LensExtension {
  onActivate() {
    nodeShellSettings.loadExtension(this);
    new SettingsMainIpc(this).register();
  }
}
