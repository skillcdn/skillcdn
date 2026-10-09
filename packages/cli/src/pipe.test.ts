import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { guardBrokenPipe } from "./pipe.js";

const streamError = (code: string, message: string): NodeJS.ErrnoException =>
  Object.assign(new Error(message), { code });

describe("the output stream of the command", () => {
  it("ends quietly when the reader of its output goes away", () => {
    const stream = new EventEmitter();
    const exits: number[] = [];
    guardBrokenPipe(stream, (code) => {
      exits.push(code);
    });
    stream.emit("error", streamError("EPIPE", "broken pipe"));
    expect(exits).toEqual([0]);
  });

  it("still fails on any other error of the stream", () => {
    const stream = new EventEmitter();
    const exits: number[] = [];
    guardBrokenPipe(stream, (code) => {
      exits.push(code);
    });
    expect(() => stream.emit("error", streamError("ENOSPC", "no space left"))).toThrow(
      "no space left",
    );
    expect(exits).toEqual([]);
  });
});
