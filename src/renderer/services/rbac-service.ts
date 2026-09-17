import { Renderer } from "@freelensapp/extensions";

export interface PermissionResult {
  label: string;
  required: boolean;
  allowed: boolean | undefined;
  reason: string;
}

export const permissions = [
  { verb: "create", resource: "pods", label: "pods/create", required: true },
  { verb: "get", resource: "pods", label: "pods/get", required: true },
  { verb: "delete", resource: "pods", label: "pods/delete", required: true },
  { verb: "create", resource: "pods", subresource: "exec", label: "pods/exec create", required: true },
  { verb: "create", resource: "pods", subresource: "attach", label: "pods/attach create", required: false },
  { verb: "list", resource: "pods", label: "pods/list (orphan cleanup)", required: false },
] as const;

interface ReviewStatus {
  allowed?: boolean;
  reason?: string;
  evaluationError?: string;
}

interface ReviewSpec {
  resourceAttributes: {
    group: string;
    namespace: string;
    verb: string;
    resource: string;
    subresource?: string;
  };
}

class SelfSubjectAccessReview extends Renderer.K8sApi.KubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  ReviewStatus,
  ReviewSpec
> {
  static readonly kind = "SelfSubjectAccessReview";
  static readonly namespaced = false;
  static readonly apiBase = "/apis/authorization.k8s.io/v1/selfsubjectaccessreviews";
}

export async function checkPermissions(clusterId: string, namespace: string): Promise<PermissionResult[]> {
  if (Renderer.Catalog.getActiveCluster()?.id !== clusterId) {
    throw new Error("Active cluster changed before permission check; retry from the target cluster.");
  }
  // Reuse the cluster frame's authenticated client, including its TLS and routing configuration.
  const api = new Renderer.K8sApi.KubeApi({ objectConstructor: SelfSubjectAccessReview, autoRegister: false });
  // Compatibility adapter for FreeLens 1.10.x: SSAR is not a persisted KubeObject.
  // KubeApi.create() discards responses without uid/name/resourceVersion. Use the
  // same host-owned transport directly; do not synthesize resource metadata.
  const request = api["request"];
  if (!request || typeof request.post !== "function") {
    throw new Error("FreeLens cluster request client is unavailable for permission reviews.");
  }
  return Promise.all(
    permissions.map(async (permission) => {
      try {
        const result: unknown = await request.post(SelfSubjectAccessReview.apiBase, {
          data: {
            apiVersion: "authorization.k8s.io/v1",
            kind: SelfSubjectAccessReview.kind,
            spec: {
              resourceAttributes: {
                group: "",
                namespace,
                verb: permission.verb,
                resource: permission.resource,
                ...("subresource" in permission ? { subresource: permission.subresource } : {}),
              },
            },
          },
        });
        const status = result && typeof result === "object" && "status" in result ? result.status : undefined;
        const allowed =
          status && typeof status === "object" && "allowed" in status && typeof status.allowed === "boolean"
            ? status.allowed
            : undefined;
        const reason =
          status && typeof status === "object" && "reason" in status && typeof status.reason === "string"
            ? status.reason
            : "";
        const evaluationError =
          status &&
          typeof status === "object" &&
          "evaluationError" in status &&
          typeof status.evaluationError === "string"
            ? status.evaluationError
            : "";
        return {
          label: permission.label,
          required: permission.required,
          allowed,
          reason:
            reason ||
            evaluationError ||
            (allowed === undefined ? "Permission review returned no allowed decision" : ""),
        };
      } catch (error) {
        return { label: permission.label, required: permission.required, allowed: undefined, reason: String(error) };
      }
    }),
  );
}

export function execAvailable(results: PermissionResult[]): boolean {
  return results.filter((result) => result.required).every((result) => result.allowed === true);
}

export function permissionSummary(results: PermissionResult[]): string {
  return results
    .map(
      (result) =>
        `${result.label}: ${result.allowed === undefined ? "Unknown" : result.allowed ? "Allowed" : "Denied"}${result.reason ? ` (${result.reason})` : ""}`,
    )
    .join("\n");
}
