import { createContext } from "react";

// Answers the server already has when it renders a page, keyed like the resources the page asks
// for (keys.ts). They travel in a JSON element of the page, so that the browser renders exactly
// what the server rendered and hydrates instead of loading everything again.

export interface InitialError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly directories?: readonly string[];
}

export type InitialResource =
  | { readonly ready: unknown; readonly error?: undefined }
  | { readonly error: InitialError; readonly ready?: undefined };

export type InitialData = Readonly<Record<string, InitialResource>>;

export const InitialDataContext = createContext<InitialData>({});

export const INITIAL_DATA_ELEMENT_ID = "skillcdn-data";

/** What the page carries for the browser, or nothing when it carries nothing readable. */
export function readInitialData(): InitialData {
  const element = document.getElementById(INITIAL_DATA_ELEMENT_ID);
  if (element === null) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(element.textContent ?? "");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as InitialData)
      : {};
  } catch {
    return {};
  }
}

/** The element that carries the data: JSON, with "<" escaped so that nothing in it is markup. */
export function renderInitialData(data: InitialData): string {
  const lessThan = `${String.fromCodePoint(92)}u003c`;
  return `<script type="application/json" id="${INITIAL_DATA_ELEMENT_ID}">${JSON.stringify(data).replaceAll("<", lessThan)}</script>`;
}
