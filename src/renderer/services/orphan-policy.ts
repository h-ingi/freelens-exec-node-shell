export const APP_LABEL = "freelens-exec-node-shell";

interface OrphanCandidate {
  metadata: { labels?: Partial<Record<string, string>>; creationTimestamp?: string; deletionTimestamp?: string };
  spec?: { activeDeadlineSeconds?: number };
  status?: { phase?: string };
}

export function shouldCleanOrphan(pod: OrphanCandidate, now: number): boolean {
  if (pod.metadata.labels?.["app.kubernetes.io/name"] !== APP_LABEL || pod.metadata.deletionTimestamp) return false;
  if (["Failed", "Succeeded"].includes(pod.status?.phase ?? "")) return true;
  const created = Date.parse(pod.metadata.creationTimestamp ?? "");
  const deadline = pod.spec?.activeDeadlineSeconds;
  return (
    Number.isFinite(created) && typeof deadline === "number" && deadline > 0 && now > created + (deadline + 60) * 1000
  );
}
