import { describe, it, expect, vi } from "vitest";
import { buildCastGroups, type CastBookingLike } from "@/lib/cockpitCast";

const b = (over: Partial<CastBookingLike>): CastBookingLike => ({
  id: over.id ?? "b1",
  status: over.status ?? "confirmed",
  is_understudy: over.is_understudy ?? false,
  offer_tier: over.offer_tier ?? 1,
  confirmed_at: over.confirmed_at ?? null,
  artist: over.artist ?? { name: "Ada Lovelace" },
});

const opts = () => ({ canConfirm: true, onConfirm: vi.fn(), canCancel: true, onCancel: vi.fn(), onOpenSlot: vi.fn() });

describe("buildCastGroups", () => {
  it("splits main and understudy groups with confirmed 'N of M' counts", () => {
    const groups = buildCastGroups(
      [
        b({ id: "m1", status: "confirmed", is_understudy: false }),
        b({ id: "u1", status: "confirmed", is_understudy: true }),
      ],
      { main_cast: 4, understudies: 2 },
      opts(),
    );
    expect(groups.map((g) => g.title)).toEqual(["Main cast", "Understudies"]);
    expect(groups[0].count).toBe("1 of 4");
    expect(groups[1].count).toBe("1 of 2");
  });

  it("pads a group with dashed open-slot rows up to capacity", () => {
    const [main] = buildCastGroups([b({ id: "m1", status: "confirmed" })], { main_cast: 3, understudies: 0 }, opts());
    const openRows = main.rows.filter((r) => r.open);
    expect(openRows).toHaveLength(2);
    expect(main.rows[0].open).toBeFalsy();
  });

  it("labels an open slot with pending offers when suggested bookings exist", () => {
    const [main] = buildCastGroups(
      [b({ id: "s1", status: "suggested", offer_tier: 2 })],
      { main_cast: 2, understudies: 0 },
      opts(),
    );
    // suggested is a named "Offered" row, plus one open slot noting the pending offer
    const offered = main.rows.find((r) => r.status === "offered");
    expect(offered?.meta).toContain("offer pending");
    const open = main.rows.find((r) => r.open);
    expect(open?.meta).toBe("1 offer pending");
  });

  it("shows a Confirm callback only on accepted rows when canConfirm", () => {
    const [main] = buildCastGroups(
      [b({ id: "a1", status: "soft_booked" }), b({ id: "c1", status: "confirmed" })],
      { main_cast: 2, understudies: 0 },
      { canConfirm: true, onConfirm: vi.fn(), canCancel: true, onCancel: vi.fn(), onOpenSlot: vi.fn() },
    );
    const accepted = main.rows.find((r) => r.status === "accepted");
    const confirmed = main.rows.find((r) => r.status === "confirmed");
    expect(accepted?.onConfirm).toBeTypeOf("function");
    expect(confirmed?.onConfirm).toBeUndefined();
  });

  it("omits Confirm when canConfirm is false", () => {
    const [main] = buildCastGroups(
      [b({ id: "a1", status: "soft_booked" })],
      { main_cast: 1, understudies: 0 },
      { canConfirm: false, onConfirm: vi.fn(), canCancel: true, onCancel: vi.fn(), onOpenSlot: vi.fn() },
    );
    expect(main.rows.find((r) => r.status === "accepted")?.onConfirm).toBeUndefined();
  });

  it("with no slot config: shows named rows only (no open slots, count = confirmed)", () => {
    const groups = buildCastGroups([b({ id: "s1", status: "suggested" })], null, opts());
    expect(groups).toHaveLength(1); // no understudy bookings → no understudy group
    expect(groups[0].rows.every((r) => !r.open)).toBe(true);
    expect(groups[0].count).toBe("0");
  });

  it("drops cancelled bookings", () => {
    const [main] = buildCastGroups(
      [b({ id: "x", status: "cancelled" }), b({ id: "c", status: "confirmed" })],
      { main_cast: 1, understudies: 0 },
      opts(),
    );
    expect(main.rows.filter((r) => !r.open)).toHaveLength(1);
  });
});
