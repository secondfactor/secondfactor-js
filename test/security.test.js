// What keeps the client token, the phone number and the code safe: where
// requests may go, what happens when something between this library and the
// API answers unexpectedly, and that an answer is never mistaken for a
// verification it is not. Redirects are tested against a real local server
// with the runtime's own fetch, because a fake fetch would not follow them.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { inspect } from "node:util";
import { after, before, beforeEach, describe, it } from "node:test";
import { SecondFactor, SecondFactorError } from "../dist/index.js";

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

/** Records every request and answers from `routes`, which map
 * `METHOD /path` to `[status, body, headers]`. A string body is sent as it is,
 * to imitate a proxy's HTML page. Anything unrouted is a 404 envelope. */
const stub = { routes: {}, paths: [], base: "" };
const server = createServer((req, res) => {
  stub.paths.push(req.url);
  req.resume();
  req.on("end", () => {
    const [status, body, headers = {}] = stub.routes[`${req.method} ${req.url}`] ?? [404, { code: "not_found" }];
    res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/html" : "application/json", ...headers });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });
});

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  stub.base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  stub.routes = {};
  stub.paths = [];
});

async function refusal(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof SecondFactorError, `expected a SecondFactorError, got ${error}`);
    return error;
  }
  assert.fail("expected a SecondFactorError");
}

/** A fetch that answers once, with a body as raw text. */
const answering = (status, text) => async () => new Response(text, { status });

describe("redirects", () => {
  // fetch follows redirects by default and resends custom headers, the body
  // (on 307 and 308) and, in older runtimes, Authorization to wherever the
  // Location points. The API never redirects, so a redirect is refused.
  for (const status of [301, 302, 303, 307, 308]) {
    it(`refuses a ${status} from the API and never requests its Location`, async () => {
      stub.routes["POST /api/hosted/session/check"] = [status, "", { Location: `${stub.base}/elsewhere` }];
      const session = SecondFactor.withSession("vst_token", { baseUrl: stub.base });

      const error = await refusal(session.check("123456"));

      assert.equal(error.status, status);
      assert.equal(error.code, null);
      assert.deepEqual(stub.paths, ["/api/hosted/session/check"]);
    });

    it(`refuses a ${status} from a proxy and never requests its Location`, async () => {
      stub.routes["POST /otp/verify"] = [status, "", { Location: `${stub.base}/elsewhere` }];
      const sf = new SecondFactor(`${stub.base}/otp`);

      const error = await refusal(sf.check("VE1", "123456"));

      assert.equal(error.status, status);
      assert.deepEqual(stub.paths, ["/otp/verify"]);
    });
  }

  it("refuses an answer that a runtime ignoring `redirect` reached by following one, as on React Native", async () => {
    // React Native's fetch is built on XMLHttpRequest, which always follows
    // redirects and does not set `redirected`, but does report the final URL.
    const fetch = async () => {
      const response = new Response(JSON.stringify({ ...STATE, status: "VERIFIED" }), { status: 200 });
      Object.defineProperty(response, "redirected", { value: undefined });
      Object.defineProperty(response, "url", { value: "https://attacker.example/api/hosted/session/check" });
      return response;
    };
    await refusal(SecondFactor.withSession("vst_token", { fetch }).check("123456"));
  });

  it("refuses an answer the runtime says came through a redirect", async () => {
    const fetch = async () => {
      const response = new Response(JSON.stringify({ ...STATE, status: "VERIFIED" }), { status: 200 });
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    };
    await refusal(SecondFactor.withSession("vst_token", { fetch }).check("123456"));
  });

  it("accepts an answer whose final URL is the one requested", async () => {
    const fetch = async (url) => {
      const response = new Response(JSON.stringify(STATE), { status: 200 });
      Object.defineProperty(response, "redirected", { value: undefined });
      Object.defineProperty(response, "url", { value: url });
      return response;
    };
    const state = await SecondFactor.withSession("vst_token", { fetch, baseUrl: "HTTPS://API.secondfactor.ai:443/" }).status();
    assert.equal(state.status, "OPEN");
  });
});

