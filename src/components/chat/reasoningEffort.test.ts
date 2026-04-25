import { describe, expect, it } from "vitest";
import { resolveReasoningEffortForModel } from "./reasoningEffort";

const model = {
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: [
    { reasoningEffort: "medium", description: "Balanced" },
    { reasoningEffort: "high", description: "Deep" },
  ],
};

describe("resolveReasoningEffortForModel", () => {
  it("keeps the selected effort when the model supports it", () => {
    expect(resolveReasoningEffortForModel(model, "high")).toBe("high");
  });

  it("falls back to the model default when the selected effort is unsupported", () => {
    expect(resolveReasoningEffortForModel(model, "xhigh")).toBe("medium");
  });

  it("falls back to the first supported option when the default is unsupported", () => {
    expect(
      resolveReasoningEffortForModel(
        {
          defaultReasoningEffort: "xhigh",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Fast" },
            { reasoningEffort: "medium", description: "Balanced" },
          ],
        },
        "xhigh",
      ),
    ).toBe("low");
  });

  it("omits reasoning effort when the model does not expose supported options", () => {
    expect(
      resolveReasoningEffortForModel(
        {
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [],
        },
        "medium",
      ),
    ).toBeNull();
  });
});
