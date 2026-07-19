import { createDirectus, rest, createItem } from '@directus/sdk';

/*
  Unauthenticated, create-only Directus client for the public transfer form (Story 5.2).

  A THIRD, deliberately-separate client seam:
    - directus.ts        → leader session (authentication('session'), credentials:'include')
    - directus-build.ts  → build-time read (static token, server-only, never bundled)
    - directus-public.ts → public create-only (NO credentials, NO token)   ← this

  The public POST uses the create-only unauthenticated Directus role (AD-12): it may
  create a candidates row and read nothing. So this client carries NO authentication
  and NO credentials — an anonymous cross-origin POST to PUBLIC_DIRECTUS_URL. It is
  bundled into browser JS, which is fine: it holds no secret (the URL is PUBLIC_ by
  design — the same base the leader auth and the build read target). Do NOT reuse the
  session client from directus.ts here: its credentials:'include' would attach the
  leader cookie and defeat the "unauthenticated create-only" contract.
*/
const PUBLIC_DIRECTUS_URL = (import.meta.env.PUBLIC_DIRECTUS_URL || '').trim();

export interface CandidatePayload {
  character_name: string;
  player_id: string;
  kingdom_number: number;
  timezone: string;
  who_invited: string;
  why_leaving: string;
  team_player_kvk: boolean;
  others_transferring: string;
  day4_fcfs: boolean;
  needs_special_invite: boolean;
  power: number; // raw units — /join collects millions and sends ×1,000,000 (Owner decision 2026-07-18)
  what_you_seek?: string;
  players_to_avoid?: string;
  desired_alliance?: number;
  period: number;
  // `status` is intentionally omitted — the schema defaults it to 'Applied' (AC1).
  // suggested_alliance / group / planned_path are Curator-only (AD-8 / AD-9) — never sent.
}

/*
  POST a new candidate. Resolves on any 2xx. The create-only role has NO read, so
  Directus returns a minimal / empty body (it cannot echo fields the role may not
  read) — the caller must NOT depend on the response, only on success/failure.
  Rejects on any HTTP / network error; the caller classifies a 4xx (validation /
  NOT-NULL / FK) vs a network / 5xx failure for the inline message and never
  surfaces the raw Directus error envelope.
*/
export async function createCandidate(payload: CandidatePayload): Promise<void> {
  if (!PUBLIC_DIRECTUS_URL) {
    throw new Error('PUBLIC_DIRECTUS_URL is not configured — cannot submit the application.');
  }
  const client = createDirectus(PUBLIC_DIRECTUS_URL).with(rest());
  await client.request(createItem('candidates', payload as unknown as Record<string, unknown>));
}
