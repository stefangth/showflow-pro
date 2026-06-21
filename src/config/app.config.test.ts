import { describe, it, expect } from "vitest";
import { BOOKING_ENGINE_DEFAULTS } from "./app.config";

describe("config/app.config", () => {
  it("BOOKING_ENGINE_DEFAULTS holds the canonical booking-engine fallbacks (mirror of supabase/functions/_shared/settings.ts)", () => {
    expect(BOOKING_ENGINE_DEFAULTS).toEqual({
      offer_response_window_hours: 48,
      offer_digest_hour_berlin: 19,
      confirmation_digest_hour_berlin: 20,
      resend_from_address: "ShowFlow <noreply@showflow.pro>",
    });
  });
});
