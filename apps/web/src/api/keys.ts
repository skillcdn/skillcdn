import { type Address, formatAddress } from "@skillcdn/core";

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
} as const;
