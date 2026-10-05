import {
  type Address,
  formatAddress,
  formatOwnerPath,
  type LegalDocumentKind,
  type OwnerPath,
} from "@skillcdn/core";

// One key per thing the UI loads. A page asks for a resource by key; a page rendered on the
// server hands the browser the answers by the same keys (initial-data.ts).

export const resourceKeys = {
  mount: (address: Address): string => formatAddress(address),
  browse: (address: Address, path: string = address.path): string =>
    `${formatAddress(address)} browse ${JSON.stringify(path)}`,
  find: (address: Address, query: string, path: string = address.path): string =>
    `${formatAddress(address)} find ${JSON.stringify([path, query])}`,
  skill: (address: Address, path: string): string => `${formatAddress(address)} skill ${path}`,
  file: (address: Address, path: string): string => `${formatAddress(address)} file ${path}`,
  /** The landing showcase: one for the whole site. */
  showcase: (): string => "showcase",
  /** A page of the deployment's own: its terms or its privacy policy. */
  legal: (kind: LegalDocumentKind): string => `legal ${kind}`,
  /** The page of an account. */
  owner: (owner: OwnerPath): string => `owner ${formatOwnerPath(owner)}`,
  /** What is the signed-in person's: asked again whenever someone else signs in. */
  myRepositories: (login: string): string => `me ${login} repositories`,
  myGrants: (login: string): string => `me ${login} grants`,
  myTokens: (login: string): string => `me ${login} tokens`,
  /** What a client asked to be allowed, as whoever is looking sees it. */
  authorization: (request: string, login: string | undefined): string =>
    `authorization ${login ?? ""} ${request}`,
} as const;
