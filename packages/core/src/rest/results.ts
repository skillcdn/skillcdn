import { type Address, parseAddress } from "../address.js";
import type { LicenseFact } from "../license.js";
import { parseRepoPath, type RepoPath, ROOT_PATH } from "../repo-path.js";
import type { SkillTranslation } from "../skill-manifest.js";
import { skillUriPrefix } from "../skill-uri.js";
import type { CatalogState } from "../tools/catalog.js";
import type {
  BrowseEntry,
  BrowseResult,
  DirectoryResult,
  FileResult,
  FindItem,
  FindResult,
  FolderOverview,
  IncludedFile,
  IndexDiagnostic,
  MountSummary,
  SkillResult,
  SkillRules,
} from "../tools/results.js";
import type {
  RestBrowse,
  RestBrowseEntry,
  RestDiagnostic,
  RestFile,
  RestFind,
  RestFolderOverview,
  RestLicense,
  RestMount,
  RestSkill,
  RestSkillTranslation,
} from "./contracts.js";

// The REST API's answers read back as the results they were made from (rest/bodies.ts), so
// that a program on the REST API renders what an MCP client's model is given, with the same
// words (tools/render.ts). The answers come from someone else's server: a path that is not one
// is dropped, and a result that cannot be read as one is `undefined`.

type Ready<T extends { status: string }> = Extract<T, { status: "ready" }>;

const pathOf = (text: string): RepoPath | undefined => {
  const parsed = parseRepoPath(text);
  return parsed.ok ? parsed.value : undefined;
};

const orUndefined = <T>(value: T | null): T | undefined => (value === null ? undefined : value);

const licenseOf = (license: RestLicense): LicenseFact => ({
  kind: license.kind,
  name: orUndefined(license.name),
  source: license.source === null ? undefined : pathOf(license.source),
});

function translationsOf(
  translations: Readonly<Record<string, RestSkillTranslation>>,
): Record<string, SkillTranslation> {
  const read: Record<string, SkillTranslation> = Object.create(null);
  for (const [tag, entry] of Object.entries(translations)) {
    read[tag] = { title: orUndefined(entry.title), description: orUndefined(entry.description) };
  }
  return read;
}

const diagnosticsOf = (diagnostics: readonly RestDiagnostic[] | undefined): IndexDiagnostic[] =>
  (diagnostics ?? []).flatMap((diagnostic) => {
    const path = pathOf(diagnostic.path);
    return path === undefined ? [] : [{ path, code: diagnostic.code, message: diagnostic.message }];
  });

function overviewOf(overview: RestFolderOverview | undefined): FolderOverview | undefined {
  const path = overview === undefined ? undefined : pathOf(overview.path);
  return overview === undefined || path === undefined
    ? undefined
    : {
        path,
        title: orUndefined(overview.title),
        description: orUndefined(overview.description),
      };
}

/** The address a `mounts` answer names, as parsed, or one built from its repository. */
export function addressOfMount(mount: RestMount): Address {
  const parsed = parseAddress(mount.address);
  if (parsed.ok) {
    return parsed.value;
  }
  return {
    host: mount.repository.host,
    owner: mount.repository.owner,
    repo: mount.repository.name,
    ref: mount.ref === null ? undefined : { kind: "name", name: mount.ref },
    path: pathOf(mount.path) ?? ROOT_PATH,
  };
}

/** What a result names as where it came from, from the `mounts` answer of the address. */
export function mountSummaryOf(mount: RestMount): MountSummary {
  const address = addressOfMount(mount);
  return {
    repository: `${mount.repository.owner}/${mount.repository.name}`,
    ref: orUndefined(mount.ref),
    commit: mount.commit,
    path: address.path,
    verified: mount.verified,
    ...(mount.repository.visibility === undefined
      ? {}
      : { visibility: mount.repository.visibility }),
    truncated: mount.index.status === "ready" ? mount.index.truncated : false,
    skillUri: skillUriPrefix(address),
  };
}

/** The same summary for a result read later, at the commit that result names. */
const summaryAt = (mount: MountSummary, commit: string | undefined): MountSummary =>
  commit === undefined || commit === mount.commit ? mount : { ...mount, commit };

