// How a stone was named, in words: the confirm screen's "How do you know?"
// chips and the stone page's "How it was named". Pure, so client components
// can use it. Only a label, the tests and someone who knows count as known
// answers when a future model is scored against the household (#4).

export type ConfirmHow = "label" | "tests" | "expert" | "suggestion" | "guess";

/** The chips, in the person's own words. */
export const HOW_CHOICES: Array<{ how: ConfirmHow; label: string }> = [
  { how: "suggestion", label: "I took Jasper’s suggestion" },
  { how: "label", label: "From a label or tag" },
  { how: "tests", label: "The tests settled it" },
  { how: "expert", label: "Someone who knows told me" },
  { how: "guess", label: "My best guess" },
];

/** The same, said about the stone afterwards. */
export const HOW_SUMMARY: Record<ConfirmHow, string> = {
  suggestion: "Jasper’s suggestion, taken as it was",
  label: "From a label or tag",
  tests: "Settled by the kitchen-table tests",
  expert: "Someone who knows said so",
  guess: "A best guess",
};
