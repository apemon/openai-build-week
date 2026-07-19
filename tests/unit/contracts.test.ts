import { describe, expect, it } from "vitest";
import { emptySpecification } from "@/domain/initial-state";
import { specificationSchema } from "@/domain/schemas";

describe("frozen contracts", () => {
  it("accepts the minimal valid empty Specification", () => {
    expect(specificationSchema.safeParse(emptySpecification).success).toBe(true);
  });

  it("rejects malformed Specification data", () => {
    expect(specificationSchema.safeParse({ ...emptySpecification, readiness: { status: "almost" } }).success).toBe(false);
  });
});
