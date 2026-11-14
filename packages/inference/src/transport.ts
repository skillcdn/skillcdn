import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import type { FetchLike } from "./inference.js";

// How a call reaches an inference server, for whoever has no transport of their own to hand to
// the adapters. The platform's `fetch` gives up on a server that has not begun to answer after
// five minutes, and on one that pauses as long in the middle of its answer, whatever time the
// call was given: those limits are the client's own, and a call cannot change them. A batch of
// long texts embedded on a machine without a GPU takes longer than that, so a timeout a
// deployment had set above five minutes never applied, and the same texts failed every time
// they were tried. This is Node's HTTP client answering as `fetch` answers: it waits for as long
// as the signal of the call lets it, and no longer.

/** The statuses whose answer has no body: a `Response` cannot be made of one with a body. */
const WITHOUT_BODY = new Set([204, 205, 304]);

/**
 * `fetch` for one call to an inference server: the method, the headers and a text body are sent,
 * the status, the headers and the body come back, and the call ends when its signal says so, with
 * the signal's reason, as `fetch` ends it. A redirect is answered as it came and never followed.
 */
export const inferenceFetch: FetchLike = (input, init) =>
  new Promise<Response>((resolve, reject) => {
    const signal = init.signal ?? undefined;
    // A call its signal ended fails with what the signal says, so that a timeout reads as one.
    const failure = (error: unknown): unknown => (signal?.aborted === true ? signal.reason : error);
    let url: URL;
    try {
      url = new URL(input);
    } catch (error) {
      reject(error);
      return;
    }
    const send = url.protocol === "https:" ? requestHttps : requestHttp;
    const request = send(
      url,
      {
        method: init.method ?? "GET",
        headers: Object.fromEntries(new Headers(init.headers ?? undefined)),
        ...(signal === undefined ? {} : { signal }),
      },
      (incoming) => {
        const status = incoming.statusCode ?? 502;
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
            headers.append(name, item);
          }
        }
        try {
          if (WITHOUT_BODY.has(status)) {
            incoming.resume();
            resolve(new Response(null, { status, headers }));
            return;
          }
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              incoming.on("data", (chunk: Buffer) => {
                controller.enqueue(new Uint8Array(chunk));
                // Whoever reads decides how fast the answer comes in.
                if ((controller.desiredSize ?? 0) <= 0) {
                  incoming.pause();
                }
              });
              incoming.once("end", () => controller.close());
              incoming.once("error", (error) => controller.error(failure(error)));
            },
            pull() {
              incoming.resume();
            },
            cancel() {
              incoming.destroy();
            },
          });
          resolve(new Response(body, { status, headers }));
        } catch (error) {
          // A status no `Response` takes: the server answered something that is not HTTP's.
          incoming.destroy();
          reject(error);
        }
      },
    );
    request.once("error", (error) => reject(failure(error)));
    request.end(typeof init.body === "string" ? init.body : undefined);
  });
