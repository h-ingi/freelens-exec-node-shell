import { Renderer } from "@freelensapp/extensions";
import { openNodeShell } from "../services/node-shell-service";

type NodeMenuProps = Renderer.Component.KubeObjectMenuProps<Renderer.K8sApi.Node>;

export function ExecNodeShellMenu({ object, toolbar }: NodeMenuProps) {
  return (
    <Renderer.Component.MenuItem
      onClick={() => {
        void openNodeShell(object.getName());
      }}
    >
      <Renderer.Component.Icon material="terminal" interactive={toolbar} />
      <span className="title">Exec Node Shell</span>
    </Renderer.Component.MenuItem>
  );
}
