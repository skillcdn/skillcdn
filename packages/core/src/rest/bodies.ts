import { type Address, formatAddress, isPinnedAddress } from "../address.js";
import type { LicenseFact } from "../license.js";
import type { RepoTranslation } from "../repo-manifest.js";
import type { SkillTranslation } from "../skill-manifest.js";
import type { IndexNotReady, MountOverview, SkillLookup } from "../tools/reads.js";
import type {
  BrowseResult,
  DirectoryResult,
  FileResult,
  FindResult,
  IndexDiagnostic,
} from "../tools/results.js";
import type {
  RestBrowse,
  RestDiagnostic,
  RestFile,
  RestFind,
  RestLicense,
  RestMount,
  RestRepository,
  RestRepoTranslation,
  RestSkill,
  RestSkillTranslation,
} from "./contracts.js";

// The results of the reader, written as the REST API answers them (docs/specs/rest.md): one
// shape per route, built here so that every server that serves the API, a deployment or the
// command serving a directory, answers the same JSON. rest/results.ts reads them back. Absent
// values are `null` in the API, never missing keys.

export const notReadyBody = (outcome: IndexNotReady) =>
  outcome.status === "indexing"
    ? ({ status: "indexing" } as const)
    : ({ status: "failed", errorCode: outcome.errorCode } as const);

export function restSkillTranslations(
  translations: Readonly<Record<string, SkillTranslation>>,
): Record<string, RestSkillTranslation> {
  return Object.fromEntries(
    Object.entries(translations).map(([tag, entry]) => [
      tag,
      { title: entry.title ?? null, description: entry.description ?? null },
    ]),
  );
}

export function restRepoTranslations(
  translations: Readonly<Record<string, RepoTranslation>>,
): Record<string, RestRepoTranslation> {
  return Object.fromEntries(
    Object.entries(translations).map(([tag, entry]) => [
      tag,
      { name: entry.name ?? null, description: entry.description ?? null },
    ]),
  );
}

export const restLicenseOf = (license: LicenseFact): RestLicense => ({
  kind: license.kind,
  name: license.name ?? null,
  source: license.source ?? null,
});

/** The license of a skill entry or item, and whether this mount only describes it. */
function licensing(item: { readonly license?: LicenseFact; readonly describedOnly?: boolean }) {
  return {
    ...(item.license === undefined ? {} : { license: restLicenseOf(item.license) }),
    ...(item.describedOnly === true ? { describedOnly: true } : {}),
  };
}

const restDiagnostics = (diagnostics: readonly IndexDiagnostic[]): RestDiagnostic[] =>
  diagnostics.map((diagnostic) => ({
    path: diagnostic.path,
    code: diagnostic.code,
    message: diagnostic.message,
  }));

export function browseBody(
  answer: IndexNotReady | { readonly status: "ready"; readonly result: BrowseResult },
): RestBrowse {
  return answer.status !== "ready"
    ? notReadyBody(answer)
    : {
        status: "ready",
        commit: answer.result.mount.commit,
        path: answer.result.path,
        overview:
          answer.result.overview === undefined
            ? undefined
            : {
                path: answer.result.overview.path,
                title: answer.result.overview.title ?? null,
                description: answer.result.overview.description ?? null,
              },
        diagnostics: restDiagnostics(answer.result.diagnostics ?? []),
        entries: answer.result.entries.map(({ license, describedOnly, ...entry }) => ({
          ...entry,
          ...licensing({ license, describedOnly }),
        })),
        nextCursor: answer.result.nextCursor ?? null,
      };
}

export function findBody(
  answer: IndexNotReady | { readonly status: "ready"; readonly result: FindResult },
): RestFind {
  if (answer.status !== "ready") return notReadyBody(answer);
  const result = answer.result;
  return {
    status: "ready",
    commit: result.mount.commit,
    path: result.path ?? result.mount.path,
    nextCursor: result.nextCursor ?? null,
    query: result.query ?? null,
    totals: result.totals ?? null,
    diagnostics: restDiagnostics(result.diagnostics),
    items: result.items.map((item) =>
      item.kind === "skill"
        ? {
            kind: "skill",
            name: item.name,
            path: item.directory.length === 0 ? "SKILL.md" : `${item.directory}/SKILL.md`,
            directory: item.directory,
            description: item.description,
            translations: restSkillTranslations(item.translations),
            files: item.files.map((file) => ({
              path: file.path,
              title: file.title ?? null,
              summary: file.summary ?? null,
            })),
            moreFiles: item.moreFiles,
            ...licensing(item),
          }
        : {
            kind: "document",
            path: item.path,
            title: item.title ?? null,
            summary: item.summary ?? null,
            skillDirectory: item.skillDirectory ?? null,
          },
    ),
  };
}

/** What names an address to the `mounts` route, besides what its index says. */
export interface MountFacts {
  readonly address: Address;
  readonly repository: RestRepository;
  readonly commit: string;
  readonly verified: boolean;
  /**
   * Where the picture that stands for the address is loaded from (ADR-0031), given the manifest
   * of the mount when its index is ready: the operator's, else the manifest's, else `null`.
   */
  readonly image: (manifest: MountOverview["manifest"]) => string | null;
}

