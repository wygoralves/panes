import { describe, expect, it } from "vitest";
import { filterDropdownOptions } from "./Dropdown";

const options = [
  { value: "a", label: "panes" },
  { value: "b", label: "Report Generator" },
];
const groups = [{ label: "More", options: [{ value: "c", label: "gestur" }] }];

describe("filterDropdownOptions", () => {
  it("returns nothing for a blank query so the full menu renders", () => {
    expect(filterDropdownOptions(options, groups, "  ")).toEqual([]);
  });

  it("matches labels case-insensitively across flat and grouped options", () => {
    expect(filterDropdownOptions(options, groups, "GE").map((o) => o.value)).toEqual(["b", "c"]);
  });
});
