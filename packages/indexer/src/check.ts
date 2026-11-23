import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { IndexEntry } from "@skillcdn/core";
import {
  BROWSE_DEFAULT_LIMIT,
  browseCatalogFiles,
  type CatalogFile,
  CONTEXT_BLOCK_REACH,
  catalogGroups,
  classifyRepoFile,
  contextPageCuts,
  countContextPages,
  describeLicense,
  FIND_LIST_SKILLS_MAX,
  fitInstructions,
  folderOverview,
  INSTRUCTIONS_MAX_LENGTH,
  type IndexDiagnostic,
  type IndexLimits,
  isWithinRepoPath,
  MCP_RESULT_MAX_BYTES,
  type MountCatalog,
  outlineMarkdown,
  parentDirectory,
  parseRepoPath,
  READ_FILE_DEFAULT_LIMIT,
  type RepoPath,
  ROOT_PATH,
  SKILL_PAGE_BYTES,
  sectionsOf,
  skillUriPrefix,
  splitFrontMatter,
} from "@skillcdn/core";
import { INDEX_VERSION } from "./build-index.js";
import { readDirectory } from "./read-directory.js";

// The `check` role: a working tree read by the same indexer that reads a commit, and a report
// of what an agent would get. For repository authors, before they push; it needs no database
// and no git host, and it executes nothing from the directory.

export interface CheckOptions {
  readonly directory: string;
  readonly limits: IndexLimits;
  /** Where the report goes. */
  readonly write: (text: string) => void;
  /**
   * What ran the check, with its version, as `skillcdn 0.6.0`: the first line of the report
   * names it beside the version of the reading rules, so that a report says what wrote it.
   */
  readonly command?: string | undefined;
  /**
   * Asks whether the files of other packs the directory links to are there (ADR-0120), for a
   * caller that can reach a deployment: an answer per reference, in the order given, `found`
   * left out where it could not be learned, with why in `detail`. Left out, the report lists
   * the references and asks nothing. A file that is not there fails the check.
   */
  readonly verifyPackReferences?:
    | ((references: readonly PackReferenceAsked[]) => Promise<readonly PackReferenceVerdict[]>)
    | undefined;
}

export interface PackReferenceAsked {
  /** The pack, as an address without a ref: `gh/<owner>/<repo>`. */
  readonly pack: string;
  readonly path: string;
}

export interface PackReferenceVerdict {
  readonly found?: boolean | undefined;
  readonly detail?: string | undefined;
}

/** How many not-served paths the report names. */
const NAMED_NOT_SERVED = 12;
/** How many notes the report lists in full. */
const NAMED_NOTES = 12;
/** How many of the files a large skill includes the report names, the largest first. */
const NAMED_INCLUDES = 8;

function pathOf(text: string): RepoPath {
  const parsed = parseRepoPath(text);
  return parsed.ok ? parsed.value : ROOT_PATH;
}

function warningsLine(entry: IndexEntry, indent: string): string {
  const warnings = entry.frontMatter?.warnings ?? [];
  return warnings.length === 0
    ? `${indent}warnings: none\n`
    : `${indent}warnings:\n${warnings.map((warning) => `${indent}- ${warning}\n`).join("")}`;
}

function translationsLine(entry: IndexEntry, indent: string): string {
  const tags = Object.keys(entry.frontMatter?.translations ?? {});
  return tags.length === 0 ? "" : `${indent}translations: ${tags.join(", ")}\n`;
}

/**
 * Reads `directory` as the indexer would read a commit and reports what an agent would get.
 * Returns the exit code: 0 when there are no index diagnostics, 1 when there are, 2 when the
 * directory cannot be read at all.
 */
