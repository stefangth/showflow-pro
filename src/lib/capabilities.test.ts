import { describe, expect, it } from "vitest";
import {
  CAPABILITY_KEYS, CAPABILITY_REGISTRY, enabledCapabilities, isCapabilityEnabled,
} from "./capabilities";

describe("capabilities registry", () => {
  it("producer_can_invite defaults to off (no row)", () => {
    expect(isCapabilityEnabled([], "producer_can_invite")).toBe(false);
    expect(enabledCapabilities([]).has("producer_can_invite")).toBe(false);
  });
  it("an explicit enabled row overrides the default", () => {
    expect(isCapabilityEnabled([{ capability: "producer_can_invite", enabled: true }], "producer_can_invite")).toBe(true);
  });
  it("an explicit disabled row stays off", () => {
    expect(isCapabilityEnabled([{ capability: "producer_can_invite", enabled: false }], "producer_can_invite")).toBe(false);
  });
  it("CAPABILITY_KEYS matches the registry", () => {
    expect(CAPABILITY_KEYS).toEqual(Object.keys(CAPABILITY_REGISTRY));
    expect(CAPABILITY_REGISTRY.producer_can_invite.defaultEnabled).toBe(false);
  });
});
