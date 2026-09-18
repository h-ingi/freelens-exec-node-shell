import { Renderer } from "@freelensapp/extensions";
import { isNotFound, quotePowerShell, SessionLifecycle } from "./services/session-lifecycle";

const NAMESPACE = "kube-system";
const NODE_SHELL_IMAGE = "docker.io/library/alpine";

type NodeMenuProps = Renderer.Component.KubeObjectMenuProps<Renderer.K8sApi.Node>;

function ExecNodeShellMenu({ object, toolbar }: NodeMenuProps) {
  const openNodeShell = async () => {
    const cluster = Renderer.Catalog.getActiveCluster();

    if (!cluster) {
      Renderer.Component.Notifications.error("Active cluster not found");

      return;
    }

    const nodeName = object.getName();
    const podName = `node-shell-exec-${crypto.randomUUID()}`;

    const podManifest = {
      apiVersion: "v1",
      kind: "Pod",

      metadata: {
        name: podName,
        namespace: NAMESPACE,

        labels: {
          "app.kubernetes.io/name": "freelens-exec-node-shell",
        },
      },

      spec: {
        nodeName,

        restartPolicy: "Never",
        terminationGracePeriodSeconds: 0,

        // 1시간 후에는 강제로 종료
        activeDeadlineSeconds: 3600,

        // Node namespace 접근
        hostPID: true,
        hostIPC: true,
        hostNetwork: true,

        // 모든 taint를 가진 Node에서도 실행 가능
        tolerations: [
          {
            operator: "Exists",
          },
        ],

        priorityClassName: "system-node-critical",

        containers: [
          {
            name: "shell",

            image: NODE_SHELL_IMAGE,

            securityContext: {
              privileged: true,
            },

            // exec 연결을 기다리기 위한 keep-alive process
            command: ["sh", "-c", "while [ ! -f /tmp/exec-ended ]; do sleep 1; done"],

            stdin: true,
            tty: true,
          },
        ],
      },
    };

    let stage = "starting";
    let created = false;
    let lifecycle: SessionLifecycle | undefined;
    const descriptor = { name: podName, namespace: NAMESPACE };
    const checkCluster = () => {
      if (Renderer.Catalog.getActiveCluster()?.id !== cluster.id) {
        throw new Error("Cluster changed; cleanup will resume when the original cluster is active");
      }
    };
    const remove = async () => {
      checkCluster();
      try {
        await Renderer.K8sApi.podsApi.delete(descriptor);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    };

    try {
      stage = "creating pod";

      Renderer.Component.Notifications.info(`Creating node shell pod on ${nodeName}`);

      await Renderer.K8sApi.podsApi.create(
        {
          name: podName,
          namespace: NAMESPACE,
        },
        podManifest,
      );

      created = true;
      stage = "waiting for pod readiness";
      const readyDeadline = Date.now() + 120_000;
      while (true) {
        checkCluster();
        const pod = await Renderer.K8sApi.podsApi.get(descriptor);
        if (!pod) throw new Error("Created pod disappeared");
        if (pod.status?.conditions?.some((condition) => condition.type === "Ready" && condition.status === "True"))
          break;
        if (["Failed", "Succeeded"].includes(pod.status?.phase ?? ""))
          throw new Error("Pod terminated before shell startup");
        if (Date.now() >= readyDeadline) throw new Error("Pod readiness timed out after 120 seconds");
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }

      stage = "creating terminal";

      const terminalTab = Renderer.Component.createTerminalTab({
        title: `Node: ${nodeName}`,
      });

      Renderer.Component.Notifications.info("Terminal created");

      const terminalStore = Renderer.Component.terminalStore;
      lifecycle = new SessionLifecycle(
        {
          connected: () => terminalStore.isConnected(terminalTab.id),
          podEnded: async () => {
            checkCluster();
            try {
              const pod = await Renderer.K8sApi.podsApi.get(descriptor);
              return !pod || ["Failed", "Succeeded"].includes(pod.status?.phase ?? "");
            } catch (error) {
              if (isNotFound(error)) return true;
              throw error;
            }
          },
          remove,
          now: Date.now,
          onError: (error) => console.error("[Exec Node Shell] Cleanup will retry", error),
        },
        3600_000,
      );
      const session = lifecycle;
      const timer = window.setInterval(() => {
        void session.tick().then(() => {
          if (session.finished) window.clearInterval(timer);
        });
      }, 2000);

      stage = "sending exec command";
      const q = quotePowerShell;
      const target = `--context ${q(cluster.contextName)} -n ${q(NAMESPACE)}`;
      const remote = 'nsenter -t 1 -m -u -i -n -p -- /bin/sh; result=$?; touch /tmp/exec-ended; exit "$result"';
      const command =
        `Write-Host ${q(`=== Node Shell: ${nodeName} ===`)}; ` +
        `try { kubectl exec -it ${target} ${q(podName)} -c shell -- sh -c ${q(remote)} } ` +
        `finally { kubectl delete pod ${target} ${q(podName)} --ignore-not-found=true --wait=false --request-timeout=10s }`;

      await Renderer.Component.terminalStore.sendCommand(command, {
        tabId: terminalTab.id,
        enter: true,
      });

      Renderer.Component.Notifications.ok("Exec command sent");
    } catch (error) {
      if (lifecycle) {
        lifecycle.requestStop();
        await lifecycle.tick();
      } else if (created) {
        try {
          await remove();
        } catch (cleanupError) {
          Renderer.Component.Notifications.error(`Cleanup failed for ${podName}: ${String(cleanupError)}`);
        }
      }
      console.error("[Exec Node Shell]", stage, error);

      let detail = "";

      try {
        detail = JSON.stringify(error, Object.getOwnPropertyNames(error as object), 2);
      } catch {
        detail = String(error);
      }

      Renderer.Component.Notifications.error(`Failed at ${stage}: ${detail || String(error)}`);
    }
  };

  return (
    <Renderer.Component.MenuItem onClick={openNodeShell}>
      <Renderer.Component.Icon material="terminal" interactive={toolbar} />

      <span className="title">Exec Node Shell</span>
    </Renderer.Component.MenuItem>
  );
}

export default class ExecNodeShellRenderer extends Renderer.LensExtension {
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
