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

export async function checkPermissions(clusterId: string, namespace: string): Promise<PermissionResult[]> {
  // Match FreeLens renderer cluster routing without the legacy forCluster wrapper.
  const api = new Renderer.K8sApi.KubeJsonApi(
    { serverAddress: `https://127.0.0.1:${window.location.port}`, apiBase: "/api-kube" },
    { headers: { Host: `${clusterId}.${window.location.host}` } },
  );
  return Promise.all(
    permissions.map(async (permission) => {
      try {
        const result = await api.post<{ status?: { allowed?: boolean; reason?: string; evaluationError?: string } }>(
          "/apis/authorization.k8s.io/v1/selfsubjectaccessreviews",
          {
            data: {
              apiVersion: "authorization.k8s.io/v1",
              kind: "SelfSubjectAccessReview",
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
          },
        );
        return {
          label: permission.label,
          required: permission.required,
          allowed: result.status?.allowed,
          reason: result.status?.reason || result.status?.evaluationError || "",
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
        `${result.label}: ${result.allowed === undefined ? "Unknown" : result.allowed ? "Allowed" : "Denied"}`,
    )
    .join("\n");
}
