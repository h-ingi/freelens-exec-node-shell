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
