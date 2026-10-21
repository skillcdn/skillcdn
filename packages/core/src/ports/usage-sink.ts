/**
 * A neutral record of something that happened: what, for which account and repository, how much.
 * `tool_call`: a tool was called, `subject` the tool. `index_completed`: a commit was indexed,
 * `quantity` its searchable files. `embedding`: sections of a commit were embedded for the search
 * by meaning (ADR-0064), `subject` the model and `quantity` the tokens the model read.
 */
export interface UsageEvent {
  readonly type: "tool_call" | "index_completed" | "embedding";
  readonly at: Date;
  /** The host's id of the account that owns the repository. */
  readonly hostAccountId: string;
  readonly hostRepoId: string;
  /** What was used, for example the tool name, or the model. */
  readonly subject: string;
  readonly quantity: number;
  readonly unit: "call" | "file" | "byte" | "token";
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
