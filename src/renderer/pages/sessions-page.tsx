import { Renderer } from "@freelensapp/extensions";
import { useEffect, useRef, useState } from "react";
import { nodeShellSettings } from "../../common/store/node-shell-settings";
import {
  cleanOrphans,
  deleteSessionPod,
  listSessionPods,
  localSessions,
  stopSession,
} from "../services/cleanup-service";
import { checkPermissions, execAvailable, type PermissionResult } from "../services/rbac-service";
import sessionStyles from "./sessions-page.scss?inline";

export function SessionsPage() {
  const [search, setSearch] = useState("");
  const request = useRef(0);
  const [now, setNow] = useState(Date.now());
  const [namespace, setNamespace] = useState(nodeShellSettings.settings.namespace);
  const [pods, setPods] = useState<Renderer.K8sApi.Pod[]>([]);
  const [permissions, setPermissions] = useState<PermissionResult[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const clusterId = Renderer.Catalog.getActiveCluster()?.id;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    request.current += 1;
    setBusy(false);
    setPods([]);
    setPermissions([]);
    setError("");
    return () => {
      request.current += 1;
    };
  }, [namespace, clusterId]);

  const refresh = async () => {
    if (!clusterId) return;
    const id = ++request.current;
    setBusy(true);
    setError("");
    try {
      const result = await checkPermissions(clusterId, namespace);
      if (request.current !== id || Renderer.Catalog.getActiveCluster()?.id !== clusterId) return;
      setPermissions(result);
      const discovered = await listSessionPods(namespace);
      if (request.current === id && Renderer.Catalog.getActiveCluster()?.id === clusterId) setPods(discovered);
    } catch (failure) {
      if (request.current === id)
        setError(`Pod listing unavailable; local sessions remain visible. ${String(failure)}`);
    } finally {
      if (request.current === id) setBusy(false);
    }
  };

  const clusterSessions = [...localSessions.values()].filter((session) => session.clusterId === clusterId);
  const localInNamespace = clusterSessions.filter((session) => session.namespace === namespace);
  const remoteInNamespace = pods.filter(
    (pod) =>
      pod.metadata.namespace === namespace &&
      !localInNamespace.some((session) => session.podName === pod.metadata.name),
  );
  const matches = (...values: (string | undefined)[]) =>
    values.join(" ").toLowerCase().includes(search.trim().toLowerCase());
  const local = localInNamespace
    .filter((session) => matches(session.nodeName, session.podName, session.status))
    .sort((a, b) => b.started - a.started);
  const remote = remoteInNamespace.filter((pod) => matches(pod.spec.nodeName, pod.metadata.name, pod.status?.phase));
  const total = localInNamespace.length + remoteInNamespace.length;
  const statusTone = (status: string) => {
    if (["Terminal open", "Running"].includes(status)) return "active";
    if (status === "Failed") return "failed";
    if (["Closed", "Succeeded"].includes(status)) return "closed";
    return "pending";
  };
  const age = (started: number) =>
    Number.isFinite(started) ? `${Math.max(0, Math.floor((now - started) / 60_000))} min` : "Unknown";
  const closed = localInNamespace.filter((session) => session.status === "Closed");

  return (
    <section className="node-shell-sessions">
      <style>{sessionStyles}</style>
      <div className="sessions-toolbar">
        <h1>Node Shell Sessions</h1>
        <span className="sessions-count">
          {local.length + remote.length} / {total} sessions
        </span>
        <div className="sessions-filters">
          <label>
            Namespace{" "}
            <select
              aria-label="Namespace"
              disabled={busy || !clusterId}
              value={namespace}
              onChange={(event) => setNamespace(event.target.value)}
            >
              {[
                ...new Set([
                  ...nodeShellSettings.settings.knownNamespaces,
                  nodeShellSettings.settings.namespace,
                  ...clusterSessions.map((session) => session.namespace),
                ]),
              ].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <Renderer.Component.Input
            aria-label="Search sessions"
            placeholder="Search sessions…"
            value={search}
            onChange={setSearch}
          />
        </div>
      </div>
      <div className="sessions-actions">
        <Renderer.Component.Button
          label={busy ? "Checking…" : "Refresh / check permissions"}
          disabled={busy || !clusterId}
          onClick={() => {
            void refresh();
          }}
        />
        <Renderer.Component.Button
          label="Clean leftover pods"
          disabled={busy || !clusterId}
          onClick={() => {
            void cleanOrphans()
              .then(refresh)
              .catch((failure: unknown) => setError(String(failure)));
          }}
        />
        <Renderer.Component.Button
          label={`Clear closed sessions (${closed.length})`}
          disabled={closed.length === 0 || !clusterId}
          onClick={() => {
            if (Renderer.Catalog.getActiveCluster()?.id !== clusterId) return;
            for (const session of closed) {
              if (session.status === "Closed") localSessions.delete(session.podName);
            }
            // Discovery may still contain a stale copy of a locally deleted Pod.
            setPods((current) =>
              current.filter(
                (pod) =>
                  !closed.some(
                    (session) =>
                      session.status === "Closed" &&
                      session.podName === pod.metadata.name &&
                      session.namespace === pod.metadata.namespace,
                  ),
              ),
            );
            setNow(Date.now());
          }}
        />
        <small>
          Clear closed sessions removes local history in this namespace. Clean leftover pods deletes finished or expired
          session Pods.
        </small>
      </div>
      {error && <p role="alert">{error}</p>}
      {permissions.length > 0 && (
        <div className="sessions-permissions">
          <p className={`permission-summary ${execAvailable(permissions) ? "allowed" : "denied"}`}>
            {execAvailable(permissions)
              ? "Node shell: Ready (RBAC)"
              : "Node shell: Required permissions denied or unknown"}
          </p>
          <p>Attach is not used. Pod listing is optional and enables leftover Pod discovery.</p>
          <details>
            <summary>Permission details ({permissions.length})</summary>
            <div className="sessions-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Permission</th>
                    <th>Purpose</th>
                    <th>Result</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((permission) => (
                    <tr key={permission.label}>
                      <td>{permission.label}</td>
                      <td>
                        {permission.required
                          ? "Required for node shell"
                          : permission.label === "pods/attach create"
                            ? "Not used (reference only)"
                            : "Optional: leftover Pod discovery"}
                      </td>
                      <td>
                        <span
                          className={`permission-result ${permission.allowed === true ? "allowed" : permission.required ? "denied" : "optional"}`}
                        >
                          {permission.allowed === undefined ? "Unknown" : permission.allowed ? "Allowed" : "Denied"}
                        </span>
                      </td>
                      <td>
                        {permission.reason ? (
                          <details>
                            <summary>Show reason</summary>
                            <p className="permission-reason">{permission.reason}</p>
                          </details>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
      <div className="sessions-table-scroll">
        <table className="sessions-table">
          <thead>
            <tr>
              <th>Node</th>
              <th>Pod</th>
              <th>Namespace</th>
              <th>Status</th>
              <th>Started</th>
              <th>Age</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {local.map((session) => (
              <tr key={session.podName}>
                <td>{session.nodeName}</td>
                <td className="sessions-pod">{session.podName}</td>
                <td>{session.namespace}</td>
                <td>
                  <span className={`session-status ${statusTone(session.status)}`}>{session.status}</span>
                  {session.error && <p role="alert">{session.error}</p>}
                </td>
                <td>{new Date(session.started).toLocaleString()}</td>
                <td>{age(session.started)}</td>
                <td>
                  <Renderer.Component.Button
                    label="Stop"
                    disabled={["Closed", "Failed", "Stopping"].includes(session.status)}
                    onClick={() => {
                      void stopSession(session).catch((failure: unknown) => setError(String(failure)));
                    }}
                  />
                </td>
              </tr>
            ))}
            {remote.map((pod) => (
              <tr key={pod.metadata.uid}>
                <td>{pod.spec.nodeName}</td>
                <td className="sessions-pod">{pod.metadata.name}</td>
                <td>{pod.metadata.namespace}</td>
                <td>
                  <span className={`session-status ${statusTone(pod.status?.phase ?? "Unknown")}`}>
                    {pod.status?.phase ?? "Unknown"}
                  </span>
                  <small className="sessions-discovered">Discovered</small>
                </td>
                <td>{pod.metadata.creationTimestamp}</td>
                <td>{age(Date.parse(pod.metadata.creationTimestamp ?? ""))}</td>
                <td>
                  <Renderer.Component.Button
                    label="Delete"
                    onClick={() => {
                      if (Renderer.Catalog.getActiveCluster()?.id !== clusterId) return;
                      if (
                        !window.confirm(
                          `Delete ${pod.metadata.name}? This may stop a session opened in another window.`,
                        )
                      )
                        return;
                      void deleteSessionPod(pod)
                        .then(refresh)
                        .catch((failure: unknown) => setError(String(failure)));
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {local.length === 0 && remote.length === 0 && (
        <p className="sessions-empty">
          {search.trim()
            ? "No matching sessions."
            : "No sessions in this namespace. Refresh to discover existing pods."}
        </p>
      )}
      <p className="sessions-hint">
        Live sessions from other windows are never automatically deleted before their deadline. Discovery needs
        pods/list.
      </p>
    </section>
  );
}
