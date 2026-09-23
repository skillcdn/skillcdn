import type { RepoPath } from "../repo-path.js";
import { findTool } from "./contracts.js";
import { describeMount, plural } from "./render.js";
import type { IndexDiagnostic, MountSummary } from "./results.js";

// What a client is told about a mount when it connects, before it calls anything: the server
// instructions and the description of find carry the catalog of skills, so that a model can tell
// whether this server matters for a task without a round trip.

export interface CatalogSkill {
  readonly name: string;
  /** Relative to the mounted root; empty for a skill at the root. */
  readonly directory: RepoPath;
  readonly description: string;
}

/** What the repository manifest (SKILLCDN.md) says about the mount, when there is one. */
export interface CatalogManifest {
  /** Absent: the repository goes by the name its git host gives it. */
  readonly name: string | undefined;
  readonly description: string;
  /** The manifest, relative to the mounted root; `undefined` when it lies above the mount. */
  readonly path: RepoPath | undefined;
  /** Whether the manifest has a body: rules that come with every skill. */
  readonly hasRules: boolean;
  /** The tag of the language the repository says it is written in. */
  readonly language: string | undefined;
}

export interface MountCatalog {
  readonly mount: MountSummary;
  readonly manifest: CatalogManifest | undefined;
  /** Every skill of the mount, up to the listing cap of `find`. */
  readonly skills: readonly CatalogSkill[];
  readonly skillCount: number;
  /** Documents outside the skills. */
  readonly documentCount: number;
  /** Manifests inside the mount that could not be read, so what they declare is not served. */
  readonly diagnostics: readonly IndexDiagnostic[];
}

export type CatalogState =
  | { readonly status: "ready"; readonly catalog: MountCatalog }
  | { readonly status: "indexing" | "failed"; readonly mount: MountSummary };

/**
 * Clients hand the instructions to the model as they are, and one of them cuts them at about
 * two thousand characters: everything has to fit below that, the list of skills included.
 */
export const INSTRUCTIONS_MAX_LENGTH = 2000;
/** The description of `find` names the skills as well, for clients that show no instructions. */
export const FIND_DESCRIPTION_MAX_LENGTH = 800;

/** How far a description is shortened before names alone have to do. */
const DESCRIPTION_CLIPS = [Number.POSITIVE_INFINITY, 240, 120, 60];
/** How many manifests that could not be read the instructions name. */
const NAMED_DIAGNOSTICS = 3;

const HOW_TO =
  "To use a skill, call get with its name, follow the instructions it returns, and read the " +
  "files it points to with read_file; the files it needs on every run come with it. find " +
  "matches words, in the language of the repository; read_file lists a directory when given one.";
const RULES_NOTE =
  "Rules that hold for every skill here come with each skill that get returns; follow them.";
/** How much of the manifest's description the instructions carry. */
const MANIFEST_DESCRIPTION_CLIP = 400;

function clip(text: string, length: number): string {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  return flat.length <= length ? flat : `${flat.slice(0, length - 1).trimEnd()}…`;
}

/** Skills that share a name are told apart by their directory. */
function labelOf(skill: CatalogSkill, skills: readonly CatalogSkill[]): string {
  const shared = skills.some((other) => other !== skill && other.name === skill.name);
  if (!shared) {
    return skill.name;
  }
  return `${skill.name} (${skill.directory.length === 0 ? "." : skill.directory})`;
}

function andMore(hidden: number, separator: string): string {
  return hidden <= 0
    ? ""
    : `${separator}(and ${hidden} more; find without a query lists every skill)`;
}

/**
 * The skills as a list of at most `budget` characters: descriptions are shortened step by step,
 * then only names are listed, then fewer names with a count of the rest.
 */