/**
 * What a client is told on connect, made from the `mounts` answer: the catalog
 * `renderInstructions` writes the connection instructions from.
 */
export function catalogStateOf(mount: RestMount): CatalogState {
  const summary = mountSummaryOf(mount);
  const description = orUndefined(mount.repository.description);
  if (mount.index.status !== "ready") {
    return { status: mount.index.status, mount: summary, description };
  }
  const manifest = mount.index.manifest;
  return {
    status: "ready",
    catalog: {
      overview: overviewOf(mount.index.overview),
      description,
      mount: summary,
      manifest:
        manifest === null
          ? undefined
          : {
              name: orUndefined(manifest.name),
              description: manifest.description,
              path: manifest.path === null ? undefined : pathOf(manifest.path),
              language: orUndefined(manifest.language),
            },
      skills: mount.index.skills.flatMap((skill) => {
        const directory = pathOf(skill.directory);
        return directory === undefined
          ? []
          : [{ name: skill.name, directory, description: skill.description }];
      }),
      skillCount: mount.index.skillCount,
      documentCount: mount.index.documentCount,
      diagnostics: diagnosticsOf(mount.index.diagnostics),
      ...(mount.index.groups === undefined ? {} : { groups: entriesOf(mount.index.groups) }),
    },
  };
}

function entriesOf(entries: readonly RestBrowseEntry[]): BrowseEntry[] {
  return entries.flatMap((entry) => {
    const path = pathOf(entry.path);
    if (path === undefined) {
      return [];
    }
    const browsePath = entry.browsePath === undefined ? undefined : pathOf(entry.browsePath);
    const overviewPath = entry.overviewPath === undefined ? undefined : pathOf(entry.overviewPath);
    return [
      {
        ...(browsePath === undefined ? {} : { browsePath }),
        ...(overviewPath === undefined ? {} : { overviewPath }),
        ...(entry.license === undefined ? {} : { license: licenseOf(entry.license) }),
        ...(entry.describedOnly === true ? { describedOnly: true } : {}),
        kind: entry.kind,
        path,
        name: entry.name,
        description: entry.description,
        skillCount: entry.skillCount,
        documentCount: entry.documentCount,
        size: entry.size,
        manifestPath: entry.manifestPath,
        language: entry.language,
      },
    ];
  });
}

/** A `browse` answer as the result it was made from; `undefined` when its path is not one. */
export function browseResultOf(
  body: Ready<RestBrowse>,
  mount: MountSummary,
): BrowseResult | undefined {
  const path = pathOf(body.path);
  if (path === undefined) {
    return undefined;
  }
  return {
    mount: summaryAt(mount, body.commit),
    path,
    overview: overviewOf(body.overview),
    entries: entriesOf(body.entries),
    nextCursor: orUndefined(body.nextCursor),
    diagnostics: diagnosticsOf(body.diagnostics),
  };
}

/** A `find` answer as the result it was made from. */
export function findResultOf(body: Ready<RestFind>, mount: MountSummary): FindResult {
  const items = body.items.flatMap((item): FindItem[] => {
    if (item.kind === "skill") {
      const directory = pathOf(item.directory);
      const path = item.path === undefined ? undefined : pathOf(item.path);
      if (directory === undefined) {
        return [];
      }
      return [
        {
          kind: "skill",
          ...(path === undefined ? {} : { path }),
          name: item.name,
          directory,
          description: item.description,
          files: item.files.flatMap((file) => {
            const filePath = pathOf(file.path);
            return filePath === undefined
              ? []
              : [
                  {
                    path: filePath,
                    title: orUndefined(file.title),
                    summary: orUndefined(file.summary),
                  },
                ];
          }),
          moreFiles: item.moreFiles,
          translations: translationsOf(item.translations),
          ...(item.license === undefined ? {} : { license: licenseOf(item.license) }),
          ...(item.describedOnly === true ? { describedOnly: true } : {}),
        },
      ];
    }
    const path = pathOf(item.path);
    const skillDirectory = item.skillDirectory === null ? undefined : pathOf(item.skillDirectory);
    return path === undefined
      ? []
      : [
          {
            kind: "document",
            path,
            title: orUndefined(item.title),
            summary: orUndefined(item.summary),
            skillDirectory,
          },
        ];
  });
  const path = body.path === undefined ? undefined : pathOf(body.path);
  return {
    mount: summaryAt(mount, body.commit),
    query: orUndefined(body.query),
    items,
    ...(path === undefined ? {} : { path }),
    nextCursor: body.nextCursor === undefined ? undefined : orUndefined(body.nextCursor),
    totals: orUndefined(body.totals),
    diagnostics: diagnosticsOf(body.diagnostics),
  };
}

