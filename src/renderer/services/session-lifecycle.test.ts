import { describe, expect, it, vi } from "vitest";
import { isNotFound, quotePowerShell, SessionLifecycle } from "./session-lifecycle";

function fixture() {
  let now = 0;
  let connected = false;
  const remove = vi.fn(async () => {});
  const podEnded = vi.fn(async () => false);
  const onError = vi.fn();
  const lifecycle = new SessionLifecycle(
    { connected: () => connected, now: () => now, remove, podEnded, onError },
    60_000,
  );
  return {
    lifecycle,
    remove,
    podEnded,
    onError,
    time: (value: number) => {
      now = value;
    },
    connect: (value: boolean) => {
      connected = value;
    },
  };
}

describe("session cleanup", () => {
  it("waits for initial connection, then deletes on terminal close", async () => {
    const f = fixture();
    await f.lifecycle.tick();
    expect(f.remove).not.toHaveBeenCalled();
    f.connect(true);
    await f.lifecycle.tick();
    f.connect(false);
    await f.lifecycle.tick();
    await f.lifecycle.tick();
    expect(f.remove).toHaveBeenCalledTimes(1);
  });
  it("cleans up a terminal that never connects", async () => {
    const f = fixture();
    f.time(30_000);
    await f.lifecycle.tick();
    expect(f.remove).toHaveBeenCalledOnce();
  });
  it("retries deletion failures", async () => {
    const f = fixture();
    f.remove.mockRejectedValueOnce(new Error("offline"));
    f.lifecycle.requestStop();
    await f.lifecycle.tick();
    expect(f.lifecycle.finished).toBe(false);
    await f.lifecycle.tick();
    expect(f.lifecycle.finished).toBe(true);
    expect(f.remove).toHaveBeenCalledTimes(2);
  });
  it("expires a connected session", async () => {
    const f = fixture();
    f.connect(true);
    f.time(60_000);
    await f.lifecycle.tick();
    expect(f.remove).toHaveBeenCalledOnce();
  });
  it("cleans up remote shell exit even when the local terminal stays connected", async () => {
    const f = fixture();
    f.connect(true);
    f.podEnded.mockResolvedValue(true);
    await f.lifecycle.tick();
    expect(f.remove).toHaveBeenCalledOnce();
  });
  it("does not issue concurrent deletes", async () => {
    const f = fixture();
    let finish = () => {};
    f.remove.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    f.lifecycle.requestStop();
    const first = f.lifecycle.tick();
    await f.lifecycle.tick();
    expect(f.remove).toHaveBeenCalledOnce();
    finish();
    await first;
  });
  it("only treats explicit not-found errors as successful cleanup", () => {
    expect(isNotFound({ status: 404 })).toBe(true);
    expect(isNotFound({ code: 403 })).toBe(false);
    expect(isNotFound(new Error("network"))).toBe(false);
  });
  it("quotes PowerShell literals without interpolating commands", () => {
    expect(quotePowerShell("a'b$(whoami)")).toBe("'a''b$(whoami)'");
  });
});
