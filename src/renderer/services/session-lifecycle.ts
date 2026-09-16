export interface LifecycleDependencies {
  connected(): boolean;
  podEnded(): Promise<boolean>;
  remove(): Promise<void>;
  onError(error: unknown): void;
  now(): number;
}

/** One owner for cleanup; failed deletes remain eligible for retry. */
export class SessionLifecycle {
  private connectedOnce = false;
  private stopping = false;
  private busy = false;
  finished = false;
  private readonly started: number;

  constructor(
    private readonly dependencies: LifecycleDependencies,
    private readonly timeoutMs: number,
    private readonly connectionTimeoutMs = 30_000,
  ) {
    this.started = dependencies.now();
  }

  requestStop(): void {
    this.stopping = true;
  }

  async tick(): Promise<void> {
    if (this.busy || this.finished) return;
    this.busy = true;
    try {
      const connected = this.dependencies.connected();
      const age = this.dependencies.now() - this.started;
      if (connected) this.connectedOnce = true;
      if (
        (this.connectedOnce && !connected) ||
        (!this.connectedOnce && age >= this.connectionTimeoutMs) ||
        age >= this.timeoutMs
      )
        this.stopping = true;

      if (!this.stopping && (await this.dependencies.podEnded())) this.stopping = true;
      if (this.stopping) {
        await this.dependencies.remove();
        this.finished = true;
      }
    } catch (error) {
      this.dependencies.onError(error);
    } finally {
      this.busy = false;
    }
  }
}

export function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: number; statusCode?: number; code?: number; reason?: string };
  return value.status === 404 || value.statusCode === 404 || value.code === 404 || value.reason === "NotFound";
}

export function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
