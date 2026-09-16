import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  send: vi.fn(),
  connected: vi.fn(),
  active: vi.fn(),
  permissions: vi.fn(),
  error: vi.fn(),
  sessions: new Map(),
}));

vi.mock("@freelensapp/extensions", () => ({
  Renderer: {
    Catalog: { getActiveCluster: mocks.active },
    K8sApi: { podsApi: { create: mocks.create, get: mocks.get, delete: mocks.remove } },
    Component: {
      Notifications: { error: mocks.error, info: vi.fn(), ok: vi.fn() },
      createTerminalTab: () => ({ id: "test-tab" }),
      terminalStore: {
        isConnected: mocks.connected,
        getTerminalApi: () => ({ isReady: true }),
        sendCommand: mocks.send,
      },
    },
  },
}));

vi.mock("../../common/store/node-shell-settings", () => ({
  validateSettings: () => undefined,
  nodeShellSettings: {
    toJSON: () => ({ namespace: "kube-system", image: "alpine", timeoutMinutes: 60, podPrefix: "test" }),
  },
}));

vi.mock("./rbac-service", () => ({
  checkPermissions: mocks.permissions,
  execAvailable: (results: boolean[]) => results.every(Boolean),
  permissionSummary: () => "diagnostics",
}));

vi.mock("./cleanup-service", () => ({
  localSessions: mocks.sessions,
  trackSession: (record: { lifecycle?: unknown }, lifecycle: unknown) => {
    record.lifecycle = lifecycle;
  },
}));

import { openNodeShell } from "./node-shell-service";

describe("node shell orchestration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.sessions.clear();
    mocks.active.mockReturnValue({ id: "cluster-a", contextName: "test-context" });
    mocks.permissions.mockResolvedValue([true]);
    mocks.create.mockResolvedValue({ metadata: { uid: "pod-uid" } });
    mocks.get.mockResolvedValue({ status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] } });
    mocks.remove.mockResolvedValue({});
    mocks.connected.mockReturnValue(true);
    mocks.send.mockResolvedValue(undefined);
  });

  it("creates a privileged exec pod and sends a PowerShell 5.1 compatible command", async () => {
    await openNodeShell("test-node");
    const manifest = mocks.create.mock.calls[0][1];
    expect(manifest.spec.nodeName).toBe("test-node");
    expect(manifest.spec.activeDeadlineSeconds).toBe(3600);
    expect(manifest.spec.containers[0].securityContext.privileged).toBe(true);
    const command = mocks.send.mock.calls[0][0];
    expect(command).toContain("kubectl exec -it");
    expect(command).toContain("--context 'test-context'");
    expect(command).not.toContain("kubectl attach");
    expect(command).not.toContain("&&");
    expect(command).toContain("finally");
    expect(command).toContain("/tmp/exec-ended");
  });

  it("does not create a pod when a required permission is denied", async () => {
    mocks.permissions.mockResolvedValue([false]);
    await openNodeShell("test-node");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  });

  it("cleans up a pod that fails before reaching Ready", async () => {
    mocks.get.mockResolvedValue({ status: { phase: "Failed" } });
    await openNodeShell("test-node");
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("retains retry ownership when startup cleanup fails", async () => {
    mocks.get.mockRejectedValue(new Error("read failed"));
    mocks.remove.mockRejectedValueOnce(new Error("delete temporarily failed"));
    await openNodeShell("test-node");
    const record = [...mocks.sessions.values()][0];
    expect(record.lifecycle.finished).toBe(false);
    await record.lifecycle.tick();
    expect(record.lifecycle.finished).toBe(true);
    expect(mocks.remove).toHaveBeenCalledTimes(2);
  });

  it("cleans up when sending the terminal command fails", async () => {
    mocks.send.mockRejectedValue(new Error("terminal closed"));
    await openNodeShell("test-node");
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it("does not delete against a different active cluster", async () => {
    await openNodeShell("test-node");
    const record = [...mocks.sessions.values()][0];
    record.lifecycle.requestStop();
    mocks.active.mockReturnValue({ id: "cluster-b" });
    await record.lifecycle.tick();
    expect(mocks.remove).not.toHaveBeenCalled();
    mocks.active.mockReturnValue({ id: "cluster-a" });
    await record.lifecycle.tick();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
});
