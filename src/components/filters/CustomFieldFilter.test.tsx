import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CustomFieldFilter } from "./CustomFieldFilter";
import type { CustomFieldDefinition } from "@/data/customFields";

const numberDef: CustomFieldDefinition = {
  id: "d1", org_id: "o", entity: "show_dates", key: "capacity", label: "Capacity",
  type: "number", source: "airtable", source_field: "Capacity", options: null, filterable: true, sortable: true,
};
const textDef: CustomFieldDefinition = { ...numberDef, id: "d2", key: "headliner", label: "Headliner", type: "text" };

describe("CustomFieldFilter", () => {
  it("renders min/max number inputs and emits a number filter", () => {
    const onChange = vi.fn();
    render(<CustomFieldFilter def={numberDef} value={{ kind: "number", min: null, max: null }} onChange={onChange} />);
    const min = screen.getByLabelText("Capacity min");
    fireEvent.change(min, { target: { value: "100" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "number", min: 100, max: null });
  });

  it("renders a text input and emits a text filter", () => {
    const onChange = vi.fn();
    render(<CustomFieldFilter def={textDef} value={{ kind: "text", q: "" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Headliner contains"), { target: { value: "houd" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "text", q: "houd" });
  });
});
