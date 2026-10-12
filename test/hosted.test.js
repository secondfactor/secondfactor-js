// The client half of hosted verification: that only a verification page is
// ever navigated to, and that the return URL's parameters are read exactly and
// then taken out of the address bar. Runs against the published build.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseVerificationReturn, redirectToVerification, takeVerificationReturn } from "../dist/index.js";

const PAGE = "https://verify.secondfactor.ai/#vst_Qm9yZWFsaXMgb2YgdGhlIG5vcnRo-_x";

function fakeLocation() {
  const assigned = [];
  return { assigned, assign: (url) => assigned.push(url) };
}

describe("redirectToVerification", () => {
  for (const url of [
    PAGE,
    "https://uat-verify.secondfactor.ai/#vst_abc",
    "http://verify.localhost:5175/#vst_abc",
    "http://localhost:5175/#vst_abc",
    "http://127.0.0.1:5175/#vst_abc",
  ]) {
    it(`opens ${url}`, () => {
      const location = fakeLocation();

      redirectToVerification(url, location);

      assert.deepEqual(location.assigned, [url]);
    });
  }

  for (const url of [
    "javascript:alert(document.cookie)//#vst_abc",
    "data:text/html,<script>alert(1)</script>#vst_abc",
    "http://verify.secondfactor.ai/#vst_abc", // plain http off a loopback host
    "https://verify.secondfactor.ai/", // no client token
    "https://verify.secondfactor.ai/#vsr_abc", // a return token, not a client token
    "https://user:pass@verify.secondfactor.ai/#vst_abc",
    "//verify.secondfactor.ai/#vst_abc",
    "https://verify.secondfactor.ai/#vst_abc def",
    "",
    undefined,
  ]) {
    it(`refuses ${JSON.stringify(url)} without navigating`, () => {
      const location = fakeLocation();

      assert.throws(() => redirectToVerification(url, location), TypeError);
      assert.deepEqual(location.assigned, []);
    });
  }
});

describe("parseVerificationReturn", () => {
  it("reads the session ID and the return token", () => {
    const back = parseVerificationReturn(
      "https://app.example.com/verified?step=2&sf_session_id=VSN26H7K3MQ2XWZ8RT4&sf_return_token=vsr_abc-_9#top",
    );

    assert.deepEqual(back, { sessionId: "VSN26H7K3MQ2XWZ8RT4", returnToken: "vsr_abc-_9" });
  });

  it("has no return token when the user did not verify", () => {
    assert.deepEqual(parseVerificationReturn("https://app.example.com/back?sf_session_id=VSN1"), {
      sessionId: "VSN1",
      returnToken: null,
    });
  });

  it("is null for a URL the hosted page did not send the user to", () => {
    for (const url of [
      "https://app.example.com/verified",
      "https://app.example.com/verified?sf_return_token=vsr_abc",
      "https://app.example.com/verified#?sf_session_id=VSN1",
      "",
    ]) {
      assert.equal(parseVerificationReturn(url), null, url);
    }
  });

  it("decodes the parameters and keeps the first of a repeated one", () => {
    const back = parseVerificationReturn("myapp://x?sf_session_id=VSN%31&sf_session_id=VSN2&sf_return_token=vsr_a%2Bb&bad=%E0");

    assert.deepEqual(back, { sessionId: "VSN1", returnToken: "vsr_a+b" });
  });
});

describe("takeVerificationReturn", () => {
  function fakeWindow(href) {
    const replaced = [];
    return {
      replaced,
      location: { href },
      history: { state: { app: 1 }, replaceState: (state, _title, url) => replaced.push([state, url]) },
    };
  }

  it("returns the parameters and removes them from the address bar", () => {
    const window = fakeWindow("https://app.example.com/verified?step=2&sf_session_id=VSN1&sf_return_token=vsr_abc#top");

    const back = takeVerificationReturn(window);

    assert.deepEqual(back, { sessionId: "VSN1", returnToken: "vsr_abc" });
    assert.deepEqual(window.replaced, [[{ app: 1 }, "/verified?step=2#top"]]);
  });

  it("leaves a page without them alone", () => {
    const window = fakeWindow("https://app.example.com/verified?step=2");

    assert.equal(takeVerificationReturn(window), null);
    assert.deepEqual(window.replaced, []);
  });
});
