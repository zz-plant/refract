/**
 * A protection log entry. `@refract-org/ingestion`'s `fetchProtectionLogs`
 * returns this shape, with `level` and `reasonCategory` filled in.
 */
export interface ProtectionLogRecord {
  logId: number;
  pageTitle: string;
  timestamp: string;
  comment: string;
  action: "protect" | "unprotect" | "modify";
  /** Who may edit after the entry: `semi` (autoconfirmed), `extended` (extended-confirmed), `full` (administrators), `template` (template editors). */
  level?: "semi" | "extended" | "full" | "template";
  /**
   * What kind of reason the administrator wrote, from the policy the comment
   * links or else its wording. A category of the comment, not a finding about
   * the page.
   */
  reasonCategory?: "content_dispute" | "vandalism" | "disruption" | "sockpuppetry" | "sourcing" | "other";
}

export interface ProtectionState {
  level: string;
  sinceTimestamp: string;
  sinceLogId: number;
}

export interface ProtectionChange {
  type: "added" | "removed" | "modified";
  logEvent: ProtectionLogRecord;
}

export interface ProtectionTracker {
  buildState(logs: ProtectionLogRecord[]): Map<string, ProtectionState>;
  diffState(before: Map<string, ProtectionState>, after: Map<string, ProtectionState>): ProtectionChange[];
  findLogsBetween(logs: ProtectionLogRecord[], fromTimestamp: string, toTimestamp: string): ProtectionLogRecord[];
}

export const protectionTracker: ProtectionTracker = {
  buildState(logs: ProtectionLogRecord[]): Map<string, ProtectionState> {
    const state = new Map<string, ProtectionState>();
    const sorted = [...logs].map((l) => ({ l, ts: new Date(l.timestamp).getTime() }));
    sorted.sort((a, b) => a.ts - b.ts);

    for (const { l: log } of sorted) {
      if (log.action === "protect" || log.action === "modify") {
        state.set(log.pageTitle, {
          level: log.action === "protect" ? "protected" : "modified",
          sinceTimestamp: log.timestamp,
          sinceLogId: log.logId,
        });
      } else if (log.action === "unprotect") {
        state.delete(log.pageTitle);
      }
    }

    return state;
  },

  diffState(before: Map<string, ProtectionState>, after: Map<string, ProtectionState>): ProtectionChange[] {
    const changes: ProtectionChange[] = [];
    const allTitles = new Set([...before.keys(), ...after.keys()]);

    for (const title of allTitles) {
      const b = before.get(title);
      const a = after.get(title);

      if (!b && a) {
        changes.push({
          type: "added",
          logEvent: {
            logId: a.sinceLogId,
            pageTitle: title,
            timestamp: a.sinceTimestamp,
            comment: "",
            action: "protect",
          },
        });
      } else if (b && !a) {
        changes.push({
          type: "removed",
          logEvent: {
            logId: b.sinceLogId,
            pageTitle: title,
            timestamp: b.sinceTimestamp,
            comment: "",
            action: "unprotect",
          },
        });
      } else if (b && a && b.sinceLogId !== a.sinceLogId) {
        changes.push({
          type: "modified",
          logEvent: {
            logId: a.sinceLogId,
            pageTitle: title,
            timestamp: a.sinceTimestamp,
            comment: "",
            action: "modify",
          },
        });
      }
    }

    return changes;
  },

  findLogsBetween(logs: ProtectionLogRecord[], fromTimestamp: string, toTimestamp: string): ProtectionLogRecord[] {
    const from = new Date(fromTimestamp).getTime();
    const to = new Date(toTimestamp).getTime();

    return logs.filter((l) => {
      const t = new Date(l.timestamp).getTime();
      return t > from && t <= to;
    });
  },
};
