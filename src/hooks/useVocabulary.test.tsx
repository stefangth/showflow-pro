import { describe, it, expect } from "vitest";
import { renderWithProviders } from "@/test/renderWithProviders";
import { useVocabulary } from "./useVocabulary";
import { VOCABULARY } from "@/lib/orgKind";

function Probe() {
  const v = useVocabulary();
  return <p data-testid="probe">{v.Artists}</p>;
}

describe("useVocabulary", () => {
  it("returns the production English table by default", () => {
    const { getByTestId } = renderWithProviders(<Probe />, { authOverrides: {} });
    expect(getByTestId("probe").textContent).toBe(VOCABULARY.production.en.Artists);
  });

  it("follows the active org's kind", () => {
    const { getByTestId } = renderWithProviders(<Probe />, {
      authOverrides: {
        currentOrg: { id: "o1", name: "A", slug: "a", status: "active", is_demo: false, org_kind: "staffing", org_kind_set_at: null },
      },
    });
    expect(getByTestId("probe").textContent).toBe("People");
  });
});
