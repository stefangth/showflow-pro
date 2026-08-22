import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TableCell, TableHead } from "./table";

describe("Table primitives", () => {
  describe("TableCell with numeric prop", () => {
    it("right-aligns and monospaces numeric cells", () => {
      render(
        <table>
          <tbody>
            <tr>
              <TableCell numeric>42</TableCell>
            </tr>
          </tbody>
        </table>,
      );
      const cell = screen.getByText("42");
      expect(cell.className).toContain("text-right");
      expect(cell.className).toContain("font-mono");
      expect(cell.className).toContain("tabular-nums");
    });

    it("does not add numeric classes when numeric is false", () => {
      render(
        <table>
          <tbody>
            <tr>
              <TableCell numeric={false}>text</TableCell>
            </tr>
          </tbody>
        </table>,
      );
      const cell = screen.getByText("text");
      expect(cell.className).not.toContain("font-mono");
    });

    it("does not add numeric classes when numeric is undefined", () => {
      render(
        <table>
          <tbody>
            <tr>
              <TableCell>text</TableCell>
            </tr>
          </tbody>
        </table>,
      );
      const cell = screen.getByText("text");
      expect(cell.className).not.toContain("font-mono");
    });
  });

  describe("TableHead with numeric prop", () => {
    it("right-aligns numeric header cells", () => {
      render(
        <table>
          <thead>
            <tr>
              <TableHead numeric>Amount</TableHead>
            </tr>
          </thead>
        </table>,
      );
      const cell = screen.getByText("Amount");
      expect(cell.className).toContain("text-right");
    });

    it("left-aligns when numeric is false", () => {
      render(
        <table>
          <thead>
            <tr>
              <TableHead numeric={false}>Name</TableHead>
            </tr>
          </thead>
        </table>,
      );
      const cell = screen.getByText("Name");
      expect(cell.className).toContain("text-left");
      expect(cell.className).not.toContain("text-right");
    });
  });

  describe("density compliance", () => {
    it("TableCell uses text-control size", () => {
      render(
        <table>
          <tbody>
            <tr>
              <TableCell>content</TableCell>
            </tr>
          </tbody>
        </table>,
      );
      const cell = screen.getByText("content");
      expect(cell.className).toContain("text-control");
    });

    it("TableHead uses text-eyebrow size", () => {
      render(
        <table>
          <thead>
            <tr>
              <TableHead>Header</TableHead>
            </tr>
          </thead>
        </table>,
      );
      const cell = screen.getByText("Header");
      expect(cell.className).toContain("text-eyebrow");
    });
  });
});
