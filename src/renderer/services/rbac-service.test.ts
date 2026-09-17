import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ post: vi.fn(), construct: vi.fn() }));

vi.mock("@freelensapp/extensions", () => ({
  Renderer: {
    K8sApi: {
      // Deliberately omit forCluster: the runtime legacy wrapper is not callable.
      KubeJsonApi: class {
        post = mocks.post;
        constructor(...args: unknown[]) {
          mocks.construct(...args);
        }
      },
    },
  },
}));

import { checkPermissions, execAvailable } from "./rbac-service";

describe("RBAC requests through the renderer cluster proxy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("window", { location: { port: "63983", host: "window.renderer.freelens.app:63983" } });
    mocks.post.mockResolvedValue({ status: { allowed: true } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("routes requests to the selected cluster without a static forCluster function", async () => {
    const results = await checkPermissions("cluster-a", "shell-test");
    expect(mocks.construct).toHaveBeenCalledWith(
      { serverAddress: "https://127.0.0.1:63983", apiBase: "/api-kube" },
      { headers: { Host: "cluster-a.window.renderer.freelens.app:63983" } },
    );
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

  it("does not permit execution when a required review fails", async () => {
    mocks.post.mockRejectedValue(new Error("Forbidden"));
    const results = await checkPermissions("cluster-a", "shell-test");
    expect(execAvailable(results)).toBe(false);
    expect(results.every((result) => result.allowed === undefined && result.reason.includes("Forbidden"))).toBe(true);
  });

  it("allows exec when only optional attach and list permissions are denied", async () => {
    mocks.post.mockImplementation(async (_path, { data }) => ({
      status: {
        allowed: data.spec.resourceAttributes.subresource !== "attach" && data.spec.resourceAttributes.verb !== "list",
      },
    }));
    expect(execAvailable(await checkPermissions("cluster-a", "shell-test"))).toBe(true);
  });
});
