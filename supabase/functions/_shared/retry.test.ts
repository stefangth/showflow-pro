import { assertEquals } from "./test-asserts.ts";
import { retryOnError, retryOnThrow } from "./retry.ts";

type Result = { data: string | null; error: { message: string } | null };

function scripted(results: Result[]) {
  let calls = 0;
  const call = () => Promise.resolve(results[Math.min(calls++, results.length - 1)]);
  return { call, count: () => calls };
}

Deno.test("retryOnError: a successful first call is returned as is, with no retry", async () => {
  const s = scripted([{ data: "ok", error: null }]);
  const out = await retryOnError(s.call, 0);
  assertEquals(out, { data: "ok", error: null });
  assertEquals(s.count(), 1);
});

Deno.test("retryOnError: an error result is retried once and the second result wins", async () => {
  const s = scripted([
    { data: null, error: { message: "Gateway Timeout" } },
    { data: "ok", error: null },
  ]);
  const out = await retryOnError(s.call, 0);
  assertEquals(out, { data: "ok", error: null });
  assertEquals(s.count(), 2);
});

Deno.test("retryOnError: a second error is returned and there is no third attempt", async () => {
  const s = scripted([
    { data: null, error: { message: "first" } },
    { data: null, error: { message: "second" } },
    { data: "never", error: null },
  ]);
  const out = await retryOnError(s.call, 0);
  assertEquals(out, { data: null, error: { message: "second" } });
  assertEquals(s.count(), 2);
});

Deno.test("retryOnThrow: a throw is retried once and the second value wins", async () => {
  let calls = 0;
  const out = await retryOnThrow(() => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error("Gateway Timeout")) : Promise.resolve("ok");
  }, 0);
  assertEquals(out, "ok");
  assertEquals(calls, 2);
});

Deno.test("retryOnThrow: a second throw propagates and there is no third attempt", async () => {
  let calls = 0;
  let caught: unknown = null;
  try {
    await retryOnThrow(() => {
      calls += 1;
      return Promise.reject(new Error(`fail ${calls}`));
    }, 0);
  } catch (e) {
    caught = e;
  }
  assertEquals((caught as Error).message, "fail 2");
  assertEquals(calls, 2);
});
