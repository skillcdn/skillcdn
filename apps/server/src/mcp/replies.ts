import {
  type BrowseResult,
  compactSummary,
  contextPage,
  type FileReference,
  type FileResult,
  type FindResult,
  type IndexDiagnostic,
  MCP_RESULT_MAX_BYTES,
  renderBrowseResult,
  renderFileResult,
  renderFindResult,
  renderSkillResult,
  type SkillResult,
  serializedResultBytes,
} from "@skillcdn/core";

export interface ToolReply {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export const reply = (text: string, data?: object): ToolReply => ({
  content: [{ type: "text", text }],
  ...(data === undefined ? {} : { structuredContent: data }),
});

export const problem = (text: string): ToolReply => ({
  // JSON can expand a single control character to six bytes.
  content: [{ type: "text", text: contextPage(text, 0, 3_072).content }],
  isError: true,
});

export const fitsReply = (result: ToolReply): boolean =>
  serializedResultBytes(result) <= MCP_RESULT_MAX_BYTES;

const diagnosticsOf = (diagnostics: readonly IndexDiagnostic[]) => ({
  diagnostics: diagnostics.slice(0, 3).map((diagnostic) => ({
    ...diagnostic,
    message: compactSummary(diagnostic.message, 180),
  })),
  diagnosticsTotal: diagnostics.length,
});

export function browseReply(result: BrowseResult): ToolReply {
  const data: BrowseResult = {
    ...result,
    ...diagnosticsOf(result.diagnostics ?? []),
    overview:
      result.overview === undefined
        ? undefined
        : {
            ...result.overview,
            title: compactSummary(result.overview.title ?? "", 100),
            description: compactSummary(result.overview.description ?? "", 240),
          },
    entries: result.entries.map((entry) => ({
      ...entry,
      name: entry.name === null ? null : compactSummary(entry.name, 100),
      description: entry.description === null ? null : compactSummary(entry.description, 240),
    })),
  };
  return reply(renderBrowseResult(data), data);
}

export function searchReply(result: FindResult): ToolReply {
  const data: FindResult = {
    ...result,
    ...diagnosticsOf(result.diagnostics),
    items: result.items.map((item) =>
      item.kind === "skill"
        ? {
            ...item,
            description: compactSummary(item.description, 360),
            files: item.files.slice(0, 2).map((file) => ({
              ...file,
              title: file.title === undefined ? undefined : compactSummary(file.title, 100),
              summary: undefined,
            })),
            moreFiles: item.moreFiles + Math.max(0, item.files.length - 2),
            translations: {},
          }
        : {
            ...item,
            title: item.title === undefined ? undefined : compactSummary(item.title, 100),
            summary: item.summary === undefined ? undefined : compactSummary(item.summary, 240),
          },
    ),
  };
  return reply(renderFindResult(data), {
    ...data,
    items: data.items.map((item) => {
      if (item.kind !== "skill") return item;
      const { translations: _translations, ...canonical } = item;
      return canonical;
    }),
  });
}

function uniqueReferences(references: readonly FileReference[]): FileReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    if (seen.has(reference.path)) return false;
    seen.add(reference.path);
    return true;
  });
}

function briefList<T>(items: readonly T[], maximum: number, bytes: number): T[] {
  const result: T[] = [];
  for (const item of items.slice(0, maximum)) {
    if (serializedResultBytes([...result, item]) > bytes) break;
    result.push(item);
  }
  return result;
}

/** Optional indexes are small; all required text is retained and paged by the reader. */
export function skillReply(result: SkillResult, continuation = false): ToolReply {
  const references = uniqueReferences(result.references ?? []);
  const shownReferences = continuation ? [] : briefList(references, 5, 2_048);
  const shownFiles = continuation ? [] : briefList(result.files, 5, 1_024);
  const blockingWarnings = result.warnings.filter((warning) =>
    /^(Applicable rules unavailable|Required file unavailable)/.test(warning),
  );
  const orderedWarnings = [
    ...blockingWarnings,
    ...result.warnings.filter((warning) => !blockingWarnings.includes(warning)),
  ];
  const shownWarnings = orderedWarnings.slice(0, 3).map((warning) => compactSummary(warning, 240));
  const description = continuation ? "" : compactSummary(result.description, 360);
  const metadata: Record<string, string> = Object.create(null);
  if (!continuation) {
    for (const [key, value] of Object.entries(result.metadata).slice(0, 8)) {
      const candidate = { ...metadata, [key]: value };
      if (serializedResultBytes(candidate) > 1_024) break;
      metadata[key] = value;
    }
  }
  const data: SkillResult = {
    ...result,
    description,
    license: continuation ? undefined : result.license,
    compatibility: continuation ? undefined : result.compatibility,
    allowedTools: continuation ? undefined : result.allowedTools,
    metadata,
    detailsTruncated:
      !continuation &&
      (Object.keys(metadata).length < Object.keys(result.metadata).length ||
        description !== result.description ||
        result.warnings.length > 3 ||
        shownWarnings.some((warning, index) => warning !== orderedWarnings[index])),
    files: shownFiles,
    filesTruncated:
      !continuation && (result.filesTruncated || result.files.length > shownFiles.length),
    references: shownReferences,
    referencesTruncated: !continuation && references.length > shownReferences.length,
    included: result.included.filter((file) => file.content !== ""),
    warnings: shownWarnings,
    translations: {},
  };
  const { translations: _translations, rules: _legacyRules, ...canonical } = data;
  return reply(renderSkillResult(data), canonical);
}

export function fileReply(result: FileResult): ToolReply {
  const references = uniqueReferences(result.references ?? []);
  const shownReferences = briefList(references, 5, 2_048);
  const data: FileResult = {
    ...result,
    references: shownReferences,
    referencesTruncated: references.length > shownReferences.length,
  };
  return reply(renderFileResult(data), data);
}
