/**
 * secondfactor.ai for browsers and React Native: the client half of hosted
 * verification. No dependencies.
 *
 * secondfactor.ai verifies a phone number on its own hosted page, much like
 * Stripe Checkout. Your server creates a verification session with its API key
 * (the `secondfactor` package on npm or PyPI) and gets back the page's `url`.
 * This library does the two things left for the browser or the app:
 *
 *   redirectToVerification(url);               // send the user to our page
 *
 *   // Later, on your return URL:
 *   const back = takeVerificationReturn();     // { sessionId, returnToken }
 *   // Send back.returnToken to your server, which passes it to verifySession.
 *
 * It never calls the secondfactor.ai API and never holds a key, a phone number
 * or a code. Nothing it reports is proof that a number was verified: only your
 * server's `verifySession` call is.
 */

/** This package's version. The `publish` workflow checks it against
 * `package.json`. */
export const VERSION = "0.2.0";

/** The two parameters the hosted page adds to your return URL. */
export interface VerificationReturn {
  /** `sf_session_id`. Tells you which stored session to look up; anyone can
   * edit a URL, so always confirm the session ID your server stored instead. */
  sessionId: string;
  /** `sf_return_token`. Present only when the user verified; null when they
   * canceled, ran out of attempts or the session expired. Send it to your
   * server, which passes it to `verifySession`. It works once. */
  returnToken: string | null;
}

const SESSION_PARAM = "sf_session_id";
const TOKEN_PARAM = "sf_return_token";

// Plain http:// is accepted only for these hosts, so a local verify page can be
// used in development. `*.localhost` always resolves to the machine itself.
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Send the browser to the hosted verification page.
 *
 * `url` is the `url` your server received when it created the session. It is
 * checked first, so that a URL which is not a verification page, such as a
 * `javascript:` URL that reached your frontend some other way, is refused with
 * a `TypeError` rather than followed. The page is opened in the same tab, and
 * Back returns to where the user was.
 *
 * Browsers only. In React Native, open `url` with `Linking.openURL` or an
 * in-app browser instead, and read the return with `parseVerificationReturn`.
 */
export function redirectToVerification(url: string, location: Pick<Location, "assign"> = globalThis.location): void {
  if (!isVerificationPageUrl(url)) {
    throw new TypeError("url is not a secondfactor.ai verification page. Pass the url your server got from createSession.");
  }
  location.assign(url);
}

/**
 * The hosted page's parameters on a URL the user returned to, or null when it
 * carries none.
 *
 * Works on any URL string, so React Native can pass the URL its app was opened
 * with. Nothing here is checked against secondfactor.ai: your server does that
 * when it confirms the session.
 */
export function parseVerificationReturn(url: string): VerificationReturn | null {
  const query = String(url).split("#", 1)[0];
  const start = query.indexOf("?");
  if (start === -1) return null;
  const params: Record<string, string> = {};
  for (const pair of query.slice(start + 1).split("&")) {
    const separator = pair.indexOf("=");
    const key = decode(separator === -1 ? pair : pair.slice(0, separator));
    // The first value wins. The hosted page replaces any parameter of the same
    // name rather than adding a second, so a repeat did not come from it.
    if (key !== null && !(key in params)) params[key] = decode(separator === -1 ? "" : pair.slice(separator + 1)) ?? "";
  }
  if (!params[SESSION_PARAM]) return null;
  return { sessionId: params[SESSION_PARAM], returnToken: params[TOKEN_PARAM] || null };
}

/**
 * The hosted page's parameters on the current page's URL, removed from the
 * address bar as they are read. Null when the page carries none.
 *
 * Removing them keeps the single-use return token out of the browser history,
 * bookmarks and anything the user copies from the address bar. The rest of
 * the URL, including other query parameters and the fragment, is kept.
 *
 * Browsers only. Call it once, when your return page loads.
 */
export function takeVerificationReturn(
  window: { location: Pick<Location, "href">; history: Pick<History, "replaceState" | "state"> } = globalThis,
): VerificationReturn | null {
  const found = parseVerificationReturn(window.location.href);
  if (found) {
    const url = new URL(window.location.href);
    url.searchParams.delete(SESSION_PARAM);
    url.searchParams.delete(TOKEN_PARAM);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
  return found;
}

// ─────────────────────────────────── internals ───────────────────────────────────

/**
 * Whether `url` has the shape of a hosted verification page: `https://` (or
 * plain `http://` on a loopback host), no user name or password, and the
 * session's client token in the fragment, where the page reads it.
 *
 * It is parsed by hand because React Native's `URL` does not implement
 * `protocol` or `hostname`.
 */
function isVerificationPageUrl(url: string): boolean {
  if (typeof url !== "string" || !/^[\x21-\x7e]+$/.test(url)) return false;
  const parts = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\\@]+)[^#\\]*#vst_[A-Za-z0-9_-]+$/i.exec(url);
  const authority = parts && /^(\[[0-9a-f:.]+\]|[a-z0-9._-]+)(?::[0-9]{1,5})?$/i.exec(parts[2]);
  if (!parts || !authority) return false;
  const scheme = parts[1].toLowerCase();
  const host = authority[1].toLowerCase();
  return scheme === "https" || (scheme === "http" && (LOOPBACK_HOSTS.includes(host) || host.endsWith(".localhost")));
}

/** A query-string component decoded, or null when it is malformed. */
function decode(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return null;
  }
}
