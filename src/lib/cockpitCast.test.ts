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

const opts = () => ({ canConfirm: true, onConfirm: vi.fn(), canCancel: true, onCancel: vi.fn(), canOpenSlot: true, slotActionLabel: "Open next tier", onOpenSlot: vi.fn() });

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
    // suggested is a named "Offered" row, plus one open slot noting the ask still waiting
    const offered = main.rows.find((r) => r.status === "offered");
    expect(offered?.meta).toContain("asked");
    const open = main.rows.find((r) => r.open);
    expect(open?.meta).toBe("1 ask waiting");
  });

  it("annotates the pending-asks total only on the first open slot", () => {
    // 1 suggested + capacity 4, 0 filled → 1 named row + 4 open rows; the
    // "1 ask waiting" note must appear once, not repeated on every open slot.
    const [main] = buildCastGroups(
      [b({ id: "s1", status: "suggested", offer_tier: 2 })],
      { main_cast: 4, understudies: 0 },
      opts(),
    );
    const openMetas = main.rows.filter((r) => r.open).map((r) => r.meta);
    expect(openMetas).toEqual(["1 ask waiting", "No booking yet", "No booking yet", "No booking yet"]);
  });

  it("does not let offered (suggested) bookings consume open slots — meter parity", () => {
    // A tier is offered to more candidates than slots: 6 offered, capacity 4,
    // none accepted → 6 named "Offered" rows PLUS 4 open slots (not 0), matching
    // the header meter's "0 of 4" and keeping the open-slot action available.
    const suggested = Array.from({ length: 6 }, (_, i) => b({ id: `s${i}`, status: "suggested" }));
    const [main] = buildCastGroups(suggested, { main_cast: 4, understudies: 0 }, opts());
    expect(main.rows.filter((r) => !r.open)).toHaveLength(6);
    expect(main.rows.filter((r) => r.open)).toHaveLength(4);
    expect(main.rows.find((r) => r.open)?.slotActionLabel).toBe("Open next tier");
    expect(main.count).toBe("0 of 4");
  });

  it("shows a Confirm callback only on accepted rows when canConfirm", () => {
    const [main] = buildCastGroups(
      [b({ id: "a1", status: "soft_booked" }), b({ id: "c1", status: "confirmed" })],
      { main_cast: 2, understudies: 0 },
      { canConfirm: true, onConfirm: vi.fn(), canCancel: true, onCancel: vi.fn(), canOpenSlot: true, slotActionLabel: "Open next tier", onOpenSlot: vi.fn() },
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
      { canConfirm: false, onConfirm: vi.fn(), canCancel: true, onCancel: vi.fn(), canOpenSlot: true, slotActionLabel: "Open next tier", onOpenSlot: vi.fn() },
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

  it("keeps an over-capacity understudy visible when understudies were reduced to 0", () => {
    // Capacity reduced to 0 after the booking; the artist must not silently vanish.
    const groups = buildCastGroups(
      [b({ id: "u1", status: "confirmed", is_understudy: true })],
      { main_cast: 4, understudies: 0 },
      opts(),
    );
    const us = groups.find((g) => g.key === "us");
    expect(us).toBeDefined();
    expect(us!.rows.filter((r) => !r.open).map((r) => r.id)).toEqual(["u1"]);
    expect(us!.rows.some((r) => r.open)).toBe(false); // no negative/open padding
  });

  it("open-slot action label comes from slotActionLabel and gates on canOpenSlot (not canConfirm)", () => {
    const slots = { main_cast: 2, understudies: 0 };
    // Direct-flow label, and canOpenSlot true even though canConfirm is false.
    const [directMain] = buildCastGroups([b({ id: "c", status: "confirmed" })], slots, {
      canConfirm: false, onConfirm: vi.fn(), canCancel: true, onCancel: vi.fn(),
      canOpenSlot: true, slotActionLabel: "Book artist", onOpenSlot: vi.fn(),
    });
    expect(directMain.rows.find((r) => r.open)?.slotActionLabel).toBe("Book artist");

    // canOpenSlot false hides the action even when canConfirm is true.
    const [gatedMain] = buildCastGroups([b({ id: "c", status: "confirmed" })], slots, {
      canConfirm: true, onConfirm: vi.fn(), canCancel: true, onCancel: vi.fn(),
      canOpenSlot: false, slotActionLabel: "Open next tier", onOpenSlot: vi.fn(),
    });
    expect(gatedMain.rows.find((r) => r.open)?.slotActionLabel).toBeUndefined();
  });
});
