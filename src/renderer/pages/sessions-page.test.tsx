// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { type InputHTMLAttributes } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { LocalSession } from "../services/cleanup-service";

const mocks = vi.hoisted(() => ({
  sessions: new Map<string, LocalSession>(),
  stop: vi.fn(),
  list: vi.fn(),
  permissions: vi.fn(),
  clean: vi.fn(),
}));

vi.mock("@freelensapp/extensions", () => ({
  Renderer: {
    Catalog: { getActiveCluster: () => ({ id: "cluster-a" }) },
    Component: {
      Button: ({ label, ...props }: { label: string }) => <button {...props}>{label}</button>,
      Input: ({
        onChange,
        ...props
      }: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & { onChange: (value: string) => void }) => (
        <input {...props} onChange={(event) => onChange(event.currentTarget.value)} />
      ),
    },
  },
}));
vi.mock("../../common/store/node-shell-settings", () => ({
  nodeShellSettings: { settings: { namespace: "kube-system", knownNamespaces: ["kube-system", "debug"] } },
}));
vi.mock("../services/cleanup-service", () => ({
  localSessions: mocks.sessions,
  stopSession: mocks.stop,
  listSessionPods: mocks.list,
  cleanOrphans: mocks.clean,
  deleteSessionPod: vi.fn(),
}));
vi.mock("../services/rbac-service", () => ({
  checkPermissions: mocks.permissions,
  execAvailable: () => true,
}));

import { SessionsPage } from "./sessions-page";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sessions.clear();
  for (const [podName, namespace, clusterId, status] of [
    ["pod-active", "kube-system", "cluster-a", "Terminal open"],
    ["pod-closed", "kube-system", "cluster-a", "Closed"],
    ["pod-debug", "debug", "cluster-a", "Terminal open"],
    ["pod-other-cluster", "kube-system", "cluster-b", "Terminal open"],
  ]) {
    mocks.sessions.set(podName, { podName, namespace, clusterId, status, nodeName: "node-a", started: Date.now() });
  }
  mocks.list.mockResolvedValue([]);
  mocks.permissions.mockResolvedValue([]);
  mocks.stop.mockResolvedValue(undefined);
});
afterEach(cleanup);

it("filters both the list and count by namespace, cluster and search", () => {
  const ui = render(<SessionsPage />);
  expect(ui.getByText("2 / 2 sessions")).toBeTruthy();
  expect(ui.queryByText("pod-other-cluster")).toBeNull();
  expect(ui.queryByText("pod-debug")).toBeNull();
  fireEvent.change(ui.getByLabelText("Search sessions"), { target: { value: "POD-ACTIVE" } });
  expect(ui.getByText("1 / 2 sessions")).toBeTruthy();
  expect(ui.queryByText("pod-closed")).toBeNull();
  fireEvent.change(ui.getByLabelText("Search sessions"), { target: { value: "" } });
  fireEvent.change(ui.getByLabelText("Namespace"), { target: { value: "debug" } });
  expect(ui.getByText("pod-debug")).toBeTruthy();
  expect(ui.queryByText("pod-active")).toBeNull();
});

it("retains Stop for active sessions and disables it for closed sessions", async () => {
  const ui = render(<SessionsPage />);
  const buttons = ui.getAllByRole("button", { name: "Stop" }) as HTMLButtonElement[];
  expect(buttons.filter((button) => button.disabled)).toHaveLength(1);
  fireEvent.click(buttons.find((button) => !button.disabled)!);
  await waitFor(() => expect(mocks.stop).toHaveBeenCalledWith(mocks.sessions.get("pod-active")));
});

it("keeps local sessions visible when discovery fails", async () => {
  mocks.list.mockRejectedValue(new Error("list denied"));
  const ui = render(<SessionsPage />);
  fireEvent.click(ui.getByRole("button", { name: "Refresh / check permissions" }));
  await waitFor(() => expect(ui.getByRole("alert").textContent).toContain("list denied"));
  expect(ui.getByText("pod-active")).toBeTruthy();
});

it("clears only closed local history in the selected namespace without stopping sessions", () => {
  const source = mocks.sessions.get("pod-closed")!;
  mocks.sessions.set("closed-other-ns", { ...source, podName: "closed-other-ns", namespace: "debug" });
  mocks.sessions.set("closed-other-cluster", { ...source, podName: "closed-other-cluster", clusterId: "cluster-b" });
  mocks.sessions.set("failed", { ...source, podName: "failed", status: "Failed" });
  const ui = render(<SessionsPage />);
  fireEvent.click(ui.getByRole("button", { name: "Clear closed sessions (1)" }));
  expect(mocks.sessions.has("pod-closed")).toBe(false);
  for (const name of ["pod-active", "closed-other-ns", "closed-other-cluster", "failed"])
    expect(mocks.sessions.has(name)).toBe(true);
  expect(mocks.stop).not.toHaveBeenCalled();
  expect(mocks.clean).not.toHaveBeenCalled();
  expect((ui.getByRole("button", { name: "Clear closed sessions (0)" }) as HTMLButtonElement).disabled).toBe(true);
});

it("separates optional attach denial from the node shell readiness summary", async () => {
  mocks.permissions.mockResolvedValue([
    { label: "pods/create", required: true, allowed: true, reason: "RBAC binding details" },
    { label: "pods/attach create", required: false, allowed: false, reason: "" },
  ]);
  const ui = render(<SessionsPage />);
  fireEvent.click(ui.getByRole("button", { name: "Refresh / check permissions" }));
  await waitFor(() => expect(ui.getByText("Node shell: Ready (RBAC)")).toBeTruthy());
  expect(ui.getByText("Not used (reference only)")).toBeTruthy();
  expect(ui.getByText("RBAC binding details").closest("details")?.open).toBe(false);
});

it("does not redisplay cleared history from a stale discovery snapshot", async () => {
  mocks.list.mockResolvedValue([
    {
      metadata: { name: "pod-closed", namespace: "kube-system", uid: "old" },
      spec: { nodeName: "node-a" },
      status: { phase: "Running" },
    },
  ]);
  const ui = render(<SessionsPage />);
  fireEvent.click(ui.getByRole("button", { name: "Refresh / check permissions" }));
  await waitFor(() => expect(mocks.list).toHaveBeenCalled());
  await waitFor(() =>
    expect((ui.getByRole("button", { name: "Refresh / check permissions" }) as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(ui.getByRole("button", { name: "Clear closed sessions (1)" }));
  expect(ui.queryByText("pod-closed")).toBeNull();
});
