import { describe, it, expect } from "vitest";
import { resolveRouting, type RoutingAssignment } from "./routing";

/**
 * Mirrors the resolve_show_assignments RPC's specificity CASE (see docs/adr and the RPC
 * itself): 4 = sub_program+city match, 3 = city match & sub null, 2 = sub match & city
 * null, 1 = program-only. The RPC returns EVERY row with specificity > 0 (no ORDER BY
 * LIMIT, no max filter) and real callers notify the full deduped set - there is no
 * single "winner", everyone whose scope matches is notified.
 */
describe("resolveRouting", () => {
  it("notifies every matching owner across all specificity levels, not just the most specific", () => {
    const assignments: RoutingAssignment[] = [
      { id: "a-program", owner: "Program Owner", program: "Hamlet", subProgram: null, city: null },
      { id: "a-sub", owner: "Sub Owner", program: "Hamlet", subProgram: "Elsinore", city: null },
      { id: "a-city", owner: "City Owner", program: "Hamlet", subProgram: null, city: "berlin" },
      { id: "a-exact", owner: "Exact Owner", program: "Hamlet", subProgram: "Elsinore", city: "berlin" },
    ];
    const query = { program: "Hamlet", subProgram: "Elsinore", city: "berlin" };

    const result = resolveRouting(assignments, query);

    expect(result.notified.map((a) => a.id).sort()).toEqual(
      ["a-city", "a-exact", "a-program", "a-sub"].sort(),
    );
    expect(result.ladder).toEqual([
      { rank: 4, label: "Exact", owners: [assignments[3]] },
      { rank: 3, label: "City", owners: [assignments[2]] },
      { rank: 2, label: "Sub", owners: [assignments[1]] },
      { rank: 1, label: "Program", owners: [assignments[0]] },
    ]);
  });

  it("notifies two owners tied at the same specificity, plus a broader program-only owner and a narrower city owner", () => {
    const assignments: RoutingAssignment[] = [
      { id: "a-program", owner: "Program Owner", program: "Hamlet", subProgram: null, city: null },
      { id: "a-city-1", owner: "City Owner One", program: "Hamlet", subProgram: null, city: "berlin" },
      { id: "a-city-2", owner: "City Owner Two", program: "Hamlet", subProgram: null, city: "berlin" },
    ];
    const query = { program: "Hamlet", subProgram: null, city: "berlin" };

    const result = resolveRouting(assignments, query);

    expect(result.notified.map((a) => a.id).sort()).toEqual(
      ["a-city-1", "a-city-2", "a-program"].sort(),
    );
    const rank3 = result.ladder.find((entry) => entry.rank === 3);
    expect(rank3?.owners.map((a) => a.id).sort()).toEqual(["a-city-1", "a-city-2"]);
  });

  it("dedupes notified owners by producer when the same owner matches at multiple levels", () => {
    const assignments: RoutingAssignment[] = [
      { id: "a-program", owner: "Same Owner", program: "Hamlet", subProgram: null, city: null },
      { id: "a-city", owner: "Same Owner", program: "Hamlet", subProgram: null, city: "berlin" },
    ];
    const query = { program: "Hamlet", subProgram: null, city: "berlin" };

    const result = resolveRouting(assignments, query);

    expect(result.notified).toHaveLength(1);
    expect(result.notified[0].owner).toBe("Same Owner");
  });

  it("returns an empty notified set when no assignment matches the queried program", () => {
    const assignments: RoutingAssignment[] = [
      { id: "a-1", owner: "Owner One", program: "Hamlet", subProgram: null, city: null },
    ];
    const query = { program: "Macbeth", subProgram: null, city: null };

    const result = resolveRouting(assignments, query);

    expect(result.notified).toEqual([]);
    expect(result.ladder.every((entry) => entry.owners.length === 0)).toBe(true);
  });

  it("a program-only rule matches any sub-program and city", () => {
    const assignments: RoutingAssignment[] = [
      { id: "a-1", owner: "Program Owner", program: "Hamlet", subProgram: null, city: null },
    ];

    const r1 = resolveRouting(assignments, { program: "Hamlet", subProgram: "Elsinore", city: "berlin" });
    expect(r1.notified.map((a) => a.id)).toEqual(["a-1"]);

    const r2 = resolveRouting(assignments, { program: "Hamlet", subProgram: null, city: null });
    expect(r2.notified.map((a) => a.id)).toEqual(["a-1"]);

    const r3 = resolveRouting(assignments, { program: "Hamlet", subProgram: "AnythingElse", city: "hamburg" });
    expect(r3.notified.map((a) => a.id)).toEqual(["a-1"]);
  });

  it("a city-scoped rule does not match a different city", () => {
    const assignments: RoutingAssignment[] = [
      { id: "a-city-berlin", owner: "Berlin Owner", program: "Hamlet", subProgram: null, city: "berlin" },
    ];
    const query = { program: "Hamlet", subProgram: null, city: "hamburg" };

    const result = resolveRouting(assignments, query);

    expect(result.notified).toEqual([]);
    const rank3 = result.ladder.find((entry) => entry.rank === 3);
    expect(rank3?.owners).toEqual([]);
  });

  it("a sub-program-scoped rule does not match a different sub-program", () => {
    const assignments: RoutingAssignment[] = [
      { id: "a-sub-elsinore", owner: "Elsinore Owner", program: "Hamlet", subProgram: "Elsinore", city: null },
    ];
    const query = { program: "Hamlet", subProgram: "Other", city: null };

    const result = resolveRouting(assignments, query);

    expect(result.notified).toEqual([]);
  });

  it("excludes a more specific rule scoped to a different city from the notified set", () => {
    const assignments: RoutingAssignment[] = [
      { id: "a-program", owner: "Program Owner", program: "Hamlet", subProgram: null, city: null },
      { id: "a-city-berlin", owner: "Berlin Owner", program: "Hamlet", subProgram: null, city: "berlin" },
    ];
    // Query a different city than the specific rule covers -> only the program-only rule
    // is a candidate, and the city rule must not leak into the ladder for this query.
    const query = { program: "Hamlet", subProgram: null, city: "hamburg" };

    const result = resolveRouting(assignments, query);

    expect(result.notified.map((a) => a.id)).toEqual(["a-program"]);
    const rank3 = result.ladder.find((entry) => entry.rank === 3);
    expect(rank3?.owners).toEqual([]);
  });

  it("is a pure function: does not mutate its inputs and is deterministic across calls", () => {
    const assignments: RoutingAssignment[] = [
      { id: "a-1", owner: "Owner One", program: "Hamlet", subProgram: null, city: null },
    ];
    const query = { program: "Hamlet", subProgram: null, city: null };
    const snapshot = JSON.stringify(assignments);

    const r1 = resolveRouting(assignments, query);
    const r2 = resolveRouting(assignments, query);

    expect(JSON.stringify(assignments)).toBe(snapshot);
    expect(r1).toEqual(r2);
  });
});
