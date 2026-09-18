import { Renderer } from "@freelensapp/extensions";
import { ExecNodeShellMenu } from "./menus/exec-node-shell-menu";
import { SessionsPage } from "./pages/sessions-page";
import { shutdownCleanup, startCleanup } from "./services/cleanup-service";
import { NodeShellPreferenceHint, NodeShellPreferences } from "./settings/preferences";
import { initializeSettingsClient, loadSettings } from "./settings/settings-client";

export default class ExecNodeShellRenderer extends Renderer.LensExtension {
  constructor(extension: ConstructorParameters<typeof Renderer.LensExtension>[0]) {
    super(extension);
    // Preferences registration can be used before the activation callback.
    initializeSettingsClient(this);
  }
  async onActivate() {
    await loadSettings();
    startCleanup();
  }
  onDeactivate() {
    return shutdownCleanup();
  }
  appPreferences = [
    {
      title: "Exec Node Shell Settings",
      components: { Input: NodeShellPreferences, Hint: NodeShellPreferenceHint },
    },
  ];
  clusterPages = [{ id: "node-shell-sessions", components: { Page: SessionsPage } }];
  clusterPageMenus = [
    {
      title: "Node Shell Sessions",
      target: { pageId: "node-shell-sessions" },
      components: { Icon: () => <Renderer.Component.Icon material="terminal" /> },
    },
  ];
  kubeObjectMenuItems = [
    {
      kind: "Node",
      apiVersions: ["v1"],

      components: {
        MenuItem: ExecNodeShellMenu,
      },
    },
  ];
}
