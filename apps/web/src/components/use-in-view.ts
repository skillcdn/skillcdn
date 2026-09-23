import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Whether the element the ref is put on is on screen, for things that should only run, or
 * only load, while somebody can see them. False on the server and until the first observation.
 */
export function useInView<T extends Element>(
  threshold = 0.2,
): { readonly ref: RefObject<T | null>; readonly inView: boolean } {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);
  return { ref, inView };
}
