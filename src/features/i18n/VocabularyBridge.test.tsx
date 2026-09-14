import { describe, it, expect, beforeAll } from "vitest";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { screen, act } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { AuthContext, type AuthContextType } from "@/features/auth/AuthContext";
import i18n from "@/i18n";
import { VocabularyBridge } from "./VocabularyBridge";
import { VOCABULARY } from "@/lib/orgKind";
import type { Organization } from "@/data/orgs";

function Probe() {
  const { t } = useTranslation("vocabTest");
  return <p data-testid="probe">{t("line")}</p>;
}

const org = (kind: Organization["org_kind"]): Organization =>
  ({ id: "o1", name: "A", slug: "a", status: "active", is_demo: false, org_kind: kind, org_kind_set_at: null });

/**
 * renderWithProviders' `rerender` re-renders inside the ORIGINAL wrapper closure, so a second
 * `authOverrides` argument to it is inert (RTL's rerender only ever takes a UI element). To
 * genuinely exercise a currentOrg change (and the consumer re-render it should cause), this
 * harness holds `currentOrg` in real React state and mounts a real `AuthContext.Provider`
 * (the same context object renderWithProviders' own test provider uses) so a state update
 * flows down like it would from a real org switch.
 */
function Harness({ initialKind }: { initialKind: Organization["org_kind"] }) {
  const [currentOrg, setCurrentOrg] = useState<Organization>(org(initialKind));
  const value: AuthContextType = {
    user: null,
    session: null,
    roles: ["admin"],
    memberships: [],
    orgs: [],
    currentOrg,
    isSuperAdmin: false,
    switchOrg: () => {},
    refreshOrgs: async () => {},
    loading: false,
    signIn: async () => {},
    signOut: async () => {},
    hasRole: () => true,
    viewAsRole: null,
    setViewAsRole: () => {},
    viewAsUser: null,
    setViewAsUser: () => {},
  };
  return (
    <AuthContext.Provider value={value}>
      <button onClick={() => setCurrentOrg(org("staffing"))}>switch</button>
      <VocabularyBridge />
      <Probe />
    </AuthContext.Provider>
  );
}

describe("VocabularyBridge", () => {
  beforeAll(() => {
    i18n.addResourceBundle("en", "vocabTest", { line: "Your {{Artists}}" }, true, true);
    i18n.addResourceBundle("de", "vocabTest", { line: "Deine {{Artists}}" }, true, true);
  });

  it("renders staffing words for a staffing org and re-renders consumers on change", async () => {
    renderWithProviders(<Harness initialKind="production" />);
    expect(screen.getByTestId("probe")).toHaveTextContent("Your Artists");

    await act(async () => {
      screen.getByText("switch").click();
    });
    expect(await screen.findByText("Your People")).toBeInTheDocument();
  });

  it("follows the active language", async () => {
    renderWithProviders(<><VocabularyBridge /><Probe /></>, { authOverrides: { currentOrg: org("staffing") } });
    await act(async () => { await i18n.changeLanguage("de"); });
    expect(await screen.findByText("Deine Personen")).toBeInTheDocument();
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("resets defaultVariables to the production table on unmount so a public route can't inherit stale words", async () => {
    const { unmount } = renderWithProviders(
      <VocabularyBridge />,
      { authOverrides: { currentOrg: org("staffing") } },
    );
    const lang = i18n.language as "en" | "de";
    // Mount applied the staffing table to the singleton.
    expect(i18n.options.interpolation?.defaultVariables).toBe(VOCABULARY.staffing[lang]);
    await act(async () => { unmount(); });
    // Unmount (sign-out to a layout-less page) reset it to production, so no staffing words leak.
    expect(i18n.options.interpolation?.defaultVariables).toBe(VOCABULARY.production[lang]);
  });
});
