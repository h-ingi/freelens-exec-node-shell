import { Main } from "@freelensapp/extensions";
import { nodeShellSettings } from "../common/store/node-shell-settings";

export default class ExecNodeShellMain extends Main.LensExtension {
  onActivate() {
    nodeShellSettings.loadExtension(this);
  }
}
