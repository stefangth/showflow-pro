import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { OrgKindSelect } from "./OrgKindSelect";

describe("OrgKindSelect", () => {
  it("shows the current kind's title and lists both kinds with descriptions", async () => {
    const onChange = vi.fn();
    renderWithProviders(<OrgKindSelect id="k" value="production" onChange={onChange} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Live production");
    fireEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByRole("option", { name: /staffing agency/i })).toBeInTheDocument();
    expect(screen.getByText(/clients, shifts, staff and teams/i)).toBeInTheDocument();
  });

  it("calls onChange with the picked kind", async () => {
    const onChange = vi.fn();
    renderWithProviders(<OrgKindSelect id="k" value="production" onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: /staffing agency/i }));
    expect(onChange).toHaveBeenCalledWith("staffing");
  });

  it("is disabled when told so", () => {
    renderWithProviders(<OrgKindSelect id="k" value="production" onChange={() => {}} disabled />);
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
