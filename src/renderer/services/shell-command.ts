function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function shellEnvironment(nodeName: string): string {
  // Kubernetes node names are DNS names. Keep prompt expansion syntax out of PS1.
  const displayName = nodeName.replace(/[^a-zA-Z0-9.-]/g, "_");
  const prompt = `${displayName}:\${PWD} # `;
  // Scope prompt and startup overrides to this shell; never edit host profile files.
  return `NODE_SHELL_PROMPT=${quoteShell(prompt)}; export NODE_SHELL_PROMPT; PS1=$NODE_SHELL_PROMPT; export PS1; ENV=/dev/null; export ENV`;
}

// This script deliberately contains no quotes: it crosses the legacy Windows
// native argument boundary inside one single-quoted POSIX argument.
// Non-interactive Bash resets inherited PS1. Restore it inside the host shell.
export const hostStartup = String.raw`PS1=$NODE_SHELL_PROMPT; export PS1; unset NODE_SHELL_PROMPT; if [ -t 1 ]; then printf \\033\\1332J\\033\\133H; fi; exec /bin/sh -i`;

export function hostShellCommand(nodeName: string): string {
  return `${shellEnvironment(nodeName)}; exec /bin/sh -i`;
}

export function nodeShellRemoteCommand(nodeName: string): string {
  return (
    // Avoid nested shell quoting: Windows PowerShell 5.1 can strip embedded double quotes.
    `touch /tmp/exec-started; ${shellEnvironment(nodeName)}; nsenter -t 1 -m -u -i -n -p -- /bin/sh -c ${quoteShell(hostStartup)}; ` +
    'result=$?; touch /tmp/exec-ended; exit "$result"'
  );
}
