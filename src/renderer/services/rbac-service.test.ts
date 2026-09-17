import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), construct: vi.fn(), active: vi.fn() }));

vi.mock("@freelensapp/extensions", () => ({
  Renderer: {
    Catalog: { getActiveCluster: mocks.active },
    K8sApi: {
      KubeObject: class {},
      KubeApi: class {
        create = mocks.create;
        constructor(...args: unknown[]) {
          mocks.construct(...args);
        }
      },
    },
  },
}));

import { checkPermissions, execAvailable, permissionSummary } from "./rbac-service";

describe("RBAC reviews using the cluster frame client", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.active.mockReturnValue({ id: "cluster-a" });
    mocks.create.mockResolvedValue({ status: { allowed: true } });
  });

  it("uses the host client without constructing a proxy URL or TLS client", async () => {
    const results = await checkPermissions("cluster-a", "shell-test");
    const options = mocks.construct.mock.calls[0][0];
    expect(options.autoRegister).toBe(false);
    expect(options.request).toBeUndefined();
    expect(options.objectConstructor.kind).toBe("SelfSubjectAccessReview");
    expect(options.objectConstructor.namespaced).toBe(false);
    expect(options.objectConstructor.apiBase).toBe("/apis/authorization.k8s.io/v1/selfsubjectaccessreviews");
    expect(mocks.create).toHaveBeenCalledTimes(6);
    expect(mocks.create).toHaveBeenCalledWith(
      {},
      {
        spec: {
          resourceAttributes: {
            group: "",
            namespace: "shell-test",
            verb: "create",
            resource: "pods",
            subresource: "exec",
          },
        },
      },
    );
    expect(execAvailable(results)).toBe(true);
  });

  it("blocks stale cluster requests before sending a review", async () => {
    mocks.active.mockReturnValue({ id: "cluster-b" });
    await expect(checkPermissions("cluster-a", "shell-test")).rejects.toThrow("Active cluster changed");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("preserves connection failures in the displayed summary and blocks execution", async () => {
    mocks.create.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const results = await checkPermissions("cluster-a", "shell-test");
    expect(execAvailable(results)).toBe(false);
    expect(permissionSummary(results)).toContain("pods/create: Unknown (Error: connect ECONNREFUSED)");
  });

  it("does not confuse a denied permission with a failed review", async () => {
    mocks.create.mockResolvedValue({ status: { allowed: false, reason: "policy denied" } });
    const results = await checkPermissions("cluster-a", "shell-test");
    expect(execAvailable(results)).toBe(false);
    expect(permissionSummary(results)).toContain("pods/create: Denied (policy denied)");
  });

  it("blocks missing review decisions", async () => {
    mocks.create.mockResolvedValue(null);
    const results = await checkPermissions("cluster-a", "shell-test");
    expect(execAvailable(results)).toBe(false);
    expect(permissionSummary(results)).toContain("Permission review returned no allowed decision");
  });

  it("allows exec when only optional attach and list permissions are denied", async () => {
    mocks.create.mockImplementation(async (_metadata, { spec }) => ({
      status: {
        allowed: spec.resourceAttributes.subresource !== "attach" && spec.resourceAttributes.verb !== "list",
      },
    }));
    expect(execAvailable(await checkPermissions("cluster-a", "shell-test"))).toBe(true);
  });
});
