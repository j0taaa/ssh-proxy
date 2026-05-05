import { describe, expect, it } from "vitest";
import { describeScaffoldPackage, scaffoldStatus } from "./index";

describe("protocol scaffold", () => {
  it("exports a real placeholder value for workspace consumers", () => {
    expect(describeScaffoldPackage()).toBe(scaffoldStatus);
    expect(scaffoldStatus).toContain("protocol package placeholder");
  });
});
