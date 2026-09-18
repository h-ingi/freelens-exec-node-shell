import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { hostShellCommand, hostStartup, nodeShellRemoteCommand } from "./shell-command";

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

it("keeps the shell open through legacy native argument quote removal", () => {
  // Model the embedded-double-quote loss at the Windows PowerShell 5.1/native boundary.
  // Stub namespace entry and markers; execute the actual generated remote script.
  const remote = nodeShellRemoteCommand("node-01").replace(/"/g, "");
  const stubs = `touch() { printf 'MARKER:%s\\n' "$1"; }; nsenter() { while [ "$1" != -- ]; do shift; done; shift; "$@"; }; `;
  const result = spawnSync("/bin/sh", ["-c", stubs + remote], {
    cwd: "/",
    input: "printf 'SESSION_ALIVE\\n'\ncd /tmp\nexit 7\n",
    encoding: "utf8",
    timeout: 5000,
  });
  expect(result.status).toBe(7);
  expect(result.stdout).toBe("MARKER:/tmp/exec-started\nSESSION_ALIVE\nMARKER:/tmp/exec-ended\n");
  expect(result.stderr).toContain("node-01:/tmp # ");
});

it("clears an attached terminal and then starts the interactive shell", () => {
  const python = String.raw`import os, pty, subprocess, sys
master, slave = pty.openpty()
p = subprocess.Popen(['/bin/sh', '-c', sys.argv[1]], stdin=subprocess.PIPE, stdout=slave, stderr=slave)
os.close(slave)
p.communicate(b"printf 'READY\\n'\nexit\n", timeout=3)
output = b''
while True:
    try:
        chunk = os.read(master, 4096)
        if not chunk: break
        output += chunk
    except OSError: break
os.close(master)
sys.stdout.buffer.write(output)
sys.exit(p.returncode)
`;
  const result = spawnSync("python3", ["-c", python, hostStartup], { encoding: "utf8", timeout: 5000 });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("\u001b[2J\u001b[H");
  expect(result.stdout).toContain("READY");
});

it("does not clear non-terminal output", () => {
  const result = spawnSync("/bin/sh", ["-c", hostStartup], { input: "exit\n", encoding: "utf8", timeout: 5000 });
  expect(result.status).toBe(0);
  expect(result.stdout).not.toContain("\u001b[2J");
});
