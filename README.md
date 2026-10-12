# secondfactor.ai for browsers and React Native

The client half of [secondfactor.ai](https://secondfactor.ai) hosted
verification. Your users verify their phone number on our page, much like
Stripe Checkout; this library sends them there and reads the result when they
come back. Works in React, React Native, Expo, Vue, Svelte and plain
JavaScript. No dependencies. Type declarations are included.

This library runs on the **user's device**. It never calls the secondfactor.ai
API, and never holds your API key, a phone number or a code. Your server holds
the key and uses the server library,
[`secondfactor`](https://github.com/secondfactor/secondfactor-node) on npm
(or [`secondfactor`](https://github.com/secondfactor/secondfactor-python) on
PyPI).

> **Act on the result on your server.** What this library reads from a URL is
> not proof of anything: anyone can edit a URL. Your server confirms the
> session it stored, once, and that answer is the proof.

There are exactly two ways to add secondfactor.ai to an app: call the API from
your server and draw your own screens, or use our hosted page. This library is
for the hosted page. There is no way for a browser or an app to send or check
codes itself.

## Install

```bash
npm install @secondfactor/js
```

Every release is published from this repository's `publish` workflow with npm
provenance; see [SECURITY.md](SECURITY.md) to verify one.

## How it fits together

1. **Your server** creates a session for the number it wants verified, keeps
   its `sid`, and gives the page's `url` to your frontend:

   ```js
   // Node, with the `secondfactor` package.
   const session = await sf.createSession({
     to: user.phone,
     returnUrl: "https://app.example.com/verified",
   });
   req.session.sfSid = session.sid;
   res.json({ url: session.url });
   ```

2. **Your frontend** sends the user to our page:

   ```js
   import { redirectToVerification } from "@secondfactor/js";

   const { url } = await fetch("/verification/start", { method: "POST" }).then((r) => r.json());
   redirectToVerification(url);
   ```

   We send the code, the user types it on our page, and we send them back to
   your `returnUrl`.

3. **Your return page** takes the result off the URL and hands it to your
   server:

   ```js
   import { takeVerificationReturn } from "@secondfactor/js";

   const back = takeVerificationReturn(); // { sessionId, returnToken } or null
   if (back?.returnToken) {
     await fetch("/verification/finish", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ returnToken: back.returnToken }),
     });
   } else {
     // The user canceled, ran out of attempts, or the session expired.
   }
   ```

4. **Your server** confirms the session it stored, once, and acts on that:

   ```js
   const { phone } = await sf.verifySession(req.session.sfSid, req.body.returnToken);
   ```

If your return page is rendered by your server, you do not need step 3: the
server reads `sf_return_token` from the request itself.

## React Native

Open the page outside your app, and read the result from the URL your app is
opened with. `ReturnUrl` must be a universal link (iOS) or app link (Android)
on one of your return origins; custom URL schemes are not accepted.

```js
import { Linking } from "react-native";
import { parseVerificationReturn } from "@secondfactor/js";

Linking.addEventListener("url", async ({ url }) => {
  const back = parseVerificationReturn(url);
  if (back?.returnToken) await api.post("/verification/finish", { returnToken: back.returnToken });
});

const { url } = await api.post("/verification/start");
await Linking.openURL(url);
```

An in-app authentication browser (`ASWebAuthenticationSession` on iOS, a
Custom Tab on Android) works the same way: open `url` in it, and pass the URL
it returns to `parseVerificationReturn`.

## API

### `redirectToVerification(url)`

Sends the browser to the hosted page in the same tab, so Back returns to your
app. `url` must be the `url` your server got from `createSession`; anything
else, such as a `javascript:` URL, throws a `TypeError` and is not followed.
Browsers only.

### `takeVerificationReturn()`

Reads `sf_session_id` and `sf_return_token` from the current page's URL and
removes them from the address bar, keeping the single-use return token out of
the history and out of anything the user copies. Returns
`{ sessionId, returnToken }`, or `null` when the page carries neither.
`returnToken` is `null` when the user did not verify. Call it once, when your
return page loads. Browsers only.

### `parseVerificationReturn(url)`

The same, for any URL string, without touching the address bar. Use it in
React Native, or anywhere you already have the URL.

`sessionId` only tells you which stored session the user came back from.
Always confirm the `sid` your server stored, never this one.

## Development

```bash
npm install
npm test          # builds dist/ and tests the built package
npm run typecheck
```

## License

MIT
