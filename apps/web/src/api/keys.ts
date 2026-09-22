import { type Address, formatAddress } from "@skillcdn/core";

// One key per thing the UI loads. A page asks for a resource by key; a page rendered on the
// server hands the browser the answers by the same keys (initial-data.ts).

export const resourceKeys = {
  mount: (address: Address): string => formatAddress(address),
  find: (address: Address, query: string): string => `${formatAddress(address)} find ${query}`,
  skill: (address: Address, name: string): string => `${formatAddress(address)} skill ${name}`,
  file: (address: Address, path: string): string => `${formatAddress(address)} file ${path}`,
} as const;
