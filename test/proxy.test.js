// Proxy mode: the client for apps that forward to secondfactor.ai through
// three endpoints of their own. Existing apps depend on its request shape, so
// the tests hold it, and hold the deprecated names to their old behaviour.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SecondFactor, SecondFactorError } from "../dist/index.js";

function fakeFetch(...answers) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const [status, body] = answers.shift();
    return new Response(JSON.stringify(body), { status });
  };
  return { fetch, calls };
}

const proxy = (fetch) => new SecondFactor("https://api.example.com/auth/otp/", 30, { fetch });

describe("proxy mode", () => {
  it("sends to the proxy's start endpoint and resolves with the SID", async () => {
    const { fetch, calls } = fakeFetch([201, { sid: "VE1", status: "PENDING" }]);
    const sid = await proxy(fetch).send("+9779841000001");

    assert.equal(sid, "VE1");
    assert.equal(calls[0].url, "https://api.example.com/auth/otp/start");
    assert.deepEqual(calls[0].body, { phone: "+9779841000001" });
  });

  it("sends no custom header, so a proxy is not asked to answer a preflight", async () => {
    const { fetch, calls } = fakeFetch([201, { sid: "VE1" }]);
    await proxy(fetch).send("+9779841000001");
    assert.deepEqual(Object.keys(calls[0].headers).sort(), ["Accept", "Content-Type"]);
  });

  it("checks with the proxy contract's field names", async () => {
    const { fetch, calls } = fakeFetch([200, { sid: "VE1", status: "VERIFIED" }]);
    const result = await proxy(fetch).check("VE1", " 123456 ");

    assert.equal(result.verified, true);
    assert.equal(calls[0].url, "https://api.example.com/auth/otp/verify");
    assert.deepEqual(calls[0].body, { request_id: "VE1", otp: "123456" });
  });

  it("resolves a wrong code with verified false", async () => {
    const { fetch } = fakeFetch([422, { sid: "VE1", status: "PENDING", attempts_remaining: 4 }]);
    const result = await proxy(fetch).check("VE1", "000000");
    assert.equal(result.verified, false);
    assert.equal(result.attempts_remaining, 4);
  });

  for (const [status, code] of [["EXPIRED", "expired"], ["LOCKED", "locked"], ["VERIFIED", "already_verified"]]) {
    it(`throws ${code} for a ${status} verification`, async () => {
      const { fetch } = fakeFetch([409, { sid: "VE1", status }]);
      await assert.rejects(proxy(fetch).check("VE1", "123456"), (error) => {
        assert.ok(error instanceof SecondFactorError);
        assert.equal(error.code, code);
        return true;
      });
    });
  }

  it("resends with the old SID and resolves with the new one", async () => {
    const { fetch, calls } = fakeFetch([201, { sid: "VE2" }]);
    assert.equal(await proxy(fetch).resend("VE1"), "VE2");
    assert.deepEqual(calls[0].body, { request_id: "VE1" });
  });

  it("counts the resend cooldown from the last successful send", async () => {
    const { fetch } = fakeFetch([201, { sid: "VE1" }]);
    const sf = proxy(fetch);
    assert.equal(sf.resendAvailableIn, 0);
    await sf.send("+9779841000001");
    assert.ok(sf.resendAvailableIn > 28 && sf.resendAvailableIn <= 30);
  });

  it("keeps start and verify working for existing callers, verify still a boolean", async () => {
    const { fetch } = fakeFetch([201, { sid: "VE1" }], [422, { sid: "VE1", status: "PENDING" }]);
    const sf = proxy(fetch);
    assert.equal(await sf.start("+9779841000001"), "VE1");
    assert.equal(await sf.verify("VE1", "000000"), false);
  });

  it("throws the envelope's code for a refused send, and does not start the cooldown", async () => {
    const { fetch } = fakeFetch([429, { code: "rate_limited", message: "Slow down." }]);
    const sf = proxy(fetch);
    await assert.rejects(sf.send("+9779841000001"), { code: "rate_limited", status: 429 });
    assert.equal(sf.resendAvailableIn, 0);
  });
});
