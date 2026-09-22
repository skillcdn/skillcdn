import { useContext, useEffect, useRef, useState } from "react";
import { ApiError } from "./client.js";
import { InitialDataContext, type InitialResource } from "./initial-data.js";

export type Resource<T> =
  | { readonly state: "loading" }
  /** `stalled`: the value still asks to be polled, but polling gave up. */
  | { readonly state: "ready"; readonly value: T; readonly stalled: boolean }
  | { readonly state: "error"; readonly error: ApiError };

const POLL_INTERVAL_MS = 1500;
/** About a minute. Indexing normally takes seconds; past this the page says so and stops asking. */
const MAX_POLLS = 40;

/** An answer the server rendered the page with, as the resource it stands for. */
function fromInitial<T>(initial: InitialResource): Resource<T> {
  if (initial.error !== undefined) {
    const { status, code, message, directories } = initial.error;
    return { state: "error", error: new ApiError(status, code, message, directories) };
  }
  return { state: "ready", value: initial.ready as T, stalled: false };
}

/**
 * Loads something from the API whenever `key` changes, and keeps asking while `pollWhile` says
 * the answer is provisional (an index that is still being built). An answer the server rendered
 * the page with is used as it is, and only asked again while it is provisional.
 */
export function useResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  pollWhile?: (value: T) => boolean,
): Resource<T> & { readonly reload: () => void } {
  const initial = useContext(InitialDataContext)[key];
  const [resource, setResource] = useState<Resource<T>>(() =>
    initial === undefined ? { state: "loading" } : fromInitial<T>(initial),
  );
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

    const given = version === 0 && initial !== undefined ? fromInitial<T>(initial) : undefined;
    if (given === undefined) {
      setResource({ state: "loading" });
      void run();
    } else {
      setResource(given);
      if (given.state === "ready" && pollWhileRef.current?.(given.value) === true) {
        timer = setTimeout(() => void run(), POLL_INTERVAL_MS);
      }
    }

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, version]);

  return { ...resource, reload: () => setVersion((current) => current + 1) };
}
