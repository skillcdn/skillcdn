/** What a writable stream reports an error with: a Node.js error carries a code. */
interface StreamWithErrors {
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
}

/**
 * A reader that stops early (`skillcdn check | head`) closes the pipe, and the next write fails
 * with `EPIPE`. That is the reader's choice, not a failure of the command: it ends quietly. Any
 * other error of the stream is rethrown, so that it is seen.
 */
export function guardBrokenPipe(stream: StreamWithErrors, exit: (code: number) => void): void {
  stream.on("error", (error) => {
    if (error.code === "EPIPE") {
      exit(0);
      return;
    }
    throw error;
  });
}
