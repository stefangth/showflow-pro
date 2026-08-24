import { it, expect } from "vitest";
import { stepHeadingKeys } from "./stepHeading";

it("titles connect for the source the org actually picked", () => {
  expect(stepHeadingKeys("connect", "airtable").headingKey).toBe("body.connect.heading");
  expect(stepHeadingKeys("connect", "sheet").headingKey).toBe("body.connect.sheet.heading");
});

it("does not call the step Connect Airtable before a source is chosen", () => {
  // The Airtable-flavoured default over a body that said "By hand needs no connection"
  // was the contradiction this exists to remove.
  expect(stepHeadingKeys("connect", null).headingKey).toBe("body.connect.none.heading");
  expect(stepHeadingKeys("connect", null).subKey).toBe("body.connect.none.sub");
});

it("uses the sheet copy for every source-aware step on a sheet org", () => {
  for (const key of ["connect", "map", "cities"] as const) {
    expect(stepHeadingKeys(key, "sheet").headingKey).toBe(`body.${key}.sheet.heading`);
  }
});

it("leaves every other step on its plain keys", () => {
  for (const source of ["airtable", "sheet", "manual", null] as const) {
    expect(stepHeadingKeys("letterhead", source)).toEqual({
      headingKey: "body.letterhead.heading",
      subKey: "body.letterhead.sub",
      pointsKey: "guide.letterhead.points",
    });
  }
});

it("only promises Airtable city inheritance to an Airtable org", () => {
  expect(stepHeadingKeys("cities", "airtable").pointsKey).toBe("guide.cities.pointsAirtable");
  for (const source of ["sheet", "manual", null] as const) {
    expect(stepHeadingKeys("cities", source).pointsKey).toBe("guide.cities.points");
  }
});
