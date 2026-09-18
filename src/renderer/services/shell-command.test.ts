import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { hostShellCommand, nodeShellRemoteCommand } from "./shell-command";

describe("node shell prompt", () => {
  it("shows the node and updates the path after cd in the host shell", () => {
    const result = spawnSync("/bin/sh", ["-c", hostShellCommand("node-01.example")], {
      cwd: "/",
      input: "cd /tmp\nexit 7\n",
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(7);
    expect(result.stderr).toContain("node-01.example:/ # ");
    expect(result.stderr).toContain("node-01.example:/tmp # ");
  });

  it("keeps shell expansions out of the supplied node name", () => {
    const result = spawnSync("/bin/sh", ["-c", hostShellCommand("$(echo INJECTED)`id`'node")], {
      cwd: "/",
      input: "exit\n",
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("__echo_INJECTED__id__node:/ # ");
    expect(result.stdout).toBe("");
  });

  it("keeps the remote lifecycle wrapper valid shell syntax", () => {
    const result = spawnSync("/bin/sh", ["-n", "-c", nodeShellRemoteCommand("node-01")]);
    expect(result.status).toBe(0);
    expect(nodeShellRemoteCommand("node-01")).toContain('result=$?; touch /tmp/exec-ended; exit "$result"');
  });
});
