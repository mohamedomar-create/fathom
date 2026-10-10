/** Who runs the service and how to reach them. Shown on the privacy and terms pages and in footers. */

const PLACEHOLDER_EMAIL = "support@example.com";

export function supportEmail(env: string | undefined = process.env.NEXT_PUBLIC_SUPPORT_EMAIL): { email: string; placeholder: boolean } {
  const e = env?.trim();
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? { email: e, placeholder: false } : { email: PLACEHOLDER_EMAIL, placeholder: true };
}

export const LEGAL = {
  entity: "ReportY",
  email: supportEmail().email,
  /** Last material change to the privacy policy or terms. */
  effective: "10 October 2026",
  /** Where the database and backups are hosted (Supabase project region). */
  dataRegion: "the European Union (Ireland)",
} as const;
