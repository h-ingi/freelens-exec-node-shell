// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  disk: {} as Record<string, unknown>,
  disposers: [] as (() => void)[],
}));

vi.mock("@freelensapp/extensions", async () => {
  const { reaction, runInAction } = await import("mobx");
  return {
    Common: {
      Store: {
        ExtensionStore: class {
          static getInstanceOrCreate() {
            return new this();
          }
          fromStore(_data: unknown) {}
          toJSON(): unknown {
            return {};
          }
          loadExtension() {
            this.fromStore(host.disk);
            // Model FreeLens main persistent-storage's synchronous MobX reaction.
            host.disposers.push(
              reaction(
                () => this.toJSON(),
                (model) => {
                  host.disk = JSON.parse(JSON.stringify(model));
                },
              ),
            );
          }
        },
      },
    },
    Main: {
      LensExtension: class {},
      Ipc: class {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          host.handlers.set(channel, handler);
        }
      },
    },
    Renderer: {
      LensExtension: class {},
      K8sApi: { KubeObject: class {} },
      Component: { Button: ({ label, ...props }: { label: string }) => createElement("button", props, label) },
      Ipc: class {
        async invoke(channel: string, ...args: unknown[]) {
          const handler = host.handlers.get(channel);
          if (!handler) throw new Error("No settings handler");
          return runInAction(() => handler({}, ...args));
        }
      },
    },
  };
});

afterEach(() => {
  cleanup();
  host.disposers.splice(0).forEach((dispose) => dispose());
  host.handlers.clear();
  host.disk = {};
  vi.resetModules();
});

async function renderer() {
  vi.resetModules();
  const client = await import("./settings-client");
  const { nodeShellSettings } = await import("../../common/store/node-shell-settings");
  const { default: RendererExtension } = await import("../index");
  const extension = new RendererExtension({} as ConstructorParameters<typeof RendererExtension>[0]);
  // Preferences can render before onActivate. Do not call it in this fixture.
  return { ...client, store: nodeShellSettings, Input: extension.appPreferences[0].components.Input };
}

it("saves in main and reads the new setting from a separate stale cluster renderer", async () => {
  const { default: MainExtension } = await import("../../main/index");
  new MainExtension({} as ConstructorParameters<typeof MainExtension>[0]);
  const preferences = await renderer();
  const cluster = await renderer();
  expect(cluster.store.toJSON().timeoutMinutes).toBe(60);
  const saved = await preferences.saveSettings({ ...preferences.store.toJSON(), timeoutMinutes: 1 });
  expect(saved.timeoutMinutes).toBe(1);
  expect(host.disk.timeoutMinutes).toBe(1);
  expect(cluster.store.toJSON().timeoutMinutes).toBe(60);
  expect((await cluster.loadSettings()).timeoutMinutes).toBe(1);
  // Reconstruct main to verify that its store loads the persisted value.
  host.disposers.splice(0).forEach((dispose) => dispose());
  host.handlers.clear();
  vi.resetModules();
  const { default: RestartedMain } = await import("../../main/index");
  new RestartedMain({} as ConstructorParameters<typeof RestartedMain>[0]);
  expect((await cluster.loadSettings()).timeoutMinutes).toBe(1);
});

describe("settings failures", () => {
  it("does not report a successful save when main is unavailable", async () => {
    const client = await renderer();
    await expect(client.saveSettings({ ...client.store.toJSON(), timeoutMinutes: 1 })).rejects.toThrow(
      "No settings handler",
    );
    expect(client.store.toJSON().timeoutMinutes).toBe(60);
  });
  it("rejects invalid settings in main without changing persisted state", async () => {
    const { default: MainExtension } = await import("../../main/index");
    new MainExtension({} as ConstructorParameters<typeof MainExtension>[0]);
    const client = await renderer();
    await expect(client.saveSettings({ ...client.store.toJSON(), timeoutMinutes: 0 })).rejects.toThrow(
      "Session timeout",
    );
    expect((await client.loadSettings()).timeoutMinutes).toBe(60);
  });
});

it("enables timeout editing and saves from preferences without activation callbacks", async () => {
  const { default: MainExtension } = await import("../../main/index");
  new MainExtension({} as ConstructorParameters<typeof MainExtension>[0]);
  const client = await renderer();
  const ui = render(createElement(client.Input));
  const timeout = ui.getByLabelText("Session timeout (minutes)") as HTMLInputElement;
  await waitFor(() => expect(timeout.disabled).toBe(false));
  fireEvent.change(timeout, { target: { value: "1" } });
  fireEvent.click(ui.getByText("Save"));
  await waitFor(() =>
    expect(ui.getByRole("status").textContent).toContain("Saved. New sessions will use a 1 minute timeout."),
  );
  expect(host.disk.timeoutMinutes).toBe(1);
});
