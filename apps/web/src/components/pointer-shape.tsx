const POINTER_PATH =
  "M4 2.8a.7.7 0 0 0-1.2.5v18.4a.7.7 0 0 0 1.2.5l4.3-4.1 3.7 7.2a.9.9 0 0 0 1.2.4l2.5-1.3a.9.9 0 0 0 .4-1.2l-3.7-7.1 5.9-1.1a.7.7 0 0 0 .3-1.2L4 2.8Z";

/** The pointer of everything the pages play: its tip is near the top left of its box. */
export function PointerShape() {
  return (
    <svg viewBox="0 0 24 28" fill="none" aria-hidden="true" focusable="false">
      <path d={POINTER_PATH} />
    </svg>
  );
}
