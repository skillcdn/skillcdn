import { describe, expect, it } from "vitest";
import { onPageRestored } from "./session.js";

/** A `pageshow` as a browser sends it: `persisted` says the page came back out of its cache. */
function pageshow(persisted: boolean): Event {
  return Object.assign(new Event("pageshow"), { persisted });
}

describe("a page the browser brings back as it was left", () => {
  it("is told so, and a page that was loaded is not", () => {
    const page = new EventTarget();
    let told = 0;
    const stop = onPageRestored(page, () => {
      told += 1;
    });
    // A page that was loaded asks who is signed in as it comes up; showing it says nothing new.
    page.dispatchEvent(pageshow(false));
    expect(told).toBe(0);
    // Back out of the back-forward cache: whoever signed in or out since is not on it.
    page.dispatchEvent(pageshow(true));
    page.dispatchEvent(pageshow(true));
    expect(told).toBe(2);
    page.dispatchEvent(new Event("pagehide"));
    expect(told).toBe(2);
    stop();
    page.dispatchEvent(pageshow(true));
    expect(told).toBe(2);
  });
});
