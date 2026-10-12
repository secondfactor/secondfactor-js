# Changelog

All notable changes to `@secondfactor/js` are recorded here. The project
follows [Semantic Versioning](https://semver.org/).

## Unreleased

The library is now the client half of hosted verification. secondfactor.ai no
longer has a headless mode, so a browser or an app never sends or checks codes
itself: the user verifies on our hosted page.

### Added

- `redirectToVerification(url)` sends the browser to the hosted page, after
  checking that `url` is one; a `javascript:` URL or any other URL throws a
  `TypeError` and is not followed.
- `takeVerificationReturn()` reads `sf_session_id` and `sf_return_token` from
  the return page's URL and removes them from the address bar.
- `parseVerificationReturn(url)` reads them from any URL, for React Native.

### Removed

- Session mode (`SecondFactor.withSession`, `VerificationSession`), which
  drove a headless session from your own screens. The API no longer creates
  headless sessions, so it could not have worked.
- Proxy mode (`new SecondFactor(proxyBaseUrl)`, with `send`, `check`,
  `resend`, `start` and `verify`). Send and check codes from your server with
  the `secondfactor` package instead.
- `SecondFactorError` and `CLIENT_HEADER`: the library no longer makes
  requests.

## 0.1.2 — 2026-10-08

No changes to the library's code or behaviour.

- `RELEASING.md` and `SECURITY.md` no longer describe the first, hand-made
  release as a step still to come.

## 0.1.1 — 2026-10-08

No changes to the library's code or behaviour.

- The first release built and published by this repository's `publish`
  workflow through npm trusted publishing. It carries a provenance
  attestation that links the package to the exact commit and workflow run
  that produced it, which `npm audit signatures` verifies.

## 0.1.0 — 2026-10-08

The first release on npm. Before it, this library was a TypeScript file
downloaded from the secondfactor.ai dashboard as `@secondfactor/otp`.

### Added

- Session mode: `SecondFactor.withSession(clientToken)` sends, resends and
  checks codes for a headless verification session your server created, with
  no proxy and no API key in the browser. `status()` and `cancel()` too.
- `SecondFactorError.code` is one documented set of stable strings, and a
  session error carries the session's `state`.
- A per-press `Idempotency-Key` on every send, so a retried request sends at
  most one code.
- Built to ESM and CommonJS, with type declarations for both.

### Changed

- Renamed from `@secondfactor/otp` to `@secondfactor/js`.
- Proxy mode: `check(sid, code)` resolves with the verification and a
  `verified` boolean, and throws `expired`, `locked` or `already_verified` for
  a verification that can never succeed.

### Deprecated

- Proxy mode's `start` and `verify`: use `send` and `check`.

### Security

- Redirects are refused rather than followed, in both modes. `fetch` would
  resend the body, with the phone number or the code, and custom headers to
  whatever host a redirect names, and older runtimes the `Authorization` header
  with the client token too. A redirect now throws `SecondFactorError` with
  `code` null and the redirect's status (null in browsers, which hide it).
  React Native's `fetch` follows redirects whatever it is told, so there an
  answer whose final URL is not the one requested is refused instead.
- `baseUrl`, and proxy mode's base URL, must use `https://`. Plain `http://` is
  accepted only for `localhost`, `127.0.0.1` and `[::1]`, so nothing crosses a
  network unencrypted. URLs with a user name, password, query or fragment, and
  other schemes, are refused with a `TypeError`. A proxy may still be a path on
  the page's own origin, such as `/auth/otp`, but not a protocol-relative URL.
- Session mode's `check()` resolves `verified: true` only when the API answers
  that the session is `VERIFIED`, rather than for any successful status.
- A successful answer whose body is not a JSON object, or in session mode not
  the session's state, throws `SecondFactorError` (`code` null) instead of
  resolving. Before, a captive portal's HTML page answering 200 to `check()`
  resolved `verified: true`.
- The client token is held in a private field, so logging or serialising the
  session no longer shows it. A token that could not be a header value is
  refused with a `TypeError` that does not repeat it.
- Proxy mode requests time out after `timeoutMs` (10 seconds by default), as
  session requests already did. Where `AbortSignal.timeout` is missing, as on
  older React Native, both modes fall back to an `AbortController`.
