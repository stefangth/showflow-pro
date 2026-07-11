import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapEventToLogStatus } from "./index.ts";

Deno.test("maps Resend event types to log statuses", () => {
  assertEquals(mapEventToLogStatus("email.sent"), "sent");
  assertEquals(mapEventToLogStatus("email.delivered"), "delivered");
  assertEquals(mapEventToLogStatus("email.delivery_delayed"), "delivery_delayed");
  assertEquals(mapEventToLogStatus("email.bounced"), "bounced");
  assertEquals(mapEventToLogStatus("email.complained"), "complained");
  assertEquals(mapEventToLogStatus("email.opened"), null);
});
