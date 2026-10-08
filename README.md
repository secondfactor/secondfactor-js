# secondfactor.ai for browsers and React Native

Verify phone numbers from your own UI with
[secondfactor.ai](https://secondfactor.ai). Works in React, React Native, Expo,
Vue, Svelte and plain JavaScript; anywhere with `fetch`. No dependencies. Type
declarations are included.

This library runs on the **user's device**, so it never holds your API key.
Your server holds the key and uses the server library,
[`secondfactor`](https://github.com/secondfactor/secondfactor-node) on npm
(or [`secondfactor`](https://github.com/secondfactor/secondfactor-python) on
PyPI).

> **Act on the result on your server. Never trust `verified` in the browser.**
> Anything running on the user's device can be changed by the user. The browser
> only drives the screens; your server confirms the session it stored, and that
> answer is the proof.

## Install

```bash
npm install @secondfactor/js
```

Every release is published from this repository's `publish` workflow with npm
provenance; see [SECURITY.md](SECURITY.md) to verify one.

## Headless verification

You draw the screens; we send the code and check it.

1. **Your server** creates a session for the number it wants verified and
   keeps the session's ID:

   ```js
   // Node, with the `secondfactor` package.
   const session = await sf.createSession({ to: user.phone, mode: "headless" });
   req.session.sfSid = session.sid;
   res.json({ clientToken: session.client_token });
   ```

2. **Your frontend** sends and checks codes with the session's client token:

   ```js
   import { SecondFactor, SecondFactorError } from "@secondfactor/js";

   const session = SecondFactor.withSession(clientToken);

   await session.send();                     // to the number your server chose
   const result = await session.check(code); // { verified, attempts_remaining, … }
   if (result.verified) {
     await fetch("/verification/done", { method: "POST" }); // tell your server
   }
   ```

3. **Your server** confirms the session it stored, once, and acts on that:

   ```js
   const { phone } = await sf.verifySession(req.session.sfSid); // throws unless verified
   ```

The client token reaches only this one session: one number, at most three
codes, for fifteen minutes. It is safe in the browser for that reason, and it
is useless once the session ends.

### In React

```tsx
import { useMemo, useState } from "react";
import { SecondFactor, SecondFactorError } from "@secondfactor/js";

export function VerifyPhone({ clientToken, onDone }: { clientToken: string; onDone: () => void }) {
  const session = useMemo(() => SecondFactor.withSession(clientToken), [clientToken]);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");

  async function check() {
    try {
      const result = await session.check(code);
      if (result.verified) onDone();
      else setMessage(`Wrong code. ${result.attempts_remaining} attempts left.`);
    } catch (error) {
      if (error instanceof SecondFactorError && error.code === "code_expired") setMessage("That code expired. Send a new one.");
      else setMessage("Verification failed. Start again.");
    }
  }

  return (
    <>
      <button onClick={() => session.send().catch(() => setMessage("Could not send a code."))}>Send code</button>
      <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="numeric" />
      <button onClick={check}>Verify</button>
      <p>{message}</p>
    </>
  );
}
```

### The session's state

Every call resolves with the session's state:

| Field | Meaning |
|---|---|
| `status` | `OPEN`, `VERIFIED`, `CANCELED`, `FAILED` or `EXPIRED`. |
| `channel` | The channel the newest code went out on, such as `sms` or `whatsapp`. It can change while a code is out, when delivery moves to the next channel. |
| `resend_available_in` | Seconds until another code may be sent, for a "Resend in 27s" button. |
| `sends_remaining` | Codes the session may still send. |
| `attempts_remaining` | Wrong guesses left on the newest code. |
| `code_expires_at`, `expires_at` | When the newest code and the session stop working. |

`send()` adds `sent`, which is false when a press fell inside the resend
cooldown and sent nothing. `check()` adds `verified`. `status()` returns the
state alone and is cheap enough to poll every few seconds while a code is out.
`cancel()` ends the session, for a "Not your number?" link.

## Errors

A wrong code is not an error. Everything else throws a `SecondFactorError`
with:

- `code`, a stable string to branch on;
- `status`, the HTTP status, or null when no answer arrived;
- `state`, the session's state when the session refused, so the screen can be
  redrawn from it;
- `message`, written for developers. Show your users your own words.

| `code` | What happened | What to offer |
|---|---|---|
| `code_expired` | No code is live any more. | A resend. |
| `max_attempts` | Too many wrong codes. | Start again. |
| `max_sends` | The session has sent all its codes. | Start again. |
| `send_refused` | We could not send to this number. Your server can read why. | Another way in. |
| `expired` | The session timed out. | Start again. |
| `canceled` | The session was canceled. | Start again. |
| `already_verified` | The session is already verified. | Carry on. |
| `unauthorized` | The client token is unknown, or the session ended over an hour ago. | Start again. |
| `rate_limited` | Too many requests. | Wait a little. |
| `network_error` | No answer arrived. | Try again. |

New codes may be added in minor versions, so keep a default branch.

## Proxy mode

Apps already built on three endpoints of their own that forward to
secondfactor.ai (`POST {base}/start`, `/verify` and `/resend`, passing the
answer through with its status code) can keep them:

```js
const sf = new SecondFactor("https://api.yourapp.com/auth/otp");

let sid = await sf.send("+9779841000001");
const result = await sf.check(sid, code); // { verified, … }
sid = await sf.resend(sid);               // a resend is a new SID: check against it
// sf.resendAvailableIn: seconds until resend is allowed
```

As in session mode, `verified` only drives the screens. Your proxy sees
secondfactor.ai's answer itself, so record the verification there and act on
that record, never on what the browser reports.

`start` and `verify` still work and are deprecated: use `send` and `check`.
New apps should use session mode, which needs no proxy.

## Options

`SecondFactor.withSession(clientToken, options)` takes `baseUrl` (the API
origin, `https://api.secondfactor.ai` by default), `timeoutMs` (10 seconds by
default) and `fetch` (to use instead of the global one). Proxy mode's third
argument takes `timeoutMs` and `fetch` too.

## Security

- The client token is the only credential this library holds. It is sent in
  the `Authorization` header, never in a URL, and is not shown when the session
  object is logged or serialised. Never give this library your API key.
- `baseUrl` must be an `https://` URL; plain `http://` is accepted only for
  `localhost`, `127.0.0.1` and `[::1]`. A proxy may also be a path on the
  page's own origin, such as `/auth/otp`.
- Redirects are never followed: a redirect becomes a `SecondFactorError` with
  `code` null. React Native's `fetch` follows redirects regardless, so there
  the answer from the redirected URL is refused instead.
- `verified` is true only when the API says the session is `VERIFIED`, and a
  successful answer that is not the expected JSON becomes a
  `SecondFactorError`, never a result.

Report a vulnerability privately as described in [SECURITY.md](SECURITY.md).

## Development

```bash
npm install
npm test          # builds dist/ and tests the built package
npm run typecheck
```

The tests run the published build against a fake `fetch` and need no network
or key.

## License

MIT
