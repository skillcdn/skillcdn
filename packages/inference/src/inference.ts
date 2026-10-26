import { DomainError } from "@skillcdn/core";

// What the two inference adapters share (ADR-0064, ADR-0065): one JSON call to a server the
// operator named, with the credential it may want, bounded in time and in what it may answer; a
// gate that lets a few calls run at once and sheds the rest when they cannot start in time, so
// that a burst of searches does not pile onto a server that is busy embedding; a breaker that
// stops asking a server that keeps failing, so that a search is not made to wait its whole
// timeout on a server that is down; and failures told apart by what a caller does about them.

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type InferenceErrorCode =
  /**
   * The server could not be reached, did not answer in time, or is being left alone after
   * failing repeatedly. Worth trying again later.
   */
  | "inference_unreachable"
  /** The server said it is overloaded, or the call could not start before its time was up. */
  | "inference_busy"
  /** The server answered with a failure of its own (5xx). Worth trying again later. */
  | "inference_failed"
  /** The server refused the request (4xx): a model it does not serve, an input it does not take. */
  | "inference_refused"
  /** The server answered something other than the shape agreed, or the wrong number of things. */
  | "inference_malformed"
  /** The call asked for more than one call takes: the caller's mistake, never worth a retry. */
  | "inference_too_many";

export class InferenceError extends DomainError {
  override readonly code: InferenceErrorCode;

  constructor(code: InferenceErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(code, message, options);
    this.code = code;
  }
}

/** Whether a failure is the server's moment rather than the request: the kind a retry may mend. */
export function isTransientInferenceError(error: unknown): boolean {
  return (
    error instanceof InferenceError &&
    (error.code === "inference_unreachable" ||
      error.code === "inference_busy" ||
      error.code === "inference_failed")
  );
}

/** Cuts a text to `max` characters, never through a surrogate pair. */
/**
 * The shape of an answer that is not what was expected, for the message of the error that says
 * so: its type, how many items or characters it has, and the names of its keys, never a value.
 * An inference server that answers something else now and then is found by what it answered.
 */
export function describeShape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `an array of ${value.length}${value.length === 0 ? "" : `, the first ${describeShape(value[0])}`}`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    const shown = keys.slice(0, 8).join(", ");
    return keys.length === 0
      ? "an object with no keys"
      : `an object with keys ${shown}${keys.length > 8 ? ` and ${keys.length - 8} more` : ""}`;
  }
  if (typeof value === "string") return `a string of ${value.length} characters`;
  return `a ${typeof value}`;
}

