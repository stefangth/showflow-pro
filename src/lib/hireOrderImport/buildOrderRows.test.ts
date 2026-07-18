import { describe, it, expect } from "vitest";
import { buildOrderRows, parseImportDate, parseImportMoney } from "./buildOrderRows";
import type { OrderColumnMapping } from "./guessOrderMapping";
import type { ImportCatalogArtist, ImportCatalogDate } from "./buildOrderRows";

const FULL_MAPPING: OrderColumnMapping = {
  artist_name: "Artist",
  recipient_email: "Email",
  date: "Date",
  venue: "Venue",
  city: "City",
  fee: "Fee",
};

const ARTIST_A: ImportCatalogArtist = { id: "artist-1", name: "Ada Lovelace", email: "ada@x.com" };
const ARTIST_B: ImportCatalogArtist = { id: "artist-2", name: "Grace Hopper", email: "grace@x.com" };

const DATE_A: ImportCatalogDate = { id: "date-1", date: "2026-06-15", venue: "Opera House", city: "Berlin" };
const DATE_B: ImportCatalogDate = { id: "date-2", date: "2026-06-15", venue: "Concert Hall", city: "Munich" };

const catalog = { artists: [ARTIST_A, ARTIST_B], dates: [DATE_A, DATE_B] };

const row = (record: Record<string, string>, rowIndex = 2) => ({ rowIndex, record });

describe("parseImportDate", () => {
  it("parses dd.mm.yyyy", () => {
    expect(parseImportDate("15.06.2026")).toBe("2026-06-15");
  });

  it("parses yyyy-mm-dd", () => {
    expect(parseImportDate("2026-06-15")).toBe("2026-06-15");
  });

  it("parses mm/dd/yyyy", () => {
    expect(parseImportDate("06/15/2026")).toBe("2026-06-15");
  });

  it("pads single-digit day/month", () => {
    expect(parseImportDate("5.6.2026")).toBe("2026-06-05");
  });

  it("returns null for unparseable text", () => {
    expect(parseImportDate("not a date")).toBeNull();
  });

  it("returns null for an out-of-range month", () => {
    expect(parseImportDate("15.13.2026")).toBeNull();
  });
});

describe("parseImportMoney", () => {
  it("parses German-style '4.500,00' to '4500.00'", () => {
    expect(parseImportMoney("4.500,00")).toBe("4500.00");
  });

  it("parses US-style '4,500.00' to '4500.00'", () => {
    expect(parseImportMoney("4,500.00")).toBe("4500.00");
  });

  it("parses a plain integer '4500' to '4500.00'", () => {
    expect(parseImportMoney("4500")).toBe("4500.00");
  });

  it("strips a currency symbol and spaces", () => {
    expect(parseImportMoney("€ 4,500.00")).toBe("4500.00");
  });

  it("returns null for unparseable text", () => {
    expect(parseImportMoney("n/a")).toBeNull();
  });
});

