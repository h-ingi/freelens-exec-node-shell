import { Renderer } from "@freelensapp/extensions";

const NAMESPACE = "kube-system";
const NODE_SHELL_IMAGE = "docker.io/library/alpine";

type NodeMenuProps =
  Renderer.Component.KubeObjectMenuProps<Renderer.K8sApi.Node>;

function ExecNodeShellMenu({ object, toolbar }: NodeMenuProps) {
  const openNodeShell = async () => {
    const cluster = Renderer.Catalog.getActiveCluster();

    if (!cluster) {
      Renderer.Component.Notifications.error(
        "Active cluster not found",
      );

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
            command: [
              "sh",
              "-c",
              "while true; do sleep 3600; done",
            ],

            stdin: true,
            tty: true,
          },
        ],
      },
    };

    let stage = "starting";

    try {
      stage = "creating pod";

      Renderer.Component.Notifications.info(
        `Creating node shell pod on ${nodeName}`,
      );

      await Renderer.K8sApi.podsApi.create(
        {
          name: podName,
          namespace: NAMESPACE,
        },
        podManifest,
      );

      Renderer.Component.Notifications.ok(
        `Pod created: ${podName}`,
      );

      stage = "creating terminal";

      const terminalTab =
        Renderer.Component.createTerminalTab({
          title: `Node: ${nodeName}`,
        });

      Renderer.Component.Notifications.info(
        "Terminal created",
      );

      const terminalStore =
        Renderer.Component.terminalStore as any;

      let terminalConnected = false;
      let cleanupStarted = false;

      const cleanupTimer = window.setInterval(
        async () => {
          const isConnected =
            terminalStore.isConnected?.(
              terminalTab.id,
            ) ?? false;

          if (isConnected) {
            terminalConnected = true;

            return;
          }

          /*
           * 아직 Terminal 연결 자체가 시작되지 않은 상태에서는
           * Pod를 삭제하지 않는다.
           */
          if (!terminalConnected) {
            return;
          }

          /*
           * 한번 연결됐던 Terminal이 사라졌다면
           * 탭이 닫힌 것으로 판단한다.
           */
          if (cleanupStarted) {
            return;
          }

          cleanupStarted = true;

          window.clearInterval(
            cleanupTimer,
          );

          try {
            await Renderer.K8sApi.podsApi.delete(
              {
                name: podName,
                namespace: NAMESPACE,
              },
            );

            console.log(
              `[Exec Node Shell] Deleted pod ${podName}`,
            );
          } catch (error) {
            console.error(
              `[Exec Node Shell] Failed to delete pod ${podName}`,
              error,
            );
          }
        },
        1000,
      );

      stage = "sending exec command";

      /*
       * attach를 사용하지 않는다.
       *
       * 1. Pod Running/Ready 대기
       * 2. kubectl exec
       * 3. nsenter로 Node namespace 진입
       *
       * 현재는 오류 확인을 위해 자동 삭제하지 않는다.
       */
      const command =
        `Write-Host "=== Node Shell: ${nodeName} ==="; ` +

        `kubectl wait --for=condition=Ready ` +
        `pod/${podName} ` +
        `-n ${NAMESPACE} ` +
        `--timeout=120s; ` +

        `if ($LASTEXITCODE -eq 0) { ` +

        `try { ` +
        `kubectl exec -it ` +
        `-n ${NAMESPACE} ` +
        `${podName} ` +
        `-c shell -- ` +
        `nsenter -t 1 -m -u -i -n -p -- /bin/sh ` +

        `} finally { ` +
        `kubectl delete pod ` +
        `-n ${NAMESPACE} ` +
        `${podName} ` +
        `--wait=false ` +
        `}` +

        `}`;

      await Renderer.Component.terminalStore.sendCommand(
        command,
        {
          tabId: terminalTab.id,
          enter: true,
        },
      );

      Renderer.Component.Notifications.ok(
        "Exec command sent",
      );
    } catch (error) {
      console.error(
        "[Exec Node Shell]",
        stage,
        error,
      );

      let detail = "";

      try {
        detail = JSON.stringify(
          error,
          Object.getOwnPropertyNames(error as object),
          2,
        );
      } catch {
        detail = String(error);
      }

      Renderer.Component.Notifications.error(
        `Failed at ${stage}: ${detail || String(error)}`,
      );
    }
  };

  return (
    <Renderer.Component.MenuItem
      onClick={openNodeShell}
    >
      <Renderer.Component.Icon
        material="terminal"
        interactive={toolbar}
      />

      <span className="title">
        Exec Node Shell
      </span>
    </Renderer.Component.MenuItem>
  );
}

export default class ExecNodeShellRenderer
  extends Renderer.LensExtension
{
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