describe("base URLs", () => {
  // The client token must only ever travel encrypted. Plain http:// is
  // accepted only for this machine, for a local stub in development.
  const refused = [
    "http://api.secondfactor.ai",
    "http://10.0.0.5",
    "http://localhost.attacker.example",
    "http://localhost@attacker.example",
    "http://127.0.0.1.nip.io",
    "ftp://api.secondfactor.ai",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "api.secondfactor.ai",
    "https://",
    "https://user:pass@api.secondfactor.ai",
    "https://api.secondfactor.ai?x=",
    "https://api.secondfactor.ai#x",
    " https://api.secondfactor.ai",
  ];
  const accepted = [
    "https://api.secondfactor.ai",
    "https://api.secondfactor.ai/",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://[::1]:8000",
  ];

  for (const baseUrl of refused) {
    it(`refuses ${JSON.stringify(baseUrl)} in both modes`, () => {
      assert.throws(() => SecondFactor.withSession("vst_token", { baseUrl, fetch }), TypeError);
      assert.throws(() => new SecondFactor(baseUrl, 30, { fetch }), TypeError);
    });
  }
  for (const baseUrl of accepted) {
    it(`accepts ${JSON.stringify(baseUrl)} in both modes`, () => {
      SecondFactor.withSession("vst_token", { baseUrl, fetch });
      new SecondFactor(baseUrl, 30, { fetch });
    });
  }

  it("accepts a proxy on the page's own origin, but not a protocol-relative one", () => {
    new SecondFactor("/auth/otp", 30, { fetch });
    assert.throws(() => new SecondFactor("//attacker.example/otp", 30, { fetch }), TypeError);
    assert.throws(() => new SecondFactor("/\\attacker.example/otp", 30, { fetch }), TypeError);
  });
});

describe("answers that cannot be trusted", () => {
  it("does not call a successful answer verified unless the session says VERIFIED", async () => {
    const fetch = answering(200, JSON.stringify(STATE));
    const result = await SecondFactor.withSession("vst_token", { fetch }).check("123456");
    assert.equal(result.verified, false);
  });

  for (const [name, text] of [["an HTML page", "<html>Sign in to the Wi-Fi</html>"], ["an empty body", ""], ["JSON that is not a state", "{}"], ["JSON null", "null"]]) {
    it(`throws for ${name} with a successful status in session mode, never resolving verified`, async () => {
      const error = await refusal(SecondFactor.withSession("vst_token", { fetch: answering(200, text) }).check("123456"));
      assert.equal(error.status, 200);
      assert.equal(error.code, null);
    });
  }

  it("throws for a non-JSON successful answer in proxy mode", async () => {
    const error = await refusal(new SecondFactor("https://api.example.com/otp", 30, { fetch: answering(200, "<html></html>") }).check("VE1", "123456"));
    assert.equal(error.status, 200);
  });

  it("throws a code-less error for a non-JSON refusal", async () => {
    const error = await refusal(SecondFactor.withSession("vst_token", { fetch: answering(502, "<html>Bad gateway</html>") }).status());
    assert.equal(error.status, 502);
    assert.equal(error.code, null);
  });
});

describe("the client token", () => {
  it("is not exposed by logging or serialising the session", () => {
    const session = SecondFactor.withSession("vst_secret_token", { fetch });
    assert.ok(!inspect(session, { showHidden: true, depth: 5 }).includes("vst_secret_token"));
    assert.ok(!JSON.stringify(session).includes("vst_secret_token"));
    assert.ok(!Object.values(session).includes("vst_secret_token"));
  });

  it("is refused, without being echoed, when it could not be a header value", () => {
    for (const token of ["vst_a\r\nX-Injected: 1", "vst a", "vst_é"]) {
      assert.throws(
        () => SecondFactor.withSession(token, { fetch }),
        (error) => error instanceof TypeError && !error.message.includes(token),
      );
    }
  });
});

describe("timeouts", () => {
  /** A fetch that never answers, and gives up only when its signal aborts.
   * Without a signal it hangs, and the test fails on its own timeout. */
  const hanging = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal.reason ?? new Error("aborted")));
    });
  const limit = { timeout: 2000 };

  it("gives up on a session request after timeoutMs", limit, async () => {
    const error = await refusal(SecondFactor.withSession("vst_token", { fetch: hanging, timeoutMs: 20 }).status());
    assert.equal(error.code, "network_error");
  });

  it("gives up on a proxy request after timeoutMs", limit, async () => {
    const error = await refusal(new SecondFactor("https://api.example.com/otp", 30, { fetch: hanging, timeoutMs: 20 }).send("+9779841000001"));
    assert.equal(error.code, "network_error");
  });

  it("still gives up where AbortSignal.timeout is missing, as on older React Native", limit, async () => {
    const original = AbortSignal.timeout;
    delete AbortSignal.timeout;
    try {
      const error = await refusal(SecondFactor.withSession("vst_token", { fetch: hanging, timeoutMs: 20 }).status());
      assert.equal(error.code, "network_error");
    } finally {
      AbortSignal.timeout = original;
    }
  });
});
