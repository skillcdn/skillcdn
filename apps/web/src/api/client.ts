import { ApiError, createClient } from "@skillcdn/client";
import type { Address, LegalDocumentKind, OwnerPath } from "@skillcdn/core";

// The only module that talks to the server: the client of @skillcdn/client at the page's own
// origin, so that the session cookie goes with every request as the browser sends it.
// Contract: docs/specs/rest.md; every response is parsed with the schemas the server is tested
// against.

export { ApiError };

const client = createClient({ baseUrl: "" });

export const api = {
  /** Whoever is signed in on this browser, or nobody. */
  me: (signal: AbortSignal) => client.me(signal),
  myRepositories: (signal: AbortSignal) => client.myRepositories(signal),
  myGrants: (signal: AbortSignal) => client.myGrants(signal),
  removeGrant: (id: string) => client.removeGrant(id),
  myTokens: (signal: AbortSignal) => client.myTokens(signal),
  /** Makes a token and answers with its secret, which the server shows this once. */
  makeToken: (request: Parameters<typeof client.makeToken>[0]) => client.makeToken(request),
  removeToken: (id: string) => client.removeToken(id),
  /** Whether the person signed in administers the repository at the host, and so may have it indexed now. */
  myIndex: (address: Address, signal: AbortSignal) => client.myIndex(address, signal),
  /** Asks, as an administrator, that the repository be indexed now; answers whether it was queued. */
  indexNow: (address: Address) => client.indexNow(address),
  signOut: () => client.signOut(),
  owner: (owner: OwnerPath, page: number, signal: AbortSignal) => client.owner(owner, page, signal),
  /** What a client asked a person to allow, for the consent page. */
  authorization: (request: string, signal: AbortSignal) => client.authorization(request, signal),
  /** The person's answer; the reply says where their browser goes with it. */
  decide: (request: string, approve: boolean) => client.decide(request, approve),
  /** What a command asked under a code, for the connect page, as the person signed in. */
  connection: (code: string, signal: AbortSignal) => client.connection(code, signal),
  /** The person's answer to a command that asked to connect. */
  decideConnection: (code: string, decision: Parameters<typeof client.decideConnection>[1]) =>
    client.decideConnection(code, decision),
  mount: (address: Address, signal: AbortSignal) => client.mount(address, signal),
  browse: (address: Address, path: string, signal: AbortSignal, cursor?: string) =>
    client.browse(address, { path, cursor, limit: 40 }, signal),
  find: (address: Address, query: string, path: string, signal: AbortSignal, cursor?: string) =>
    client.find(address, { query, path, cursor, limit: 25 }, signal),
  skill: (address: Address, path: string, signal: AbortSignal, cursor?: string) =>
    client.skill(address, { path, cursor }, signal),
  file: (address: Address, path: string, offset: number, signal: AbortSignal) =>
    client.file(address, { path, offset: offset === 0 ? undefined : offset }, signal),
  featured: (signal: AbortSignal) => client.featured(signal),
  /** The search across every pack (ADR-0070), for the page of a term. */
  search: (query: string, limit: number, signal: AbortSignal) =>
    client.search(query, limit, signal),
  showcase: (signal: AbortSignal) => client.showcase(signal),
  legal: (kind: LegalDocumentKind, signal: AbortSignal) => client.legal(kind, signal),
};
