import { describe, it, expect } from "vitest";
import { resolveRouting, type RoutingAssignment } from "./routing";

/**
 * Mirrors the resolve_show_assignments RPC's specificity CASE (see docs/adr and the RPC
 * itself): 4 = sub_program+city match, 3 = city match & sub null, 2 = sub match & city
 * null, 1 = program-only. ORDER BY specificity DESC -> most specific wins.
 */
describe("resolveRouting", () => {
  it("exact (sub+city) beats city beats sub beats program-only", () => {
    const assignments: RoutingAssignment[] = [
      { id: "a-program", owner: "Program Owner", program: "Hamlet", subProgram: null, city: null },
      { id: "a-sub", owner: "Sub Owner", program: "Hamlet", subProgram: "Elsinore", city: null },
      { id: "a-city", owner: "City Owner", program: "Hamlet", subProgram: null, city: "berlin" },
      { id: "a-exact", owner: "Exact Owner", program: "Hamlet", subProgram: "Elsinore", city: "berlin" },
    ];
    const query = { program: "Hamlet", subProgram: "Elsinore", city: "berlin" };

    const result = resolveRouting(assignments, query);

    expect(result.winner?.id).toBe("a-exact");
    expect(result.rankMatched).toBe(4);
    // Every precedence level is occupied for this query.
    expect(result.ladder).toEqual([
      { rank: 4, label: "Exact", owner: "Exact Owner" },
      { rank: 3, label: "City", owner: "City Owner" },
      { rank: 2, label: "Sub", owner: "Sub Owner" },
      { rank: 1, label: "Program", owner: "Program Owner" },
    ]);
  });

  it("returns a null winner when no assignment matches the queried program", () => {
    const assignments: RoutingAssignment[] = [
      { id: "a-1", owner: "Owner One", program: "Hamlet", subProgram: null, city: null },
    ];
    const query = { program: "Macbeth", subProgram: null, city: null };

    const result = resolveRouting(assignments, query);

    expect(result.winner).toBeNull();
    expect(result.rankMatched).toBeNull();
    expect(result.ladder.every((entry) => entry.owner === null)).toBe(true);
  });

  it("a program-only rule matches any sub-program and city", () => {
    const assignments: RoutingAssignment[] = [
      { id: "a-1", owner: "Program Owner", program: "Hamlet", subProgram: null, city: null },
    ];

    const r1 = resolveRouting(assignments, { program: "Hamlet", subProgram: "Elsinore", city: "berlin" });
    expect(r1.winner?.id).toBe("a-1");
    expect(r1.rankMatched).toBe(1);

    const r2 = resolveRouting(assignments, { program: "Hamlet", subProgram: null, city: null });
    expect(r2.winner?.id).toBe("a-1");
    expect(r2.rankMatched).toBe(1);

    const r3 = resolveRouting(assignments, { program: "Hamlet", subProgram: "AnythingElse", city: "hamburg" });
    expect(r3.winner?.id).toBe("a-1");
    expect(r3.rankMatched).toBe(1);
  });

  it("a city-scoped rule does not match a different city", () => {
    const assignments: RoutingAssignment[] = [
      { id: "a-city-berlin", owner: "Berlin Owner", program: "Hamlet", subProgram: null, city: "berlin" },
    ];
    const query = { program: "Hamlet", subProgram: null, city: "hamburg" };

    const result = resolveRouting(assignments, query);

    expect(result.winner).toBeNull();
    expect(result.rankMatched).toBeNull();
    const rank3 = result.ladder.find((entry) => entry.rank === 3);
    expect(rank3?.owner).toBeNull();
  });

  it("a sub-program-scoped rule does not match a different sub-program", () => {
    const assignments: RoutingAssignment[] = [
      { id: "a-sub-elsinore", owner: "Elsinore Owner", program: "Hamlet", subProgram: "Elsinore", city: null },
    ];
    const query = { program: "Hamlet", subProgram: "Other", city: null };

    const result = resolveRouting(assignments, query);

    expect(result.winner).toBeNull();
    expect(result.rankMatched).toBeNull();
  });

  it("falls back to a program-only rule when a more specific rule exists for a different scope", () => {
    const assignments: RoutingAssignment[] = [
      { id: "a-program", owner: "Program Owner", program: "Hamlet", subProgram: null, city: null },
      { id: "a-city-berlin", owner: "Berlin Owner", program: "Hamlet", subProgram: null, city: "berlin" },
    ];
    // Query a different city than the specific rule covers -> only the program-only rule
    // is a candidate, and the city rule must not leak into the ladder for this query.
    const query = { program: "Hamlet", subProgram: null, city: "hamburg" };

    const result = resolveRouting(assignments, query);

    expect(result.winner?.id).toBe("a-program");
    expect(result.rankMatched).toBe(1);
    const rank3 = result.ladder.find((entry) => entry.rank === 3);
    expect(rank3?.owner).toBeNull();
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