function skillList(catalog: MountCatalog, budget: number): string {
  const { skills, skillCount } = catalog;
  for (const length of DESCRIPTION_CLIPS) {
    const lines = skills.map(
      (skill) => `- ${labelOf(skill, skills)}: ${clip(skill.description, length)}`,
    );
    const text = `${lines.join("\n")}${andMore(skillCount - skills.length, "\n")}`;
    if (text.length <= budget) {
      return text;
    }
  }
  const names = skills.map((skill) => labelOf(skill, skills));
  for (let shown = names.length; shown > 0; shown -= 1) {
    const text = `${names.slice(0, shown).join(", ")}${andMore(skillCount - shown, " ")}`;
    if (text.length <= budget) {
      return text;
    }
  }
  return andMore(skillCount, "").slice(0, budget);
}

/**
 * A skill whose manifest could not be read is not in the list, and a model asked for it by
 * name would otherwise look for it in vain: the instructions say what was skipped.
 */
function skippedNote(diagnostics: readonly IndexDiagnostic[]): string {
  const count = diagnostics.length;
  if (count === 0) {
    return "";
  }
  const named = diagnostics.slice(0, NAMED_DIAGNOSTICS).map((diagnostic) => diagnostic.path);
  const rest = count > NAMED_DIAGNOSTICS ? ` and ${count - NAMED_DIAGNOSTICS} more` : "";
  return ` ${plural(count, "manifest")} could not be read and ${count === 1 ? "is" : "are"} not served (${named.join(", ")}${rest}); find without a query says why.`;
}

function languageNote(manifest: CatalogManifest | undefined): string {
  return manifest?.language === undefined ? "" : ` Written in ${manifest.language}.`;
}

/** The instructions a client hands to the model when it connects. */
export function renderInstructions(state: CatalogState): string {
  const mount = state.status === "ready" ? state.catalog.mount : state.mount;
  const manifest = state.status === "ready" ? state.catalog.manifest : undefined;
  // A repository with a manifest introduces itself; one without is introduced by its address.
  const opening =
    manifest === undefined
      ? `This server serves the skills and documents of the git repository ${describeMount(mount)}.`
      : `This server serves ${manifest.name ?? mount.repository}, the git repository ${describeMount(mount)}: ${clip(manifest.description, MANIFEST_DESCRIPTION_CLIP)}`;
  if (state.status !== "ready") {
    return state.status === "indexing"
      ? `${opening} The commit is being indexed; in a few seconds, find lists its skills. ${HOW_TO}`
      : `${opening} The commit could not be indexed and is retried automatically; read_file works in the meantime.`;
  }
  const { catalog } = state;
  const notes = `${languageNote(manifest)}${skippedNote(catalog.diagnostics)}`;
  if (catalog.skillCount === 0) {
    return `${opening} It has no skills; its ${plural(catalog.documentCount, "document")} can be searched with find and read with read_file.${notes}`;
  }
  const howTo = manifest?.hasRules === true ? `${HOW_TO} ${RULES_NOTE}` : HOW_TO;
  const head = `${opening} It has ${plural(catalog.skillCount, "skill")} and ${plural(catalog.documentCount, "other document")}.${notes}\nSkills:\n`;
  const budget = INSTRUCTIONS_MAX_LENGTH - head.length - howTo.length - 1;
  return `${head}${skillList(catalog, budget)}\n${howTo}`;
}

/** The description of `find`, with the skills named, for clients that show no instructions. */
export function describeFindTool(state: CatalogState): string {
  const base = findTool.description;
  if (state.status !== "ready") {
    return state.status === "indexing"
      ? `${base} This repository is being indexed; its skills can be listed in a few seconds.`
      : base;
  }
  const { catalog } = state;
  const language = languageNote(catalog.manifest);
  if (catalog.skillCount === 0) {
    return `${base}${language} This repository has no skills, only documents.`;
  }
  const lead = `${base}${language} Skills here: `;
  const names = catalog.skills.map((skill) => labelOf(skill, catalog.skills));
  for (let shown = names.length; shown > 0; shown -= 1) {
    const hidden = catalog.skillCount - shown;
    const text = `${lead}${names.slice(0, shown).join(", ")}${hidden > 0 ? ` (and ${hidden} more)` : ""}.`;
    if (text.length <= FIND_DESCRIPTION_MAX_LENGTH) {
      return text;
    }
  }
  return `${base}${language} This repository has ${plural(catalog.skillCount, "skill")}.`;
}
