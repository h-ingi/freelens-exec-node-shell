import { describe, expect, it } from "vitest";
import { APP_LABEL, shouldCleanOrphan } from "./orphan-policy";

describe("orphan policy", () => {
  const pod = {
    metadata: { labels: { "app.kubernetes.io/name": APP_LABEL }, creationTimestamp: "2026-09-16T00:00:00Z" },
    spec: { activeDeadlineSeconds: 3600 },
    status: { phase: "Running" },
  };
  it("keeps a live session belonging to another window or user", () => {
    expect(shouldCleanOrphan(pod, Date.parse("2026-09-16T00:30:00Z"))).toBe(false);
  });
  it("allows expired labeled pods after a grace period", () => {
    expect(shouldCleanOrphan(pod, Date.parse("2026-09-16T01:02:00Z"))).toBe(true);
  });
  it("never deletes an unlabeled pod", () => {
    expect(shouldCleanOrphan({ ...pod, metadata: {}, status: { phase: "Failed" } }, Date.now())).toBe(false);
  });
  it("allows completed pods without a timestamp", () => {
    expect(shouldCleanOrphan({ ...pod, status: { phase: "Succeeded" } }, 0)).toBe(true);
  });
  it("does not guess an expiry when the deadline or timestamp is absent", () => {
    expect(shouldCleanOrphan({ ...pod, spec: {} }, Date.now())).toBe(false);
    expect(shouldCleanOrphan({ ...pod, metadata: { ...pod.metadata, creationTimestamp: "invalid" } }, Date.now())).toBe(
      false,
    );
  });
});
