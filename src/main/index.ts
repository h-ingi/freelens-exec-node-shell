import { Main } from "@freelensapp/extensions";
import { nodeShellSettings } from "../common/store/node-shell-settings";
import { SettingsMainIpc } from "./settings-ipc";

export default class ExecNodeShellMain extends Main.LensExtension {
  constructor(extension: ConstructorParameters<typeof Main.LensExtension>[0]) {
    super(extension);
    // Settings RPC must exist before a renderer opens extension preferences.
    nodeShellSettings.loadExtension(this);
    new SettingsMainIpc(this).register();
  }
}
