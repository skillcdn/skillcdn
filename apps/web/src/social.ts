import type { RestMount, RestSkill, SocialCard } from "@skillcdn/core";
import { messagesFor } from "./i18n/index.js";
import type { Language } from "./i18n/languages.js";
import {
  repositoryDescription,
  repositoryName,
  skillDescription,
  skillTitle,
} from "./i18n/repository-text.js";

// The social preview of the page of an address (ADR-0032): the words the server draws on the
// picture a link unfurls with, in the page's language. The server fetches the owner's picture
// and draws the card; this decides what it says.

/** What the card of an address says: the repository's card, or one skill's when it is asked for. */
export function socialCard(
  language: Language,
  origin: string,
  data: { readonly mount: RestMount; readonly skill?: RestSkill | undefined },
): SocialCard {
  const t = messagesFor(language);
  const { mount } = data;
  const manifest = mount.index.status === "ready" ? mount.index.manifest : null;
  const repository = `${mount.repository.owner}/${mount.repository.name}`;
  const name = (manifest === null ? null : repositoryName(manifest, language)) ?? repository;
  const where = `${origin.replace(/^https?:\/\//, "")}${mount.address}`;
  const skill = data.skill?.status === "ready" ? data.skill.skill : undefined;
  if (skill !== undefined) {
    return {
      kicker: t.mount.kinds.skill,
      title: skillTitle(skill, language),
      subtitle: `${name} · ${where}`,
      description: skillDescription(skill, language),
      badges: mount.verified ? [t.mount.verified] : [],
      verified: mount.verified,
      avatar: mount.repository.avatar,
      siteName: t.meta.siteName,
    };
  }
  const badges = [
    ...(mount.index.status === "ready" ? [t.explore.featuredSkills(mount.index.skillCount)] : []),
    ...(mount.verified ? [t.mount.verified] : []),
  ];
  return {
    kicker: t.mount.repository,
    title: name,
    subtitle: name === repository ? where : `${repository} · ${where}`,
    description:
      manifest === null
        ? (mount.repository.description ?? "")
        : repositoryDescription(manifest, language),
    badges,
    verified: mount.verified,
    avatar: mount.repository.avatar,
    siteName: t.meta.siteName,
  };
}
