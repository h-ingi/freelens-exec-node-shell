function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function shellEnvironment(nodeName: string): string {
  // Kubernetes node names are DNS names. Keep prompt expansion syntax out of PS1.
  const displayName = nodeName.replace(/[^a-zA-Z0-9.-]/g, "_");
  const prompt = `${displayName}:\${PWD} # `;
  // Scope prompt and startup overrides to this shell; never edit host profile files.
  return `PS1=${quoteShell(prompt)}; export PS1; ENV=/dev/null; export ENV`;
}

export function hostShellCommand(nodeName: string): string {
  return `${shellEnvironment(nodeName)}; exec /bin/sh -i`;
}

export function nodeShellRemoteCommand(nodeName: string): string {
  return (
    // Avoid nested shell quoting: Windows PowerShell 5.1 can strip embedded double quotes.
    `touch /tmp/exec-started; ${shellEnvironment(nodeName)}; nsenter -t 1 -m -u -i -n -p -- /bin/sh -i; ` +
    'result=$?; touch /tmp/exec-ended; exit "$result"'
  );
}
