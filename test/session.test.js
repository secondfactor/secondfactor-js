// Session mode, tested through the built package exactly as it is published:
// each request's URL, headers and body, and how every answer the hosted API
// can give is turned into a result or an error a caller can branch on.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { CLIENT_HEADER, SecondFactor, SecondFactorError, VERSION, VerificationSession } from "../dist/index.js";

const STATE = {
  status: "OPEN",
  failure_reason: null,
  channel: "sms",
  sends_remaining: 2,
  resend_available_in: 30,
  attempts_remaining: 5,
  code_expires_at: "2026-10-08T10:10:00Z",
  expires_at: "2026-10-08T10:15:00Z",
};

/** A fetch that records each request and answers from a queue. An answer is
 * `[status, body]`, or an Error to throw as the network would. */
function fakeFetch(...answers) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    const [status, body] = answer;
    return new Response(body === undefined ? "" : JSON.stringify(body), { status });
  };
  return { fetch, calls };
}

const session = (fetch, options = {}) => SecondFactor.withSession("vst_token", { fetch, ...options });

describe("requests", () => {
  it("authenticates with the session token alone, never with cookies", async () => {
    const { fetch, calls } = fakeFetch([200, STATE]);
    await session(fetch).status();

    assert.equal(calls[0].url, "https://api.secondfactor.ai/api/hosted/session/status");
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.credentials, "omit");
    assert.equal(calls[0].headers.Authorization, "Session vst_token");
    assert.equal(calls[0].headers["X-SF-Client"], `secondfactor-js/${VERSION}`);
    assert.equal(CLIENT_HEADER, `secondfactor-js/${VERSION}`);
    assert.equal(calls[0].body, undefined);
  });

  it("uses the given API origin, with or without a trailing slash", async () => {
    const { fetch, calls } = fakeFetch([200, STATE]);
    await session(fetch, { baseUrl: "http://localhost:8001/" }).status();
    assert.equal(calls[0].url, "http://localhost:8001/api/hosted/session/status");
  });

  it("gives every send its own idempotency key, so two presses are two sends", async () => {
    const { fetch, calls } = fakeFetch([200, { ...STATE, sent: true }], [200, { ...STATE, sent: true }]);
    const s = session(fetch);
    await s.send();
    await s.resend();

    const [first, second] = calls.map((call) => call.headers["Idempotency-Key"]);
    assert.ok(first && second);
    assert.notEqual(first, second);
    assert.equal(calls[1].url, "https://api.secondfactor.ai/api/hosted/session/send");
  });

  it("reuses a caller's key, so a retried press sends at most one code", async () => {
    const { fetch, calls } = fakeFetch([200, { ...STATE, sent: true }]);
    await session(fetch).send({ idempotencyKey: "press-1" });
    assert.equal(calls[0].headers["Idempotency-Key"], "press-1");
  });

  it("falls back to its own key where crypto.randomUUID is missing, as on React Native", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
    try {
      const { fetch, calls } = fakeFetch([200, { ...STATE, sent: true }], [200, { ...STATE, sent: true }]);
      const s = session(fetch);
      await s.send();
      await s.send();
      const keys = calls.map((call) => call.headers["Idempotency-Key"]);
      assert.match(keys[0], /^[a-z0-9-]{10,}$/);
      assert.notEqual(keys[0], keys[1]);
    } finally {
      Object.defineProperty(globalThis, "crypto", original);
    }
  });

  it("sends the code trimmed, as JSON", async () => {
    const { fetch, calls } = fakeFetch([200, { ...STATE, status: "VERIFIED" }]);
    await session(fetch).check(" 123456 ");
    assert.deepEqual(calls[0].body, { code: "123456" });
    assert.equal(calls[0].headers["Content-Type"], "application/json");
  });

  it("refuses to start without a token", () => {
    assert.throws(() => SecondFactor.withSession(""), TypeError);
  });
});

