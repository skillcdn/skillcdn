import {
  FEATURE_META_NAMES,
  LANDING_SECTIONS,
  type LandingSection,
  parseLandingSections,
} from "@skillcdn/core";
import { createContext, useContext } from "react";

// What a deployment has, as far as the pages care (ADR-0075): which sections the front page
// shows after its first screen, and whether the search across packs is there. The server writes
// both into the head of every page it serves; the render module is given the same with every
// page it renders, so that the browser hydrates what the server rendered. A page built without a
// server, and a deployment that says nothing, has everything.

export interface SiteFeatures {
  readonly landingSections: readonly LandingSection[];
  readonly search: boolean;
}

export const DEFAULT_FEATURES: SiteFeatures = { landingSections: LANDING_SECTIONS, search: true };

/** The features as the render module is given them: whatever the server knows, else nothing. */
export interface FeaturesInput {
  readonly landingSections?: readonly string[] | undefined;
  readonly search?: boolean | undefined;
}

/** The features of a render input, the defaults where it says nothing or something that is no section. */
export function featuresOf(input: FeaturesInput | undefined): SiteFeatures {
  const sections =
    input?.landingSections === undefined
      ? undefined
      : parseLandingSections(input.landingSections.join(","));
  return {
    landingSections: sections ?? DEFAULT_FEATURES.landingSections,
    search: input?.search ?? DEFAULT_FEATURES.search,
  };
}

/** What the server wrote into the head, read once before the first render in the browser. */
export function readSiteFeatures(): SiteFeatures {
  if (typeof document === "undefined") {
    return DEFAULT_FEATURES;
  }
  const content = (name: string): string | undefined => {
    const value = document.querySelector(`meta[name="${name}"]`)?.getAttribute("content");
    return value === null || value === undefined ? undefined : value;
  };
  const sections = content(FEATURE_META_NAMES.landingSections);
  return featuresOf({
    landingSections: sections === undefined ? undefined : sections.split(","),
    search: content(FEATURE_META_NAMES.search) !== "off",
  });
}

export const FeaturesContext = createContext<SiteFeatures>(DEFAULT_FEATURES);

export function useFeatures(): SiteFeatures {
  return useContext(FeaturesContext);
}
