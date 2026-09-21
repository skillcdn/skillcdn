/** A neutral record of something that happened: what, for which account and repository, how much. */
export interface UsageEvent {
  readonly type: "tool_call" | "index_completed";
  readonly at: Date;
  /** The host's id of the account that owns the repository. */
  readonly hostAccountId: string;
  readonly hostRepoId: string;
  /** What was used, for example the tool name. */
  readonly subject: string;
  readonly quantity: number;
  readonly unit: "call" | "file" | "byte";
}

/**
 * Receives usage events. `record` must not throw and must not block the caller: a failing sink
 * never fails a request. The implementation in this repository discards every event.
 */
export interface UsageSink {
  record(event: UsageEvent): void;
}

export const discardUsage: UsageSink = {
  record: () => {},
};