/** A `skills` answer as the result it was made from; `undefined` when its paths are not ones. */
export function skillResultOf(
  body: Ready<RestSkill>,
  mount: MountSummary,
): SkillResult | undefined {
  const { skill } = body;
  const directory = pathOf(skill.directory);
  const path = skill.path === undefined ? undefined : pathOf(skill.path);
  if (directory === undefined) {
    return undefined;
  }
  const ruleChain: SkillRules[] = (skill.ruleChain ?? []).map((rule) => ({
    path: pathOf(rule.path),
    body: rule.body,
    truncated: rule.truncated,
  }));
  const included: IncludedFile[] = (skill.includedContents ?? []).flatMap((file) => {
    const filePath = pathOf(file.path);
    return filePath === undefined
      ? []
      : [{ path: filePath, content: orUndefined(file.content), truncated: file.truncated }];
  });
  const rules: SkillRules | undefined =
    skill.rules === null
      ? undefined
      : {
          path: skill.rules.path === null ? undefined : pathOf(skill.rules.path),
          body: skill.rules.body,
          truncated: skill.rules.truncated,
        };
  return {
    mount: summaryAt(mount, body.commit),
    ...(path === undefined ? {} : { path }),
    ruleChain,
    references: [...(skill.references ?? [])],
    complete: skill.complete ?? true,
    nextCursor: skill.nextCursor === undefined ? undefined : orUndefined(skill.nextCursor),
    name: skill.name,
    directory,
    description: skill.description,
    license: orUndefined(skill.license),
    compatibility: orUndefined(skill.compatibility),
    allowedTools: orUndefined(skill.allowedTools),
    metadata: { ...skill.metadata },
    body: skill.body,
    files: skill.files.flatMap((file) => {
      const filePath = pathOf(file);
      return filePath === undefined ? [] : [filePath];
    }),
    filesTruncated: skill.filesTruncated,
    ...(skill.oversized === undefined ? {} : { oversized: [...skill.oversized] }),
    included,
    warnings: [...skill.warnings],
    rules: rules ?? ruleChain[0],
    translations: translationsOf(skill.translations),
    ...(skill.serving === undefined
      ? {}
      : {
          serving: {
            license: licenseOf(skill.serving.license),
            full: skill.serving.full,
            sourceUrl: skill.serving.sourceUrl,
          },
        }),
  };
}

/** A `files` answer for a file as the result it was made from; `undefined` when its path is not one. */
export function fileResultOf(
  body: Extract<RestFile, { kind: "file" }>,
  mount: MountSummary,
): FileResult | undefined {
  const path = pathOf(body.path);
  if (path === undefined) {
    return undefined;
  }
  return {
    mount: summaryAt(mount, body.commit),
    path,
    content: body.content,
    offset: body.offset,
    nextOffset: orUndefined(body.nextOffset),
    totalLength: body.totalLength,
    references: [...(body.references ?? [])],
  };
}

/** A `files` answer for a folder as the result it was made from; `undefined` when its path is not one. */
export function directoryResultOf(
  body: Extract<RestFile, { kind: "directory" }>,
  mount: MountSummary,
): DirectoryResult | undefined {
  const path = pathOf(body.path);
  if (path === undefined) {
    return undefined;
  }
  return {
    mount: summaryAt(mount, body.commit),
    path,
    entries: body.entries.flatMap((entry) => {
      const entryPath = pathOf(entry.path);
      return entryPath === undefined
        ? []
        : [{ path: entryPath, kind: entry.kind, size: orUndefined(entry.size) }];
    }),
    truncated: body.truncated,
  };
}