/** What an address serves, as the API says it: shared with the page rendered for browsers. */
export function mountBody(
  facts: MountFacts,
  answer: IndexNotReady | { readonly status: "ready"; readonly overview: MountOverview },
): RestMount {
  const ref = facts.address.ref;
  return {
    address: formatAddress(facts.address),
    repository: facts.repository,
    ref: ref === undefined ? null : ref.kind === "commit" ? ref.hash : ref.name,
    pinned: isPinnedAddress(facts.address),
    commit: facts.commit,
    path: facts.address.path,
    verified: facts.verified,
    image: facts.image(answer.status === "ready" ? answer.overview.manifest : undefined),
    index:
      answer.status !== "ready"
        ? notReadyBody(answer)
        : {
            status: "ready",
            truncated: answer.overview.mount.truncated,
            license: restLicenseOf(answer.overview.license),
            manifest:
              answer.overview.manifest === undefined
                ? null
                : {
                    path: answer.overview.manifest.path ?? null,
                    name: answer.overview.manifest.name ?? null,
                    description: answer.overview.manifest.description,
                    language: answer.overview.manifest.language ?? null,
                    translations: restRepoTranslations(answer.overview.manifest.translations),
                  },
            ...(answer.overview.overview === undefined
              ? {}
              : {
                  overview: {
                    path: answer.overview.overview.path,
                    title: answer.overview.overview.title ?? null,
                    description: answer.overview.overview.description ?? null,
                  },
                }),
            skillCount: answer.overview.skillCount,
            documentCount: answer.overview.documentCount,
            skills: answer.overview.skills.map((skill) => ({
              name: skill.name,
              path: skill.directory.length === 0 ? "SKILL.md" : `${skill.directory}/SKILL.md`,
              directory: skill.directory,
              description: skill.description,
              warnings: [...skill.warnings],
              translations: restSkillTranslations(skill.translations),
            })),
            documents: answer.overview.documents.map((document) => ({
              path: document.path,
              title: document.title ?? null,
              summary: document.summary ?? null,
            })),
            diagnostics: restDiagnostics(answer.overview.diagnostics),
            groups: (answer.overview.groups ?? []).map(({ license, describedOnly, ...entry }) => ({
              ...entry,
              ...licensing({ license, describedOnly }),
            })),
          },
  };
}

/** Why a skill could not be answered, with the HTTP status the API says it with. */
export interface RestFailure {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly directories?: readonly string[];
  readonly retryAfterSeconds?: number;
}

/** One skill as the API answers it: the body, or the failure with its status. */
export function skillOutcome(
  answer: IndexNotReady | { readonly status: "ready"; readonly lookup: SkillLookup },
): { readonly body: RestSkill } | { readonly failure: RestFailure } {
  if (answer.status !== "ready") {
    return { body: notReadyBody(answer) };
  }
  const { lookup } = answer;
  switch (lookup.kind) {
    case "not_found":
      return {
        failure: {
          status: 404,
          code: "skill.not_found",
          message: "No skill at that SKILL.md path in this mount.",
        },
      };
    case "ambiguous":
      return {
        failure: {
          status: 409,
          code: "skill.ambiguous",
          message: "Several skills share that name. Ask for a directory.",
          directories: [...lookup.directories],
        },
      };
    case "unavailable":
      return {
        failure: {
          status: 503,
          code: "skill.unavailable",
          message: "The skill is indexed but its content is not available.",
        },
      };
    case "found": {
      const { skill } = lookup;
      return {
        body: {
          status: "ready",
          commit: skill.mount.commit,
          skill: {
            path: skill.path ?? (skill.directory ? `${skill.directory}/SKILL.md` : "SKILL.md"),
            ruleChain: (skill.ruleChain ?? []).map((rule) => ({
              path: rule.path ?? "SKILLCDN.md",
              body: rule.body,
              truncated: rule.truncated,
            })),
            references: [...(skill.references ?? [])],
            complete: skill.complete ?? true,
            nextCursor: skill.nextCursor ?? null,
            includedContents: skill.included.map((file) => ({
              path: file.path,
              content: file.content ?? null,
              truncated: file.truncated,
            })),
            name: skill.name,
            directory: skill.directory,
            description: skill.description,
            license: skill.license ?? null,
            compatibility: skill.compatibility ?? null,
            allowedTools: skill.allowedTools ?? null,
            metadata: { ...skill.metadata },
            body: skill.body,
            files: [...skill.files],
            filesTruncated: skill.filesTruncated,
            ...(skill.oversized === undefined ? {} : { oversized: [...skill.oversized] }),
            included: skill.included.map((file) => file.path),
            warnings: [...skill.warnings],
            translations: restSkillTranslations(skill.translations),
            ...(skill.serving === undefined
              ? {}
              : {
                  serving: {
                    license: restLicenseOf(skill.serving.license),
                    full: skill.serving.full,
                    sourceUrl: skill.serving.sourceUrl,
                  },
                }),
            rules:
              skill.rules === undefined
                ? null
                : {
                    path: skill.rules.path ?? null,
                    body: skill.rules.body,
                    truncated: skill.rules.truncated,
                  },
          },
        },
      };
    }
  }
}

/** A page of a file, as the `files` route answers it. */
export function fileBody(file: FileResult): RestFile {
  return {
    kind: "file",
    commit: file.mount.commit,
    references: [...(file.references ?? [])],
    path: file.path,
    content: file.content,
    offset: file.offset,
    nextOffset: file.nextOffset ?? null,
    totalLength: file.totalLength,
  };
}

/** What a folder holds, as the `files` route answers a path that names one. */
export function directoryBody(directory: DirectoryResult): RestFile {
  return {
    kind: "directory",
    commit: directory.mount.commit,
    path: directory.path,
    entries: directory.entries.map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      size: entry.size ?? null,
    })),
    truncated: directory.truncated,
  };
}
