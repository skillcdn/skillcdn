import { useEffect, useRef, useState } from "react";
import { ApiError } from "./client.js";

/** Continuation pages belong to one mounted view and stop loading when that view leaves. */
export function useMorePages<T>(load: (cursor: string, signal: AbortSignal) => Promise<T>) {
  const [pages, setPages] = useState<readonly T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError>();
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);

  const loadMore = (cursor: string | null) => {
    if (cursor === null || request.current !== undefined) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(undefined);
    load(cursor, controller.signal)
      .then(
        (page) => {
          if (!controller.signal.aborted) setPages((current) => [...current, page]);
        },
        (failure: unknown) => {
          if (!controller.signal.aborted) {
            setError(
              failure instanceof ApiError
                ? failure
                : new ApiError(0, "unknown", "Unexpected failure."),
            );
          }
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) {
          request.current = undefined;
          setLoading(false);
        }
      });
  };
  const reset = () => {
    request.current?.abort();
    request.current = undefined;
    setPages([]);
    setLoading(false);
    setError(undefined);
  };
  return { pages, loading, error, loadMore, reset };
}
