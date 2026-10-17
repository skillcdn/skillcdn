import type { Address, RestBrowse, RestFile, RestFind, RestMount, RestSkill } from "@skillcdn/core";

// A pack as the command reads one, from a directory or from a deployment: the five reads of
// the REST API, answered in its shapes, so that what is printed comes from the same data
// either way and `--json` is the API's answer (ADR-0055, ADR-0056). What the pack does not
// have, or cannot give, is a PackError with the code and the status the API would answer.

export class PackError extends Error {
  /** The HTTP status the API answers with; `0` when the pack could not be reached at all. */
  readonly status: number;
  /** The stable code of the API: `skill.not_found`, `file.too_large`, `mount.repo_not_found`, ... */
  readonly code: string;
  /** With `skill.ambiguous`: the directories to choose from. */
  readonly directories: readonly string[];
  /** With a file the pack will not carry: where it is at its source. */
  readonly sourceUrl: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: {
      readonly directories?: readonly string[] | undefined;
      readonly sourceUrl?: string | undefined;
    } = {},
  ) {
    super(message);
    this.name = "PackError";
    this.status = status;
    this.code = code;
    this.directories = extra.directories ?? [];
    this.sourceUrl = extra.sourceUrl;
  }
}

export interface BrowseQuery {
  readonly path?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface FindQuery {
  readonly query?: string | undefined;
  readonly path?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface FileQuery {
  readonly path: string;
  readonly offset?: number | undefined;
  readonly limit?: number | undefined;
}

export interface Pack {
  readonly address: Address;
  /** Where the pack is read: a directory on this machine, or the origin of a deployment. */
  readonly source:
    | { readonly kind: "directory"; readonly root: string }
    | { readonly kind: "deployment"; readonly url: string };
  mount(): Promise<RestMount>;
  browse(query: BrowseQuery): Promise<RestBrowse>;
  find(query: FindQuery): Promise<RestFind>;
  skill(path: string, cursor?: string): Promise<RestSkill>;
  file(query: FileQuery): Promise<RestFile>;
}