describe("answers", () => {
  it("resolves a send with the state and whether this press sent a code", async () => {
    const { fetch } = fakeFetch([200, { ...STATE, sent: false, resend_available_in: 12 }]);
    const result = await session(fetch).send();
    assert.equal(result.sent, false);
    assert.equal(result.resend_available_in, 12);
  });

  it("resolves a right code with verified true", async () => {
    const { fetch } = fakeFetch([200, { ...STATE, status: "VERIFIED" }]);
    const result = await session(fetch).check("123456");
    assert.equal(result.verified, true);
    assert.equal(result.status, "VERIFIED");
  });

  it("resolves a wrong code with verified false and the attempts left, without throwing", async () => {
    const { fetch } = fakeFetch([422, { ...STATE, attempts_remaining: 3 }]);
    const result = await session(fetch).check("000000");
    assert.equal(result.verified, false);
    assert.equal(result.attempts_remaining, 3);
  });

  it("resolves a cancel with the ended state", async () => {
    const { fetch, calls } = fakeFetch([200, { ...STATE, status: "CANCELED" }]);
    const result = await session(fetch).cancel();
    assert.equal(result.status, "CANCELED");
    assert.equal(calls[0].url, "https://api.secondfactor.ai/api/hosted/session/cancel");
  });
});

describe("errors", () => {
  async function refusal(promise) {
    try {
      await promise;
    } catch (error) {
      assert.ok(error instanceof SecondFactorError);
      return error;
    }
    assert.fail("expected a SecondFactorError");
  }

  // Each state a session can refuse from becomes one code, and the error
  // carries the state so the screen can be redrawn from it.
  const cases = [
    ["a check with no live code", "check", { ...STATE, attempts_remaining: 0 }, "code_expired"],
    ["a verified session", "send", { ...STATE, status: "VERIFIED" }, "already_verified"],
    ["a canceled session", "check", { ...STATE, status: "CANCELED" }, "canceled"],
    ["an expired session", "send", { ...STATE, status: "EXPIRED" }, "expired"],
    ["a session out of sends", "send", { ...STATE, status: "FAILED", failure_reason: "max_sends" }, "max_sends"],
    ["a session out of attempts", "check", { ...STATE, status: "FAILED", failure_reason: "max_attempts" }, "max_attempts"],
    ["a refused send", "send", { ...STATE, status: "FAILED", failure_reason: "send_refused" }, "send_refused"],
  ];
  for (const [name, action, body, code] of cases) {
    it(`throws ${code} for ${name}`, async () => {
      const { fetch } = fakeFetch([409, body]);
      const s = session(fetch);
      const error = await refusal(action === "check" ? s.check("123456") : s.send());
      assert.equal(error.code, code);
      assert.equal(error.status, 409);
      assert.deepEqual(error.state, body);
    });
  }

  it("throws the API's own code and message from its error envelope", async () => {
    const { fetch } = fakeFetch([429, { status: 429, code: "rate_limited", message: "Too many requests." }]);
    const error = await refusal(session(fetch).status());
    assert.equal(error.code, "rate_limited");
    assert.equal(error.status, 429);
    assert.equal(error.message, "Too many requests.");
    assert.equal(error.state, null);
  });

  it("throws unauthorized once the token is no longer valid", async () => {
    const { fetch } = fakeFetch([401, { status: 401, code: "unauthorized", message: "This verification link is no longer valid." }]);
    const error = await refusal(session(fetch).check("123456"));
    assert.equal(error.code, "unauthorized");
  });

  it("throws a code-less error for an answer with no body it recognises", async () => {
    const { fetch } = fakeFetch([502, undefined]);
    const error = await refusal(session(fetch).status());
    assert.equal(error.code, null);
    assert.equal(error.status, 502);
    assert.match(error.message, /HTTP 502/);
  });

  it("throws network_error when no answer arrives", async () => {
    const { fetch } = fakeFetch(new TypeError("Failed to fetch"));
    const error = await refusal(session(fetch).send());
    assert.equal(error.code, "network_error");
    assert.equal(error.status, null);
  });
});

describe("the CommonJS build", () => {
  it("exports the same API for require()", () => {
    const cjs = createRequire(import.meta.url)("../dist/index.cjs");
    assert.equal(typeof cjs.SecondFactor.withSession, "function");
    assert.ok(cjs.SecondFactor.withSession("vst_x", { fetch: async () => {} }) instanceof cjs.VerificationSession);
    assert.equal(cjs.VERSION, VERSION);
  });

  it("is reached through the package's own exports map", () => {
    const viaExports = createRequire(import.meta.url)("@secondfactor/js");
    assert.equal(viaExports.VERSION, VERSION);
    assert.ok(SecondFactor.withSession("vst_x", { fetch: async () => {} }) instanceof VerificationSession);
  });
});
