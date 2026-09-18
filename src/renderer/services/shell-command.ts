function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function hostShellCommand(nodeName: string): string {
  // Kubernetes node names are DNS names. Keep prompt expansion syntax out of PS1.
  const displayName = nodeName.replace(/[^a-zA-Z0-9.-]/g, "_");
  const prompt = `${displayName}:\${PWD} # `;
  // Scope prompt and startup overrides to this shell; never edit host profile files.
  return `PS1=${quoteShell(prompt)}; export PS1; ENV=/dev/null; export ENV; exec /bin/sh -i`;
}

export function nodeShellRemoteCommand(nodeName: string): string {
  return (
    `touch /tmp/exec-started; nsenter -t 1 -m -u -i -n -p -- /bin/sh -c ${quoteShell(hostShellCommand(nodeName))}; ` +
    'result=$?; touch /tmp/exec-ended; exit "$result"'
  );
}
