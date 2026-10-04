import { describe, expect, it } from "vitest";
import { isDocumentClientId } from "./clients.js";
import { isPublicAddress } from "./document-fetch.js";
import {
  isLocalRedirect,
  isLoopbackRedirect,
  isRegisteredRedirect,
  redirectHostOf,
  redirectUriProblem,
} from "./redirects.js";

describe("redirect URIs", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "https://client.example/callback?tenant=1",
    "http://localhost/callback",
    "http://localhost:43110/callback",
    "http://127.0.0.1:8080/",
    "http://[::1]:9000/cb",
    "cursor://anysphere.cursor-mcp/oauth/callback",
    "com.example.app:/oauth2redirect",
  ])("may be %s", (uri) => {
    expect(redirectUriProblem(uri)).toBeUndefined();
  });

  it.each([
    "http://client.example/callback",
    "http://127.0.0.1.evil.test/callback",
    "http://localhost.evil.test/callback",
    "http://10.0.0.5/callback",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>1</script>",
    "vbscript:x",
    "file:///etc/passwd",
    "blob:https://client.example/1",
    "https://client.example/callback#token",
    "https://client.example/callback#",
    "https://user:secret@client.example/callback",
    "/callback",
    "client.example/callback",
    "",
    "https://",
    `https://client.example/${"a".repeat(2000)}`,
  ])("may not be %j", (uri) => {
    expect(redirectUriProblem(uri)).toEqual(expect.any(String));
  });

  it("match what was registered exactly, but for the port of a client on this computer", () => {
    const registered = ["https://client.example/callback", "http://127.0.0.1:43110/callback"];
    expect(isRegisteredRedirect(registered, "https://client.example/callback")).toBe(true);
    expect(isRegisteredRedirect(registered, "http://127.0.0.1:43110/callback")).toBe(true);
    expect(isRegisteredRedirect(registered, "http://127.0.0.1:5000/callback")).toBe(true);
    expect(isRegisteredRedirect(registered, "http://127.0.0.1/callback")).toBe(true);
    for (const presented of [
      "https://client.example/callback/",
      "https://client.example/callback?x=1",
      "https://client.example:8443/callback",
      "https://CLIENT.example/callback",
      "https://evil.test/callback",
      "http://127.0.0.1:5000/other",
      "http://127.0.0.1:5000/callback?x=1",
      "http://localhost:5000/callback",
      "http://[::1]:5000/callback",
      "",
    ]) {
      expect(isRegisteredRedirect(registered, presented), presented).toBe(false);
    }
    // A registered https URI never lends its path to another port.
    expect(
      isRegisteredRedirect(["https://client.example/callback"], "http://localhost/callback"),
    ).toBe(false);
  });

  it("are told apart by where they lead", () => {
    expect(isLoopbackRedirect("http://localhost:1234/cb")).toBe(true);
    expect(isLoopbackRedirect("https://localhost:1234/cb")).toBe(false);
    expect(isLoopbackRedirect("http://localhost.evil.test/cb")).toBe(false);
    expect(redirectHostOf("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
    expect(redirectHostOf("http://127.0.0.1:43110/callback")).toBe("127.0.0.1:43110");
    expect(redirectHostOf("com.example.app:/oauth2redirect")).toBe("com.example.app:");
    // A scheme of an app's own leads to that app, whatever it writes after the scheme. What
    // looks like a host there names no site, and is never shown as where the answer goes.
    expect(redirectHostOf("cursor://anysphere.cursor-mcp/oauth/callback")).toBe("cursor:");
    expect(redirectHostOf("com.evil.app://github.com/callback")).toBe("com.evil.app:");
    expect(redirectHostOf("com.evil.app://claude.ai:443/callback")).toBe("com.evil.app:");

    // An app on the person's own computer: one of its addresses, or a scheme an app answers to.
    for (const local of [
      "http://127.0.0.1:43110/callback",
      "http://localhost/cb",
      "cursor://anysphere.cursor-mcp/oauth/callback",
      "com.evil.app://github.com/callback",
    ]) {
      expect(isLocalRedirect(local), local).toBe(true);
    }
    for (const site of ["https://claude.ai/api/mcp/auth_callback", "https://localhost/cb", ""]) {
      expect(isLocalRedirect(site), site).toBe(false);
    }
  });
});

describe("the URL of a client's metadata document", () => {
  it.each([
    "https://chatgpt.com/oauth/client.json",
    "https://client.example/oauth/a1b2c3/client.json",
    "https://client.example/metadata?version=2",
  ])("can be %s", (id) => {
    expect(isDocumentClientId(id)).toBe(true);
  });

  it.each([
    "scdn_client_abc",
    "http://client.example/client.json",
    "https://client.example",
    "https://client.example/",
    "https://client.example:8443/client.json",
    "https://user@client.example/client.json",
    "https://client.example/a/../client.json",
    "https://client.example/./client.json",
    "https://client.example/client.json#fragment",
    "https://CLIENT.example/client.json",
    "https://client.example/client.json ",
    `https://client.example/${String.fromCodePoint(0x202e)}client.json`,
    `https://client.example/${"a".repeat(1100)}`,
    "",
  ])("cannot be %j", (id) => {
    expect(isDocumentClientId(id)).toBe(false);
  });
});

describe("where a document may be fetched from", () => {
  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "the public internet: %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it.each([
    "127.0.0.1",
    "127.8.9.10",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:7f00:1",
    "64:ff9b::7f00:1",
    // An IPv4 address carried inside an IPv6 one leads where the inner address does.
    "::127.0.0.1",
    "::7f00:1",
    "64:ff9b:1::a00:1",
    "2002:7f00:1::1",
    "2002:a9fe:a9fe::1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "not an address",
    "",
  ])("nowhere else: %j", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});
