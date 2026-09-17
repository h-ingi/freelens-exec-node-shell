import { Renderer } from "@freelensapp/extensions";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ post: vi.fn(), construct: vi.fn(), active: vi.fn() }));

vi.mock("@freelensapp/extensions", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const paths = [require.resolve("@freelensapp/extensions")];
  // Execute the installed FreeLens implementation, including its real parser.
  const { KubeApi } = require(require.resolve("@freelensapp/kube-api", { paths }));
  const { KubeObject } = require(require.resolve("@freelensapp/kube-object", { paths }));
  return {
    Renderer: {
      Catalog: { getActiveCluster: mocks.active },
      K8sApi: {
        KubeObject,
        KubeApi: function (options: unknown) {
          mocks.construct(options);
          return new KubeApi({ maybeKubeApi: { post: mocks.post } }, options);
        },
      },
    },
  };
});

import { checkPermissions, execAvailable, permissionSummary } from "./rbac-service";

describe("RBAC reviews using the cluster frame client", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.active.mockReturnValue({ id: "cluster-a" });
    mocks.post.mockResolvedValue({
      apiVersion: "authorization.k8s.io/v1",
      kind: "SelfSubjectAccessReview",
      metadata: { creationTimestamp: null },
      status: { allowed: true },
    });
  });

  it("uses the host client without constructing a proxy URL or TLS client", async () => {
    const results = await checkPermissions("cluster-a", "shell-test");
    const options = mocks.construct.mock.calls[0][0];
    expect(options.autoRegister).toBe(false);
    expect(options.request).toBeUndefined();
    expect(options.objectConstructor.kind).toBe("SelfSubjectAccessReview");
    expect(options.objectConstructor.namespaced).toBe(false);
    expect(options.objectConstructor.apiBase).toBe("/apis/authorization.k8s.io/v1/selfsubjectaccessreviews");
    expect(mocks.post).toHaveBeenCalledTimes(6);
    expect(mocks.post).toHaveBeenCalledWith("/apis/authorization.k8s.io/v1/selfsubjectaccessreviews", {
      data: {
        apiVersion: "authorization.k8s.io/v1",
        kind: "SelfSubjectAccessReview",
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
    });
    expect(execAvailable(results)).toBe(true);
  });

  it("reproduces the generic parser discarding a valid ephemeral review", async () => {
    class Review extends Renderer.K8sApi.KubeObject {
      static readonly kind = "SelfSubjectAccessReview";
      static readonly namespaced = false;
      static readonly apiBase = "/apis/authorization.k8s.io/v1/selfsubjectaccessreviews";
    }
    const api = new Renderer.K8sApi.KubeApi({ objectConstructor: Review, autoRegister: false });
    expect(await api.create({}, {})).toBeNull();
    expect(execAvailable(await checkPermissions("cluster-a", "shell-test"))).toBe(true);
  });

  it("blocks stale cluster requests before sending a review", async () => {
    mocks.active.mockReturnValue({ id: "cluster-b" });
    await expect(checkPermissions("cluster-a", "shell-test")).rejects.toThrow("Active cluster changed");
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("preserves connection failures in the displayed summary and blocks execution", async () => {
    mocks.post.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const results = await checkPermissions("cluster-a", "shell-test");
    expect(execAvailable(results)).toBe(false);
    expect(permissionSummary(results)).toContain("pods/create: Unknown (Error: connect ECONNREFUSED)");
  });

  it("does not confuse a denied permission with a failed review", async () => {
    mocks.post.mockResolvedValue({ status: { allowed: false, reason: "policy denied" } });
    const results = await checkPermissions("cluster-a", "shell-test");
    expect(execAvailable(results)).toBe(false);
    expect(permissionSummary(results)).toContain("pods/create: Denied (policy denied)");
  });

  it("rejects non-boolean allowed values", async () => {
    mocks.post.mockResolvedValue({ status: { allowed: "true" } });
    const results = await checkPermissions("cluster-a", "shell-test");
    expect(execAvailable(results)).toBe(false);
    expect(results.every((result) => result.allowed === undefined)).toBe(true);
  });

  it("blocks missing review decisions", async () => {
    mocks.post.mockResolvedValue(null);
    const results = await checkPermissions("cluster-a", "shell-test");
    expect(execAvailable(results)).toBe(false);
    expect(permissionSummary(results)).toContain("Permission review returned no allowed decision");
  });

  it("allows exec when only optional attach and list permissions are denied", async () => {
    mocks.post.mockImplementation(async (_url, { data: { spec } }) => ({
      status: {
        allowed: spec.resourceAttributes.subresource !== "attach" && spec.resourceAttributes.verb !== "list",
      },
    }));
    expect(execAvailable(await checkPermissions("cluster-a", "shell-test"))).toBe(true);
  });
});
