import { Renderer } from "@freelensapp/extensions";
import { nodeShellSettings } from "../../common/store/node-shell-settings";
import { APP_LABEL, shouldCleanOrphan } from "./orphan-policy";
import { isNotFound, type SessionLifecycle } from "./session-lifecycle";

export interface LocalSession {
  podName: string;
  nodeName: string;
  namespace: string;
  clusterId: string;
  started: number;
  status: string;
  error?: string;
  lifecycle?: SessionLifecycle;
  timer?: number;
}

export const localSessions = new Map<string, LocalSession>();
let orphanTimer: number | undefined;
let cleaning = false;

export function trackSession(session: LocalSession, lifecycle: SessionLifecycle): void {
  session.lifecycle = lifecycle;
  session.timer = window.setInterval(() => {
    void lifecycle.tick().then(() => {
      if (lifecycle.finished) {
        session.status = "Closed";
        session.error = undefined;
        window.clearInterval(session.timer);
      }
    });
  }, 2000);
}

export async function stopSession(session: LocalSession): Promise<void> {
  session.status = "Stopping";
  session.lifecycle?.requestStop();
  await session.lifecycle?.tick();
}

export async function listSessionPods(namespace: string): Promise<Renderer.K8sApi.Pod[]> {
  return (
    (await Renderer.K8sApi.podsApi.list(
      { namespace },
      {
        labelSelector: `app.kubernetes.io/name=${APP_LABEL}`,
      },
    )) ?? []
  );
}

export async function deleteSessionPod(pod: Renderer.K8sApi.Pod): Promise<void> {
  if (pod.metadata.labels?.["app.kubernetes.io/name"] !== APP_LABEL) throw new Error("Not an Exec Node Shell pod");
  try {
    await Renderer.K8sApi.podsApi.delete({
      name: pod.metadata.name,
      namespace: pod.metadata.namespace,
      deleteOptions: { preconditions: { uid: pod.metadata.uid } },
    });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

export async function cleanOrphans(): Promise<void> {
  if (cleaning) return;
  const clusterId = Renderer.Catalog.getActiveCluster()?.id;
  if (!clusterId) return;
  cleaning = true;
  try {
    const namespaces = new Set([...nodeShellSettings.settings.knownNamespaces, nodeShellSettings.settings.namespace]);
    for (const namespace of namespaces) {
      if (Renderer.Catalog.getActiveCluster()?.id !== clusterId) return;
      try {
        const pods = await listSessionPods(namespace);
        for (const pod of pods) {
          if (Renderer.Catalog.getActiveCluster()?.id !== clusterId) return;
          const local = localSessions.get(pod.metadata.name);
          if (local && !["Closed", "Failed"].includes(local.status)) continue;
          if (shouldCleanOrphan(pod, Date.now())) await deleteSessionPod(pod);
        }
      } catch (error) {
        // Listing is optional. Direct cleanup of locally tracked sessions still works.
        console.warn(`[Exec Node Shell] Orphan cleanup unavailable in ${namespace}`, error);
      }
    }
  } finally {
    cleaning = false;
  }
}

export function startCleanup(): void {
  void cleanOrphans();
  orphanTimer = window.setInterval(() => {
    void cleanOrphans();
  }, 60_000);
}

export async function shutdownCleanup(): Promise<void> {
  window.clearInterval(orphanTimer);
  await Promise.all(
    [...localSessions.values()].map(async (session) => {
      window.clearInterval(session.timer);
      await stopSession(session);
    }),
  );
}