describe("buildOrderRows", () => {
  it("matches artist by lowercased email first, even when the name column disagrees", () => {
    const [r] = buildOrderRows(
      [
        row({
          Artist: "someone else",
          Email: "ADA@X.COM",
          Date: "2026-06-15",
          Venue: "Opera House",
          City: "Berlin",
          Fee: "500",
        }),
      ],
      FULL_MAPPING,
      catalog
    );
    expect(r.matchedArtistId).toBe("artist-1");
  });

  it("matches artist by exact lowercased name when there is no email match", () => {
    const [r] = buildOrderRows(
      [
        row({
          Artist: "grace hopper",
          Email: "",
          Date: "2026-06-15",
          Venue: "Concert Hall",
          City: "Munich",
          Fee: "500",
        }),
      ],
      FULL_MAPPING,
      catalog
    );
    expect(r.matchedArtistId).toBe("artist-2");
  });

  it("flags an unmatched artist as unknown_artist", () => {
    const [r] = buildOrderRows(
      [
        row({
          Artist: "Nobody",
          Email: "nobody@x.com",
          Date: "2026-06-15",
          Venue: "Opera House",
          City: "Berlin",
          Fee: "500",
        }),
      ],
      FULL_MAPPING,
      catalog
    );
    expect(r.status).toBe("attention");
    expect(r.issues).toContain("unknown_artist");
    expect(r.matchedArtistId).toBeUndefined();
  });

  it("matches the show date by ISO date + venue when venue/city are mapped and disambiguate", () => {
    const [r] = buildOrderRows(
      [
        row({
          Artist: "Ada Lovelace",
          Email: "ada@x.com",
          Date: "15.06.2026",
          Venue: "Opera House",
          City: "",
          Fee: "500",
        }),
      ],
      FULL_MAPPING,
      catalog // DATE_A and DATE_B both fall on 2026-06-15
    );
    expect(r.sheet.date).toBe("2026-06-15");
    expect(r.matchedShowDateId).toBe("date-1");
    expect(r.issues).not.toContain("ambiguous_date");
  });

  it("matches the show date by ISO date + city when venue is blank", () => {
    const [r] = buildOrderRows(
      [
        row({
          Artist: "Grace Hopper",
          Email: "grace@x.com",
          Date: "2026-06-15",
          Venue: "",
          City: "Munich",
          Fee: "500",
        }),
      ],
      FULL_MAPPING,
      catalog
    );
    expect(r.matchedShowDateId).toBe("date-2");
  });

  it("matches date-only when exactly one show_date exists that day", () => {
    const singleDateCatalog = { artists: catalog.artists, dates: [DATE_A] };
    const [r] = buildOrderRows(
      [
        row({
          Artist: "Ada Lovelace",
          Email: "ada@x.com",
          Date: "2026-06-15",
          Venue: "",
          City: "",
          Fee: "500",
        }),
      ],
      FULL_MAPPING,
      singleDateCatalog
    );
    expect(r.matchedShowDateId).toBe("date-1");
    expect(r.issues).not.toContain("ambiguous_date");
  });

  it("flags ambiguous_date when multiple show_dates share the day and venue/city do not narrow it", () => {
    const [r] = buildOrderRows(
      [
        row({
          Artist: "Ada Lovelace",
          Email: "ada@x.com",
          Date: "2026-06-15",
          Venue: "",
          City: "",
          Fee: "500",
        }),
      ],
      FULL_MAPPING,
      catalog // DATE_A and DATE_B both 2026-06-15, no venue/city given to disambiguate
    );
    expect(r.status).toBe("attention");
    expect(r.issues).toContain("ambiguous_date");
    expect(r.matchedShowDateId).toBeUndefined();
  });

  it("flags unparseable_date and leaves sheet.date unset", () => {
    const [r] = buildOrderRows(
      [
        row({
          Artist: "Ada Lovelace",
          Email: "ada@x.com",
          Date: "not a date",
          Venue: "",
          City: "",
          Fee: "500",
        }),
      ],
      FULL_MAPPING,
      catalog
    );
    expect(r.status).toBe("attention");
    expect(r.issues).toContain("unparseable_date");
    expect(r.sheet.date).toBeUndefined();
    expect(r.matchedShowDateId).toBeUndefined();
  });

  it("flags missing_fee but the row is still importable as a draft", () => {
    const [r] = buildOrderRows(
      [
        row({
          Artist: "Ada Lovelace",
          Email: "ada@x.com",
          Date: "2026-06-15",
          Venue: "Opera House",
          City: "Berlin",
          Fee: "",
        }),
      ],
      FULL_MAPPING,
      catalog
    );
    expect(r.status).toBe("attention");
    expect(r.issues).toContain("missing_fee");
    expect(r.sheet.fee).toBeUndefined();
    // still resolvable/importable: artist and date are matched despite the missing fee
    expect(r.matchedArtistId).toBe("artist-1");
    expect(r.matchedShowDateId).toBe("date-1");
  });

  it("does not flag missing_fee when the fee column itself is not mapped", () => {
    const mappingWithoutFee: OrderColumnMapping = { ...FULL_MAPPING };
    delete mappingWithoutFee.fee;
    const [r] = buildOrderRows(
      [
        row({
          Artist: "Ada Lovelace",
          Email: "ada@x.com",
          Date: "2026-06-15",
          Venue: "Opera House",
          City: "Berlin",
          Fee: "500", // present in the raw sheet, but the column isn't mapped, so it's ignored
        }),
      ],
      mappingWithoutFee,
      catalog
    );
    expect(r.issues).not.toContain("missing_fee");
    expect(r.sheet.fee).toBeUndefined();
    // otherwise clean -> ready, not flagged into attention just because there's no fee column
    expect(r.status).toBe("ready");
  });

  it("flags missing_date when the date column is mapped but the cell is blank", () => {
    const [r] = buildOrderRows(
      [
        row({
          Artist: "Ada Lovelace",
          Email: "ada@x.com",
          Date: "",
          Venue: "Opera House",
          City: "Berlin",
          Fee: "500",
        }),
      ],
      FULL_MAPPING,
      catalog
    );
    expect(r.status).toBe("attention");
    expect(r.issues).toContain("missing_date");
    expect(r.sheet.date).toBeUndefined();
    expect(r.matchedShowDateId).toBeUndefined();
    // still resolvable/importable: artist is matched despite the missing date
    expect(r.matchedArtistId).toBe("artist-1");
  });

  it("does not flag missing_date when the date column itself is not mapped", () => {
    const mappingWithoutDate: OrderColumnMapping = { ...FULL_MAPPING };
    delete mappingWithoutDate.date;
    const [r] = buildOrderRows(
      [
        row({
          Artist: "Ada Lovelace",
          Email: "ada@x.com",
          Date: "2026-06-15", // present in the raw sheet, but the column isn't mapped, so it's ignored
          Venue: "Opera House",
          City: "Berlin",
          Fee: "500",
        }),
      ],
      mappingWithoutDate,
      catalog
    );
    expect(r.issues).not.toContain("missing_date");
    expect(r.sheet.date).toBeUndefined();
    expect(r.matchedShowDateId).toBeUndefined();
  });

  it("narrows by venue when only the venue column is mapped (city not mapped at all)", () => {
    const venueOnlyMapping: OrderColumnMapping = { ...FULL_MAPPING };
    delete venueOnlyMapping.city;
    const [r] = buildOrderRows(
      [
        row({
          Artist: "Ada Lovelace",
          Email: "ada@x.com",
          Date: "2026-06-15",
          Venue: "Opera House",
          Fee: "500",
        }),
      ],
      venueOnlyMapping,
      catalog // DATE_A (Opera House/Berlin) and DATE_B (Concert Hall/Munich) both fall on 2026-06-15
    );
    expect(r.matchedShowDateId).toBe("date-1");
    expect(r.issues).not.toContain("ambiguous_date");
  });

  it("flags venue_city_mismatch when venue/city are given but wrong on an otherwise-unambiguous day", () => {
    const singleDateCatalog = { artists: catalog.artists, dates: [DATE_A] }; // only Opera House/Berlin on 2026-06-15
    const [r] = buildOrderRows(
      [
        row({
          Artist: "Ada Lovelace",
          Email: "ada@x.com",
          Date: "2026-06-15",
          Venue: "Wrong Venue",
          City: "Wrong City",
          Fee: "500",
        }),
      ],
      FULL_MAPPING,
      singleDateCatalog
    );
    expect(r.status).toBe("attention");
    expect(r.issues).toContain("venue_city_mismatch");
    // still keeps the date link so the producer reviews rather than loses it
    expect(r.matchedShowDateId).toBe("date-1");
  });

  it("does not flag venue_city_mismatch when venue/city match the resolved date", () => {
    const singleDateCatalog = { artists: catalog.artists, dates: [DATE_A] };
    const [r] = buildOrderRows(
      [
        row({
          Artist: "Ada Lovelace",
          Email: "ada@x.com",
          Date: "2026-06-15",
          Venue: "Opera House",
          City: "Berlin",
          Fee: "500",
        }),
      ],
      FULL_MAPPING,
      singleDateCatalog
    );
    expect(r.issues).not.toContain("venue_city_mismatch");
    expect(r.matchedShowDateId).toBe("date-1");
  });

  it("does not flag venue_city_mismatch when no venue/city column is mapped", () => {
    const mappingWithoutVenueCity: OrderColumnMapping = { ...FULL_MAPPING };
    delete mappingWithoutVenueCity.venue;
    delete mappingWithoutVenueCity.city;
    const singleDateCatalog = { artists: catalog.artists, dates: [DATE_A] };
    const [r] = buildOrderRows(
      [
        row({
          Artist: "Ada Lovelace",
          Email: "ada@x.com",
          Date: "2026-06-15",
          Venue: "Some Other Venue", // present in the sheet but the column isn't mapped, so it's ignored
          City: "Some Other City",
          Fee: "500",
        }),
      ],
      mappingWithoutVenueCity,
      singleDateCatalog
    );
    expect(r.issues).not.toContain("venue_city_mismatch");
    expect(r.matchedShowDateId).toBe("date-1");
  });

  it("does not flag venue_city_mismatch when the day is ambiguous (already flagged ambiguous_date)", () => {
    const [r] = buildOrderRows(
      [
        row({
          Artist: "Ada Lovelace",
          Email: "ada@x.com",
          Date: "2026-06-15",
          Venue: "Wrong Venue",
          City: "Wrong City",
          Fee: "500",
        }),
      ],
      FULL_MAPPING,
      catalog // DATE_A and DATE_B both 2026-06-15; neither matches "Wrong Venue"/"Wrong City"
    );
    expect(r.issues).toContain("ambiguous_date");
    expect(r.issues).not.toContain("venue_city_mismatch");
    expect(r.matchedShowDateId).toBeUndefined();
  });

  it("marks a fully resolvable row as ready with no issues", () => {
    const [r] = buildOrderRows(
      [
        row({
          Artist: "Ada Lovelace",
          Email: "ada@x.com",
          Date: "2026-06-15",
          Venue: "Opera House",
          City: "Berlin",
          Fee: "4.500,00",
        }),
      ],
      FULL_MAPPING,
      catalog
    );
    expect(r.status).toBe("ready");
    expect(r.issues).toEqual([]);
    expect(r.matchedArtistId).toBe("artist-1");
    expect(r.matchedShowDateId).toBe("date-1");
    expect(r.sheet.fee).toBe("4500.00");
    expect(r.sheet.venue).toBe("Opera House");
    expect(r.sheet.city).toBe("Berlin");
  });

  it("skips a completely empty row", () => {
    const [r] = buildOrderRows(
      [row({ Artist: "", Email: "", Date: "", Venue: "", City: "", Fee: "" })],
      FULL_MAPPING,
      catalog
    );
    expect(r.status).toBe("skipped");
    expect(r.issues).toEqual([]);
    expect(r.matchedArtistId).toBeUndefined();
    expect(r.matchedShowDateId).toBeUndefined();
  });

  it("treats a row of only whitespace as completely empty too", () => {
    const [r] = buildOrderRows(
      [row({ Artist: "  ", Email: "", Date: " ", Venue: "", City: "", Fee: "" })],
      FULL_MAPPING,
      catalog
    );
    expect(r.status).toBe("skipped");
  });

  it("preserves rowIndex through resolution", () => {
    const rows = buildOrderRows(
      [
        row(
          {
            Artist: "Ada Lovelace",
            Email: "ada@x.com",
            Date: "2026-06-15",
            Venue: "Opera House",
            City: "Berlin",
            Fee: "500",
          },
          7
        ),
      ],
      FULL_MAPPING,
      catalog
    );
    expect(rows[0].rowIndex).toBe(7);
  });
});
