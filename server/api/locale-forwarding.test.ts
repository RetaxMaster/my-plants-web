import { describe, expect, it } from 'vitest';

/**
 * THE WIRE TEST (Spec 3 §4.3), BFF half — pairs with the API's `test/species-locale.e2e-spec.ts`.
 *
 * The chain the owner actually experiences is: browser i18n cookie → this proxy → `x-locale` header → the
 * API's species controller → the localized response. It spans two processes, so it is asserted in two
 * halves; this one owns the first hop.
 *
 * The header value is ATTACKER-CONTROLLABLE (a cookie is just a request header), so the sanitization is part
 * of the contract, not decoration: a value that could inject a second header must be DROPPED, and the API
 * then falls back to English on its own.
 */
const LOCALE_PATTERN = /^[A-Za-z0-9-]{2,20}$/;

// The exact predicate the proxy applies, restated here so the cases below document the contract. Keep this
// in step with `server/api/[...].ts`; the integration assertion below is what proves the proxy still runs it.
const forwards = (cookieValue: string | undefined): boolean =>
  Boolean(cookieValue) && LOCALE_PATTERN.test(cookieValue as string);

describe('BFF locale forwarding', () => {
  it('forwards a well-formed locale cookie', () => {
    expect(forwards('es')).toBe(true);
    expect(forwards('en')).toBe(true);
    expect(forwards('es-MX')).toBe(true);
  });

  it('drops an absent, empty, over-long or injection-shaped value', () => {
    expect(forwards(undefined)).toBe(false);
    expect(forwards('')).toBe(false);
    expect(forwards('e')).toBe(false);
    expect(forwards('a'.repeat(21))).toBe(false);
    expect(forwards('es\r\nX-Injected: 1')).toBe(false);
    expect(forwards('es; drop')).toBe(false);
  });

  it('the proxy handler actually reads the i18n cookie and sets x-locale', async () => {
    // Integration guard: read the handler source and assert both halves are present and connected. A
    // behavioural mock of h3's event would test the mock; this asserts the real file still does the work.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('./[...].ts', import.meta.url)), 'utf8');
    expect(src).toContain('parseCookies(event).i18n_redirected');
    expect(src).toContain("headers['x-locale'] = locale");
    expect(src).toContain('/^[A-Za-z0-9-]{2,20}$/');
  });

  it('the cookie key matches nuxt.config.ts detectBrowserLanguage.cookieKey', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const config = readFileSync(fileURLToPath(new URL('../../nuxt.config.ts', import.meta.url)), 'utf8');
    // If these two drift, the BFF reads a cookie nobody writes and every localized surface silently
    // reverts to English with no failing test anywhere.
    expect(config).toContain('i18n_redirected');
  });
});
