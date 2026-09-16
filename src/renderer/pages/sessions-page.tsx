import { Renderer } from "@freelensapp/extensions";
import { useEffect, useState } from "react";
import { nodeShellSettings } from "../../common/store/node-shell-settings";
import {
  cleanOrphans,
  deleteSessionPod,
  listSessionPods,
  localSessions,
  stopSession,
} from "../services/cleanup-service";
import { checkPermissions, execAvailable, type PermissionResult } from "../services/rbac-service";

export function SessionsPage() {
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
    setPods([]);
    setPermissions([]);
    setError("");
  }, [namespace, clusterId]);

  const refresh = async () => {
    if (!clusterId) return;
    setBusy(true);
    setError("");
    try {
      const result = await checkPermissions(clusterId, namespace);
      if (Renderer.Catalog.getActiveCluster()?.id !== clusterId) return;
      setPermissions(result);
      setPods(await listSessionPods(namespace));
    } catch (failure) {
      setError(`Pod listing unavailable; local sessions remain visible. ${String(failure)}`);
    } finally {
      setBusy(false);
    }
  };

  const local = [...localSessions.values()].filter((session) => session.clusterId === clusterId);
  const remote = pods.filter((pod) => !local.some((session) => session.podName === pod.metadata.name));
  const age = (started: number) =>
    Number.isFinite(started) ? `${Math.max(0, Math.floor((now - started) / 60_000))} min` : "Unknown";
  const attach = permissions.find((permission) => permission.label === "pods/attach create");

  return (
    <section style={{ padding: 24, overflow: "auto", height: "100%" }}>
      <h1>Node Shell Sessions</h1>
      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "16px 0" }}>
        <label>
          Namespace{" "}
          <select value={namespace} onChange={(event) => setNamespace(event.target.value)}>
            {[...new Set([...nodeShellSettings.settings.knownNamespaces, nodeShellSettings.settings.namespace])].map(
              (value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ),
            )}
          </select>
        </label>
        <Renderer.Component.Button
          label={busy ? "Checking…" : "Refresh / check permissions"}
          disabled={busy}
          onClick={() => {
            void refresh();
          }}
        />
        <Renderer.Component.Button
          label="Clean expired pods"
          disabled={busy}
          onClick={() => {
            void cleanOrphans().then(refresh);
          }}
        />
      </div>
      {error && <p role="alert">{error}</p>}
      {permissions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2>Node Shell permissions</h2>
          <table>
            <thead>
              <tr>
                <th>Permission</th>
                <th>Result</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {permissions.map((permission) => (
                <tr key={permission.label}>
                  <td>{permission.label}</td>
                  <td>{permission.allowed === undefined ? "Unknown" : permission.allowed ? "Allowed" : "Denied"}</td>
                  <td>{permission.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Exec Node Shell: {execAvailable(permissions) ? "Available (RBAC)" : "Denied or unknown"}</p>
          <p>
            Default shell attach permission:{" "}
            {attach?.allowed === undefined ? "Unknown" : attach.allowed ? "Allowed" : "Not available"}
          </p>
        </div>
      )}
      <table style={{ width: "100%", textAlign: "left", borderSpacing: "12px" }}>
        <thead>
          <tr>
            <th>Node / Pod</th>
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
              <td>
                {session.nodeName}
                <br />
                <small>{session.podName}</small>
              </td>
              <td>{session.namespace}</td>
              <td>
                {session.status}
                {session.error && <p role="alert">{session.error}</p>}
              </td>
              <td>{new Date(session.started).toLocaleString()}</td>
              <td>{age(session.started)}</td>
              <td>
                <Renderer.Component.Button
                  label="Stop"
                  disabled={["Closed", "Failed", "Stopping"].includes(session.status)}
                  onClick={() => {
                    void stopSession(session);
                  }}
                />
              </td>
            </tr>
          ))}
          {remote.map((pod) => (
            <tr key={pod.metadata.uid}>
              <td>
                {pod.spec.nodeName}
                <br />
                <small>{pod.metadata.name}</small>
              </td>
              <td>{pod.metadata.namespace}</td>
              <td>{pod.status?.phase ?? "Unknown"} (discovered)</td>
              <td>{pod.metadata.creationTimestamp}</td>
              <td>{age(Date.parse(pod.metadata.creationTimestamp ?? ""))}</td>
              <td>
                <Renderer.Component.Button
                  label="Delete"
                  onClick={() => {
                    if (Renderer.Catalog.getActiveCluster()?.id !== clusterId) return;
                    if (
                      !window.confirm(`Delete ${pod.metadata.name}? This may stop a session opened in another window.`)
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
      {local.length === 0 && remote.length === 0 && <p>No sessions shown. Refresh to discover existing pods.</p>}
      <p>
        Live sessions from other windows are never automatically deleted before their deadline. Discovery needs
        pods/list.
      </p>
    </section>
  );
}