export function cutText(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

export interface Gate {
  /**
   * Runs `work` once one of the slots is free, within `timeoutMs` of now, and gives it what is
   * left of that time. A call that cannot start in time fails as busy without being sent.
   */
  run<T>(timeoutMs: number, work: (remainingMs: number) => Promise<T>): Promise<T>;
}

interface Waiter {
  readonly start: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** Lets `concurrency` calls run at once from this process; the rest wait their turn, in order. */
export function createGate(concurrency: number, now: () => number = Date.now): Gate {
  let running = 0;
  const waiting: Waiter[] = [];
  const release = () => {
    const next = waiting.shift();
    if (next === undefined) {
      running -= 1;
      return;
    }
    // The slot passes straight on: whoever waited longest runs next.
    clearTimeout(next.timer);
    next.start();
  };
  return {
    async run(timeoutMs, work) {
      const asked = now();
      if (running < concurrency) {
        running += 1;
      } else {
        await new Promise<void>((resolve, reject) => {
          const waiter: Waiter = {
            start: resolve,
            timer: setTimeout(() => {
              waiting.splice(waiting.indexOf(waiter), 1);
              reject(
                new InferenceError(
                  "inference_busy",
                  `the inference server is busy: a call waited ${timeoutMs} ms for its turn`,
                ),
              );
            }, timeoutMs),
          };
          waiting.push(waiter);
        });
      }
      try {
        return await work(Math.max(1, timeoutMs - (now() - asked)));
      } finally {
        release();
      }
    },
  };
}

export interface BreakerOptions {
  /** Transient failures in a row after which the server is left alone. */
  readonly failures: number;
  /** How long it is left alone before one call tries it again. */
  readonly cooldownMs: number;
}

export interface Breaker {
  /** Runs `work`, unless the server is being left alone: then it fails at once, as unreachable. */
  run<T>(work: () => Promise<T>): Promise<T>;
}

/**
 * After `failures` transient failures in a row, every call fails at once for `cooldownMs`; then
 * one call is let through, and the rest fail until it has answered: the server is back when it
 * does. A refusal or a malformed answer is the server answering, and closes the breaker.
 */
export function createBreaker(options: BreakerOptions, now: () => number = Date.now): Breaker {
  let failures = 0;
  let openedAt: number | undefined;
  let probing = false;
  return {
    async run(work) {
      if (openedAt !== undefined) {
        if (probing || now() - openedAt < options.cooldownMs) {
          throw new InferenceError(
            "inference_unreachable",
            "the inference server failed repeatedly and is not asked again yet",
          );
        }
        probing = true;
      }
      try {
        const result = await work();
        failures = 0;
        openedAt = undefined;
        probing = false;
        return result;
      } catch (error) {
        probing = false;
        if (isTransientInferenceError(error)) {
          failures += 1;
          if (failures >= options.failures || openedAt !== undefined) {
            openedAt = now();
          }
        } else {
          failures = 0;
          openedAt = undefined;
        }
        throw error;
      }
    },
  };
}

export interface InferenceCall {
  /** The endpoint itself. Operator configuration, never user input. */
  readonly url: string;
  /** Sent as a bearer token when the server wants one. */
  readonly key: string | undefined;
  readonly userAgent: string;
  readonly fetch: FetchLike;
  readonly timeoutMs: number;
  /** The most bytes an answer may have: past them it is malformed, whatever it was going to be. */
  readonly maxReplyBytes: number;
}

/** How much of what a server said in refusing is kept in the error, for the log. */
const REFUSAL_EXCERPT = 200;

/** Reads a body up to `maxBytes`, then stops: `content-length` is a hint, not a promise. */
async function readText(response: Response, maxBytes: number): Promise<string | undefined> {
  if (response.body === null) {
    return "";
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

/** One line of what the server said, with nothing in it that a log should not carry. */
function excerpt(text: string): string {
  const line = text.replace(/[\p{C}\s]+/gu, " ").trim();
  return line.length > REFUSAL_EXCERPT ? `${line.slice(0, REFUSAL_EXCERPT)}…` : line;
}

/**
 * The failure of a call the server did not answer. One whose time ran out, waiting for the answer
 * or reading it, says so with the time it had, since such a server is busy as often as it is
 * away; one that never reached the server says that.
 */
function unanswered(call: InferenceCall, error: unknown): InferenceError {
  const timedOut = error instanceof Error && error.name === "TimeoutError";
  // The cause stays attached for the log; the message carries nothing of the request.
  return new InferenceError(
    "inference_unreachable",
    timedOut
      ? `the inference server did not answer within ${call.timeoutMs} ms`
      : "the inference server could not be reached",
    { cause: error },
  );
}

/** The answer read as {@link readText} reads it, within the time of the call. */
async function readAnswer(
  call: InferenceCall,
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  try {
    return await readText(response, maxBytes);
  } catch (error) {
    throw unanswered(call, error);
  }
}

/**
 * POSTs `body` as JSON and returns the JSON the server answered with. A redirect is not followed:
 * the credential goes to the URL the operator named and nowhere else.
 */
export async function postJson(call: InferenceCall, body: unknown): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": call.userAgent,
  };
  if (call.key !== undefined && call.key.length > 0) {
    headers.authorization = `Bearer ${call.key}`;
  }
  let response: Response;
  try {
    response = await call.fetch(call.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(call.timeoutMs),
    });
  } catch (error) {
    throw unanswered(call, error);
  }
  if (response.status === 429) {
    await response.body?.cancel();
    throw new InferenceError("inference_busy", "the inference server is overloaded");
  }
  if (response.status >= 500) {
    await response.body?.cancel();
    throw new InferenceError(
      "inference_failed",
      `the inference server answered ${response.status}`,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    const said = (await readAnswer(call, response, REFUSAL_EXCERPT * 4)) ?? "";
    throw new InferenceError(
      "inference_refused",
      `the inference server refused the request (${response.status}): ${excerpt(said)}`,
    );
  }
  const text = await readAnswer(call, response, call.maxReplyBytes);
  if (text === undefined) {
    throw new InferenceError(
      "inference_malformed",
      `the inference server answered more than ${call.maxReplyBytes} bytes`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    // What it answered instead is described by its type and size, never quoted: a proxy's error
    // page or a stream of another shape is found by that much.
    const type = response.headers.get("content-type") ?? "no content type";
    throw new InferenceError(
      "inference_malformed",
      `the inference server did not answer JSON (${type}, ${text.length} characters)`,
      { cause: error },
    );
  }
}
