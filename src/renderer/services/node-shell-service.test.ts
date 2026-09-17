import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  send: vi.fn(),
  connected: vi.fn(),
  terminalApi: vi.fn(),
  enabled: vi.fn(),
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
        getTerminalApi: mocks.terminalApi,
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
  cleanupIsEnabled: mocks.enabled,
  localSessions: mocks.sessions,
  trackSession: (record: { lifecycle?: unknown }, lifecycle: unknown) => {
    record.lifecycle = lifecycle;
  },
}));

vi.mock("../settings/settings-client", () => ({ loadSettings: mocks.settings }));

import { openNodeShell } from "./node-shell-service";

describe("node shell orchestration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.sessions.clear();
    mocks.settings.mockResolvedValue({
      namespace: "kube-system",
      image: "alpine",
      timeoutMinutes: 60,
      podPrefix: "test",
    });
    mocks.active.mockReturnValue({ id: "cluster-a", contextName: "test-context" });
    mocks.permissions.mockResolvedValue([true]);
    mocks.create.mockResolvedValue({ metadata: { uid: "pod-uid" } });
    mocks.get.mockResolvedValue({ status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] } });
    mocks.remove.mockResolvedValue({});
    mocks.connected.mockReturnValue(true);
    mocks.terminalApi.mockReturnValue({ isReady: true });
    mocks.enabled.mockReturnValue(true);
    mocks.send.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses the acknowledged one-minute setting for both pod deadline and cleanup", async () => {
    vi.useFakeTimers();
    mocks.settings.mockResolvedValue({
      namespace: "kube-system",
      image: "alpine",
      timeoutMinutes: 1,
      podPrefix: "test",
    });
    await openNodeShell("test-node");
    expect(mocks.create.mock.calls[0][1].spec.activeDeadlineSeconds).toBe(60);
    const record = [...mocks.sessions.values()][0];
    await vi.advanceTimersByTimeAsync(59_000);
    await record.lifecycle.tick();
    expect(mocks.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await record.lifecycle.tick();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it("blocks creation when the main settings cannot be read", async () => {
    mocks.settings.mockRejectedValue(new Error("settings unavailable"));
    await openNodeShell("test-node");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("Failed to load Node Shell settings"));
  });

  it("times out a registered connection whose shell never becomes ready", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    mocks.terminalApi.mockReturnValue({ isReady: false });
    const opening = openNodeShell("test-node");
    await vi.advanceTimersByTimeAsync(31_000);
    await opening;
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("cleans up when the extension is disabled while pod creation is in flight", async () => {
    mocks.create.mockImplementation(async () => {
      mocks.enabled.mockReturnValue(false);
      return { metadata: { uid: "pod-uid" } };
    });
    await openNodeShell("test-node");
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
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
