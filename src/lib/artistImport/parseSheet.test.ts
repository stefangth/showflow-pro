import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseSheet, MAX_IMPORT_ROWS } from "./parseSheet";

const CSV = `name,email,phone,bio
Ada,ada@x.com,+49 151,Soprano
"Doe, Jane",jane@x.com,,Alto`;

describe("parseSheet (csv)", () => {
  it("parses headers and rows, coercing cells to trimmed strings", async () => {
    const { headers, rows } = await parseSheet(CSV, "csv");
    expect(headers).toEqual(["name", "email", "phone", "bio"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "Ada", email: "ada@x.com", phone: "+49 151", bio: "Soprano" });
  });

  it("keeps a quoted comma as a single cell", async () => {
    const { rows } = await parseSheet(CSV, "csv");
    expect(rows[1].name).toBe("Doe, Jane");
    expect(rows[1].phone).toBe("");
  });

  it("rejects a sheet over the row cap", async () => {
    const header = "name,email\n";
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `A${i},a${i}@x.com`).join("\n");
    await expect(parseSheet(header + body, "csv")).rejects.toThrow(/exceeds/i);
  });
});

describe("parseSheet (xlsx)", () => {
  it("parses the first sheet into headers + rows", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["name", "email", "phone", "bio"],
      ["Ada", "ada@x.com", "+49 151", "Soprano"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const { headers, rows } = await parseSheet(buf, "xlsx");
    expect(headers).toEqual(["name", "email", "phone", "bio"]);
    expect(rows[0]).toEqual({ name: "Ada", email: "ada@x.com", phone: "+49 151", bio: "Soprano" });
  });
});
