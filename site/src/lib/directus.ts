import { createDirectus, authentication, rest, readMe } from '@directus/sdk';

/*
  Directus client — leader session auth for the /leader gate (Story 3.2).

  Session-cookie mode is deliberate and security-load-bearing:
  `login({ mode: 'session' })` makes Directus set the httpOnly `directus_session_token`
  cookie and returns NO token in the body. `credentials: 'include'` on both composables
  is what sends/receives that cookie cross-subdomain (apex site ↔ admin subdomain).
  The credential therefore lives only in a browser-managed httpOnly cookie, never in JS
  or localStorage — the XSS defense required by AR-18 / NFR-D. Never switch to
  `mode: 'json'` (that returns access_token in the body → would have to be stored).
*/
// `||` not `??`: an empty PUBLIC_DIRECTUS_URL ('') must also fall back to the placeholder —
// otherwise createDirectus('') resolves the API against the page origin (the apex site).
const DIRECTUS_URL =
  import.meta.env.PUBLIC_DIRECTUS_URL || 'https://admin.kingdom1516.example';

const client = createDirectus(DIRECTUS_URL)
  .with(authentication('session', { credentials: 'include' }))
  .with(rest({ credentials: 'include' }));

export function login(email: string, password: string) {
  return client.login({ email, password }, { mode: 'session' });
}

export function logout() {
  return client.logout({ mode: 'session' });
}

export function getCurrentUser() {
  return client.request(readMe({ fields: ['id', 'email', 'first_name', 'last_name'] }));
}

export async function isAuthenticated(): Promise<boolean> {
  try {
    await getCurrentUser();
    return true;
  } catch {
    return false;
  }
}
