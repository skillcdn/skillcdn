/**
 * Base class for errors that cross a boundary. `code` is stable and safe to show; `message` is for
 * logs. Edges translate the code into an HTTP or MCP error and never forward the message blindly.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}
