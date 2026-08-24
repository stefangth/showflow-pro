import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MappingTab, type MappingTabProps } from "./MappingTab";

const base: MappingTabProps = {
  tableName: "",
  fields: [],
  fieldMap: {},
  onSetField: () => {},
  mapped: 0,
  total: 9,
  optionNames: () => [],
  unboundFields: [],
  onAddAllCustom: () => {},
  canWrite: true,
};

it("never prints a dangling period when no table is selected", () => {
  render(<MappingTab {...base} />);
  // The prefix/suffix pair interpolates an empty <strong>, which used to render
  // "...reads from one column in . Catalog links..." on a fresh org.
  expect(document.body.textContent).not.toContain("in .");
});

it("names the table when there is one", () => {
  render(<MappingTab {...base} tableName="Shows" />);
  expect(screen.getByText("Shows")).toBeInTheDocument();
});

it("gives the control column room so a narrow host does not truncate the value", () => {
  render(<MappingTab {...base} />);
  const grid = screen.getByTestId("mapping-grid");
  // A flat 50/50 split collapsed the control column to 94px inside the get-running
  // wizard, where "Not mapped" rendered as "No...".
  expect(grid.className).toContain("minmax");
});
