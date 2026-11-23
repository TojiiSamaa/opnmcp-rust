import { writeFileSync } from 'node:fs';

interface ToolStat {
  calls: number;
  errors: number;
  real: number;
  test: number;
  last_call?: string;
  latencies: number[];
}

const KEEP = 1000;

function pct(sorted: number[], p: number): number | null {
  return sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

type ApprovalKind = 'approved' | 'denied' | 'timeouts' | 'absent';

/** Counters of this process. Exported to a local JSON file when OPNSENSE_STATS_FILE is set (chosen by the operator, never by a tool call). */
class Stats {
  private tools = new Map<string, ToolStat>();
  private egress = { count: 0, last: undefined as string | undefined };
  private approver: Record<ApprovalKind, number> = { approved: 0, denied: 0, timeouts: 0, absent: 0 };
  private file?: string;
  mockRequests = 0;
  started = new Date().toISOString();
  mode: 'real' | 'test' = 'real';

  configure(opts: { file?: string; mode: 'real' | 'test' }): void {
    if (opts.file) this.file = opts.file;
    this.mode = opts.mode;
  }

  reset(): void {
    this.tools.clear();
    this.egress = { count: 0, last: undefined };
    this.approver = { approved: 0, denied: 0, timeouts: 0, absent: 0 };
    this.mockRequests = 0;
  }

  record(tool: string, ms: number, error: boolean, test: boolean): void {
    const s = this.tools.get(tool) ?? { calls: 0, errors: 0, real: 0, test: 0, latencies: [] };
    s.calls++;
    if (error) s.errors++;
    if (test) s.test++;
    else s.real++;
    s.last_call = new Date().toISOString();
    s.latencies.push(ms);
    if (s.latencies.length > KEEP) s.latencies.shift();
    this.tools.set(tool, s);
    this.exportFile();
  }

  egressBlocked(what: string): void {
    this.egress.count++;
    this.egress.last = what;
  }

  approval(kind: ApprovalKind): void {
    this.approver[kind]++;
  }

  snapshot(): Record<string, unknown> {
    const per_tool = Object.fromEntries(
      [...this.tools].map(([name, s]) => {
        const sorted = [...s.latencies].sort((a, b) => a - b);
        return [name, { calls: s.calls, errors: s.errors, real_calls: s.real, test_calls: s.test, p50_ms: pct(sorted, 50), p95_ms: pct(sorted, 95), last_call: s.last_call }];
      }),
    );
    const all = [...this.tools.values()];
    return {
      mode: this.mode,
      started: this.started,
      totals: {
        calls: all.reduce((n, s) => n + s.calls, 0),
        errors: all.reduce((n, s) => n + s.errors, 0),
        real_calls: all.reduce((n, s) => n + s.real, 0),
        test_calls: all.reduce((n, s) => n + s.test, 0),
      },
      network_cuts: this.egress,
      simulated_approver: this.approver,
      mock_requests: this.mockRequests,
      per_tool,
    };
  }

  private exportFile(): void {
    if (!this.file) return;
    try {
      writeFileSync(this.file, JSON.stringify(this.snapshot(), null, 2));
    } catch {
      /* stats must never break a tool call */
    }
  }
}

export const stats = new Stats();