export async function checkDirectory(options: CheckOptions): Promise<number> {
  const { limits, write } = options;
  const root = resolve(options.directory);
  const info = await stat(root).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) {
    write(`${options.directory}: not a directory that can be read\n`);
    return 2;
  }
  const read = await readDirectory({ directory: root, limits });
  const { index, blobs, fileCount, skipped, commit } = read;

  const byPath = (a: IndexEntry, b: IndexEntry): number => (a.path < b.path ? -1 : 1);
  const manifest = index.entries.find(
    (entry) => entry.visible && entry.kind === "manifest" && entry.path === "SKILLCDN.md",
  );
  const skills = index.entries
    .filter((entry) => entry.visible && entry.kind === "skill")
    .sort(byPath);
  const documents = index.entries
    .filter(
      (entry) =>
        entry.visible &&
        entry.searchable &&
        (entry.kind === "markdown" || entry.kind === "json") &&
        entry.skillDir === undefined,
    )
    .sort(byPath);
  const notServed = index.entries.filter((entry) => !entry.visible).sort(byPath);
  const diagnostics: IndexDiagnostic[] = index.diagnostics.map((diagnostic) => ({
    path: pathOf(diagnostic.path),
    code: diagnostic.code,
    message: diagnostic.message,
  }));
  // How many lines of a file stand above the text of it that is read, its front matter: what a
  // line counted in the text is counted from in the file.
  const linesAbove = (source: string | undefined, text: string): number => {
    const at = source === undefined ? -1 : source.indexOf(text);
    return source === undefined || at <= 0 ? 0 : source.slice(0, at).split("\n").length - 1;
  };
  const ruleOf = async (entry: IndexEntry): Promise<{ text: string; above: number }> => {
    const source = await blobs.read(entry.blobSha);
    const split = source === undefined ? undefined : splitFrontMatter(source);
    const text = split?.kind === "found" ? split.body.trim() : "";
    return { text, above: linesAbove(source, text) };
  };
  const rulesOf = async (entry: IndexEntry): Promise<string> => (await ruleOf(entry)).text;
  const rules = manifest === undefined ? "" : await rulesOf(manifest);
  const catalogFiles: CatalogFile[] = index.entries
    .filter((entry) => entry.visible)
    .map((entry) => ({
      path: pathOf(entry.path),
      kind: entry.kind,
      name: entry.name,
      title: entry.title,
      description: entry.description,
      skillDir: entry.skillDir === undefined ? undefined : pathOf(entry.skillDir),
      searchable: entry.searchable,
      size: entry.size,
      linkedOnly: entry.frontMatter?.linkedOnly,
      overviewOnly: entry.frontMatter?.overviewOnly,
      language: entry.frontMatter?.language,
    }));
  const overview = folderOverview(catalogFiles, ROOT_PATH);

  write(
    `Read ${root} as SkillCDN would index it (${options.command === undefined ? "" : `${options.command}, `}reading rules version ${INDEX_VERSION}): ${fileCount} files` +
      `${skipped === 0 ? "" : `; ${skipped} .git entries, symbolic links or node_modules skipped`}` +
      `${index.truncated ? "; over the indexing limits, so the index is partial" : ""}.\n\n`,
  );

  if (manifest === undefined) {
    write(
      "Repository manifest: none. Skills, docs/ and optional folder READMEs are served. " +
        "A SKILLCDN.md can declare metadata, document directories, exclusions and shared rules.\n\n",
    );
  } else {
    write(
      `Repository manifest: ${manifest.path}\n` +
        `  name: ${manifest.name ?? "(the repository's name on the git host)"}\n` +
        `  description: ${manifest.description ?? ""}\n` +
        `  language: ${manifest.frontMatter?.language ?? "(not declared)"}\n` +
        `  image: ${manifest.frontMatter?.image ?? "(none)"}\n` +
        `  start: ${manifest.frontMatter?.start ?? "(none: a client is told of the README, where there is one)"}\n` +
        (manifest.frontMatter?.manifestError === undefined
          ? ""
          : `  unavailable: ${manifest.frontMatter.manifestError}\n`) +
        translationsLine(manifest, "  ") +
        `  documents: ${(manifest.frontMatter?.documents ?? []).map((directory) => (directory === "" ? "." : directory)).join(", ") || "(none)"}\n` +
        (manifest.frontMatter?.search?.meaning === false
          ? "  search: by words alone; the search by meaning is turned off for these documents\n"
          : "") +
        `  rules: ${rules.length === 0 ? "none" : `${rules.length} characters`}\n` +
        warningsLine(manifest, "  ") +
        "\n",
    );
  }

  // The license decides what a deployment may pass on (ADR-0026); the author sees it as read.
  // A directory is served in full by whoever chose it (ADR-0053, ADR-0071): what the license
  // changes is how a deployment serves the same pack as a repository.
  write(
    `License: ${describeLicense(index.license)}${index.license.kind === "none" ? " (a directory is served in full; a deployment serves a repository without a license with a provenance notice and never features it)" : index.license.kind === "restrictive" ? " (a directory is served in full; a deployment describes a repository under this license only, unless the repository is verified)" : ""}\n\n`,
  );

  const listed = skills.filter((skill) => skill.listed === true);
  // A hidden copy of a visible skill, or a copy that repeats one, is loadable by its exact path
  // and nothing else (ADR-0024): the author sees how many of the skills found are such copies.
  const discoverable = skills.filter((skill) => skill.searchable);
  const copies = skills.length - discoverable.length;
  write(
    `Skills: ${skills.length}${skills.length === 0 ? "" : ` (${listed.length} listed through the MCP skills extension${copies === 0 ? "" : `; ${copies} hidden or duplicate copies, loadable by exact path only`})`}\n`,
  );
  // What an author may want to know and nothing is wrong with: a note never fails the check.
  const notes: string[] = [];
  const bytesOf = (text: string): number => Buffer.byteLength(text, "utf8");
  let large = 0;
  // The skills the extension serves as a document that is more than a tool result holds
  // (ADR-0125): that document is handed over in one piece, where the tools give pages.
  let servedLarge = 0;
  // The pages that end inside a code block or a line, which nothing said on the next page
  // mends, and the skills that have one.
  let cutPages = 0;
  let cutSkills = 0;
  for (const skill of skills) {
    const directory = skill.skillDir ?? "";
    // What an agent reads before it starts (docs/specs/tools.md): the rules above the skill, its
    // body and the files it includes, cut into pages by the function the reader cuts them with.
    const source = await blobs.read(skill.blobSha);
    const split = source === undefined ? undefined : splitFrontMatter(source);
    const body = split?.kind === "found" ? split.body : (source ?? "");
    const above = index.entries
      .filter(
        (entry) =>
          entry.kind === "manifest" &&
          entry.frontMatter?.manifestError === undefined &&
          isWithinRepoPath(parentDirectory(pathOf(entry.path)), pathOf(directory)),
      )
      .sort((a, b) => a.path.length - b.path.length);
    const rulesAbove = (
      await Promise.all(
        above.map(async (entry) => ({ path: entry.path, ...(await ruleOf(entry)) })),
      )
    ).filter((rule) => rule.text.length > 0);
    const ruleTexts = rulesAbove.map((rule) => rule.text);
    const includedTexts = await Promise.all(
      (skill.frontMatter?.include ?? []).map(async (path) => {
        const entry = index.entries.find((candidate) => candidate.path === path);
        const text =
          entry?.kind === "markdown" || entry?.kind === "json"
            ? await blobs.read(entry.blobSha)
            : undefined;
        return { path, bytes: text === undefined ? 0 : bytesOf(text), text: text ?? "" };
      }),
    );
    const ruleBytes = ruleTexts.reduce((sum, text) => sum + bytesOf(text), 0);
    const includedBytes = includedTexts.reduce((sum, file) => sum + file.bytes, 0);
    // The texts in the order they are read, each with the file it is of and the lines of that
    // file above it.
    const read = [
      ...rulesAbove,
      { path: skill.path, text: body, above: linesAbove(source, body) },
      ...includedTexts.map((file) => ({ path: file.path, text: file.text, above: 0 })),
    ];
    const texts = read.map((part) => part.text);
    const pages = countContextPages(texts, SKILL_PAGE_BYTES);
    // Where a page ends elsewhere than between two blocks, the author sees it before a reader
    // does (ADR-0123): what moves a page end is everything above it, the rules of the pack too.
    const cuts = contextPageCuts(texts, SKILL_PAGE_BYTES);
    const unmended = cuts.filter((cut) => cut.inside === "code" || cut.inside === "line").length;
    cutPages += unmended;
    if (unmended > 0) cutSkills += 1;
    const ends = cuts
      .map((cut) => {
        const part = read[cut.text];
        const at = `${part?.path ?? "?"} line ${cut.line + (part?.above ?? 0)}`;
        const next = `page ${cut.page + 1} begins at ${at}`;
        return cut.inside === "line"
          ? `  page ${cut.page} ends inside a line longer than a page: ${at}\n`
          : cut.inside === "code"
            ? `  page ${cut.page} ends inside a code block: ${next}\n`
            : cut.inside === "table"
              ? `  page ${cut.page} ends inside a table: ${next}, under the table's head said again\n`
              : `  page ${cut.page} ends right after a heading or a line that opens what follows: ${next}\n`;
      })
      .join("");
    // The authoring target is the body and what it includes, before the rules above it
    // (docs/specs/skill-repo.md): past it, the author sees what the skill is made of.
    const carried = bytesOf(body) + includedBytes;
    if (carried > SKILL_PAGE_BYTES) large += 1;
    const largest = [...includedTexts].sort((a, b) => b.bytes - a.bytes).slice(0, NAMED_INCLUDES);
    const made =
      largest.length === 0
        ? ""
        : `; included: ${largest.map((file) => `${file.path} ${file.bytes}`).join(", ")}${includedTexts.length > largest.length ? `, and ${includedTexts.length - largest.length} smaller` : ""}`;
    const context =
      `  context: ${ruleBytes + carried} bytes, read in ${pages} ${pages === 1 ? "page" : "pages"} (rules ${ruleBytes}, instructions ${bytesOf(body)}, included ${includedBytes})\n` +
      (carried <= SKILL_PAGE_BYTES
        ? ""
        : `  over the ${SKILL_PAGE_BYTES} bytes of instructions and included files a skill aims at${made}\n`) +
      ends;
    const owned = index.entries.filter(
      (entry) => entry.visible && entry.skillDir === directory && entry.kind !== "skill",
    );
    const included = skill.frontMatter?.include ?? [];
    // A shared page travels with the skill wherever SkillCDN serves it, and nowhere else: a
    // copy taken from the git host has its path and must fetch it (ADR-0044).
    const shared = included.filter((path) => !isWithinRepoPath(pathOf(directory), pathOf(path)));
    const own = included.length - shared.length;
    const omitted = skill.frontMatter?.omitted ?? [];
    const license = skill.frontMatter?.licenseFact;
    // The bound is this server's own, the one it keeps every tool result within: what a client
    // gives its model of one read is the client's to say, and differs with its version and its
    // model, so none of theirs is compared with here (docs/specs/tools.md names those measured).
    const servedOver = skill.listed === true && (skill.servedSize ?? 0) > MCP_RESULT_MAX_BYTES;
    if (servedOver) servedLarge += 1;
    write(
      `- ${skill.name ?? "?"} (${directory === "" ? "." : directory})\n` +
        `  ${skill.description ?? ""}\n` +
        `  files: ${owned.length}${own === 0 ? "" : ` (${own} returned with the skill)`}\n` +
        (shared.length === 0
          ? ""
          : `  shared pages returned with the skill, outside its directory: ${shared.join(", ")}\n`) +
        (omitted.length === 0
          ? ""
          : `  over the read limit, named in the served document with their source: ${omitted.map((file) => `${file.path} (${file.size} bytes)`).join(", ")}\n`) +
        `  extension: ${skill.listed === true ? `listed, ${skill.servedSize ?? 0} bytes as served${servedOver ? `, in one piece: over the ${MCP_RESULT_MAX_BYTES} bytes a tool result is kept within` : ""}` : `not listed (${skill.frontMatter?.unlisted ?? "unknown"})`}\n` +
        context +
        (license === undefined
          ? ""
          : `  license: ${describeLicense(license)}${license.kind === "restrictive" ? " (described only, unless the repository is verified)" : ""}\n`) +
        translationsLine(skill, "  ") +
        warningsLine(skill, "  "),
    );
  }
  write("\n");

  // A document's sections are what a search names and what `browse_repo` outlines (ADR-0063):
  // the author sees how many a document has.
  write(`Documents outside the skills: ${documents.length}\n`);
  if (large > 0) {
    notes.push(
      `skills (skill_large): ${large} of ${skills.length} hold more than ${SKILL_PAGE_BYTES} bytes of instructions and included files, what a skill is read in at once; each says under its name what it is made of. An agent reads every page before it starts: what not every run needs is linked from the step that needs it, not included`,
    );
  }
  if (servedLarge > 0) {
    notes.push(
      `skills (served_large): ${servedLarge} of ${listed.length} listed through the skills extension ${servedLarge === 1 ? "is" : "are"} served as a document of more than ${MCP_RESULT_MAX_BYTES} bytes, what a tool result is kept within; each says so under its name. A host is handed that document in one piece, and its model gets it cut where that is more than the host gives it of one read, where load_skill gives the same text in pages. The document holds the rules above the skill, its instructions and the files it includes, as the context line of each weighs them: what not every run needs is linked from the step that needs it, not included`,
    );
  }
  if (cutPages > 0) {
    notes.push(
      `skills (page_cut): ${cutPages} ${cutPages === 1 ? "page" : "pages"} of ${cutSkills} ${cutSkills === 1 ? "skill ends" : "skills end"} inside a code block or a line; each says where under its name. A page ends before a code block of no more than ${CONTEXT_BLOCK_REACH} bytes, the line that announces it counted, and before a line of no more than ${SKILL_PAGE_BYTES}: a longer one is read in two pieces wherever a page ends in it, and where that is moves with everything above it`,
    );
  }
  for (const document of documents) {
    const text = document.kind === "markdown" ? await blobs.read(document.blobSha) : undefined;
    const outline = text === undefined ? undefined : outlineMarkdown(text);
    const sections = outline?.headings.length ?? 0;
    write(
      `- ${document.path}${document.title === undefined ? "" : ` - ${document.title}`}${sections === 0 ? "" : ` (${sections} ${sections === 1 ? "section" : "sections"})`}\n`,
    );
    // A section is what an agent reads at once: one longer than a read carries is read in
    // several calls, and a search that names it names more than was asked for.
    for (const section of text === undefined ? [] : sectionsOf(text, outline)) {
      if (section.length > READ_FILE_DEFAULT_LIMIT) {
        const heading = section.heading.at(-1);
        notes.push(
          `${document.path} (section_large): ${heading === undefined ? "the text before the first heading" : `the section ${JSON.stringify(heading)}`} is ${section.length} characters, more than one read carries (${READ_FILE_DEFAULT_LIMIT}); a long table stands in sections of a few dozen rows, a long text under more headings, a long code block in blocks of a few hundred lines under headings that name what each holds`,
        );
      }
    }
  }
  write("\n");
  if (notes.length > 0) {
    write(`Notes: ${notes.length}\n`);
    for (const note of notes.slice(0, NAMED_NOTES)) {
      write(`- ${note}\n`);
    }
    if (notes.length > NAMED_NOTES) {
      write(`- ... (${notes.length - NAMED_NOTES} more)\n`);
    }
    write("\n");
  }

  // Markdown and JSON over the per-file indexing limit are listed and read, never searched or
  // summarized; the author learns which, since nothing else says so.
  const unsearched = index.entries
    .filter(
      (entry) =>
        entry.visible &&
        entry.kind === "other" &&
        entry.size > limits.maxIndexedFileBytes &&
        ["markdown", "json"].includes(classifyRepoFile(pathOf(entry.path))),
    )
    .sort(byPath);
  if (unsearched.length > 0) {
    const named = unsearched
      .slice(0, NAMED_NOT_SERVED)
      .map((entry) => `${entry.path} (${entry.size} bytes)`);
    const rest =
      unsearched.length > NAMED_NOT_SERVED
        ? `, and ${unsearched.length - NAMED_NOT_SERVED} more`
        : "";
    write(
      `Too large to search or summarize (over ${limits.maxIndexedFileBytes} bytes), still listed and readable: ${unsearched.length} files (${named.join(", ")}${rest})\n\n`,
    );
  }

  if (notServed.length > 0) {
    const named = notServed.slice(0, NAMED_NOT_SERVED).map((entry) => entry.path);
    const rest =
      notServed.length > NAMED_NOT_SERVED
        ? `, and ${notServed.length - NAMED_NOT_SERVED} more`
        : "";
    write(`Not served: ${notServed.length} files (${named.join(", ")}${rest})\n\n`);
  }

  const linked = index.entries.filter(
    (entry) => entry.visible && entry.frontMatter?.linkedOnly === true,
  );
  const overviews = index.entries.filter(
    (entry) => entry.visible && entry.frontMatter?.overviewOnly === true,
  );
  write(
    `Optional overview files: ${overviews.length}${overviews.length === 0 ? "" : ` (${overviews.map((entry) => entry.path).join(", ")})`}\n\n`,
  );
  write(`Linked reference files: ${linked.length}\n\n`);

  // The files of other packs the pack links to by their skill URIs (ADR-0120). This check reads
  // one directory: whether each is there is asked of a deployment, when the caller can ask.
  const elsewhere = new Map<string, { pack: string; path: string; from: string }>();
  for (const entry of index.entries.filter((candidate) => candidate.visible).sort(byPath)) {
    for (const reference of entry.frontMatter?.packReferences ?? []) {
      const key = `${reference.pack} ${reference.path}`;
      if (!elsewhere.has(key)) {
        elsewhere.set(key, { pack: reference.pack, path: reference.path, from: entry.path });
      }
    }
  }
  const references = [...elsewhere.values()];
  const verdicts =
    options.verifyPackReferences === undefined || references.length === 0
      ? undefined
      : await options.verifyPackReferences(references.map(({ pack, path }) => ({ pack, path })));
  const packs = new Set(references.map((reference) => reference.pack)).size;
  write(
    `References to other packs: ${references.length}${references.length === 0 ? "" : ` (${packs} ${packs === 1 ? "pack" : "packs"}${verdicts === undefined ? "; not asked whether each is there: --references asks a deployment" : ""})`}\n`,
  );
  let absent = 0;
  references.forEach((reference, at) => {
    const verdict = verdicts?.[at];
    if (verdict?.found === false) absent += 1;
    // What is not there is always named; the rest as far as the report names such things.
    if (at >= NAMED_NOTES && verdict?.found !== false) return;
    const said =
      verdict === undefined
        ? ""
        : verdict.found === true
          ? ": there"
          : verdict.found === false
            ? ": NOT THERE"
            : `: not known (${verdict.detail ?? "no answer"})`;
    write(`- ${reference.pack} ${reference.path} (from ${reference.from})${said}\n`);
  });
  if (references.length > NAMED_NOTES) {
    write(`- ... (${references.length} in all)\n`);
  }
  write("\n");
  write(`Index diagnostics: ${diagnostics.length}\n`);
  for (const diagnostic of diagnostics) {
    write(`- ${diagnostic.path} (${diagnostic.code}): ${diagnostic.message}\n`);
  }
  write("\n");

  const catalog: MountCatalog = {
    overview,
    ...catalogGroups(browseCatalogFiles(catalogFiles, ROOT_PATH), BROWSE_DEFAULT_LIMIT),
    mount: {
      repository: basename(root),
      ref: undefined,
      commit,
      path: ROOT_PATH,
      verified: true,
      truncated: index.truncated,
      skillUri: skillUriPrefix({ host: "gh", owner: "local", repo: basename(root) }),
    },
    manifest:
      manifest?.description === undefined
        ? undefined
        : {
            name: manifest.name,
            description: manifest.description ?? "",
            path: pathOf(manifest.path),
            hasRules: rules.length > 0,
            language: manifest.frontMatter?.language,
            start:
              manifest.frontMatter?.start === undefined
                ? undefined
                : pathOf(manifest.frontMatter.start),
          },
    skills: skills.slice(0, FIND_LIST_SKILLS_MAX).map((skill) => ({
      name: skill.name ?? "",
      directory: pathOf(skill.skillDir ?? ""),
      description: skill.description ?? "",
    })),
    skillCount: discoverable.length,
    documentCount: documents.length,
    diagnostics,
  };
  const told = fitInstructions({ status: "ready", catalog });
  const instructions = told.text;
  // What the bound cost the folders (ADR-0112): an author sees it here before a client does.
  const cost =
    told.listed < told.rows
      ? `; ${told.rows - told.listed} of ${told.rows} folder lines are left out, for want of room`
      : told.shortened
        ? "; the folder lines say less, to fit"
        : "";
  write(
    `What a client is told on connect (${instructions.length} of ${INSTRUCTIONS_MAX_LENGTH} characters${cost}):\n` +
      `${instructions
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n")}\n\n`,
  );

  if (absent > 0) {
    write(`${absent} reference(s) to other packs name a file that is not there\n`);
  }
  write(
    diagnostics.length === 0
      ? "ok: no index diagnostics\n"
      : `${diagnostics.length} index issue(s) found\n`,
  );
  return diagnostics.length === 0 && absent === 0 ? 0 : 1;
}
