import { useEffect, useRef, useState } from "react";
import { ApiError } from "./client.js";

export type Resource<T> =
  | { readonly state: "loading" }
  /** `stalled`: the value still asks to be polled, but polling gave up. */
  | { readonly state: "ready"; readonly value: T; readonly stalled: boolean }
  | { readonly state: "error"; readonly error: ApiError };

const POLL_INTERVAL_MS = 1500;
/** About a minute. Indexing normally takes seconds; past this the page says so and stops asking. */
const MAX_POLLS = 40;

/**
 * Loads something from the API whenever `key` changes, and keeps asking while `pollWhile` says
 * the answer is provisional (an index that is still being built).
 */
export function useResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  pollWhile?: (value: T) => boolean,
): Resource<T> & { readonly reload: () => void } {
  const [resource, setResource] = useState<Resource<T>>({ state: "loading" });
  const [version, setVersion] = useState(0);
  // The latest closures, without making them dependencies: callers pass fresh ones every render.
  const loadRef = useRef(load);
  const pollWhileRef = useRef(pollWhile);
  loadRef.current = load;
  pollWhileRef.current = pollWhile;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` and `version` are the triggers
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    setResource({ state: "loading" });

    const run = async (): Promise<void> => {
      try {
        const value = await loadRef.current(controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        polls += 1;
        const provisional = pollWhileRef.current?.(value) === true;
        const stalled = provisional && polls >= MAX_POLLS;
        setResource({ state: "ready", value, stalled });
        if (provisional && !stalled) {
          timer = setTimeout(() => void run(), POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setResource({
            state: "error",
            error:
              error instanceof ApiError ? error : new ApiError(0, "unknown", "Unexpected failure."),
          });
        }
      }
    };
    void run();

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, version]);

  return { ...resource, reload: () => setVersion((current) => current + 1) };
}
