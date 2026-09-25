/** Process roles served by the single server image. See docs/architecture.md. */
export const ROLES = ["api", "worker", "migrate", "check", "purge"] as const;

export type Role = (typeof ROLES)[number];

export function parseRole(value: string | undefined): Role | undefined {
  return ROLES.find((role) => role === value);
}
