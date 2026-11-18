import { describe, expect, it } from "vitest";
import { fitAnswerContexts } from "./answer-context-budget";
import { HybridSearchItem } from "../search/hybrid-search.service";

const passage = (id: string, content: string): HybridSearchItem => ({
  documentId: "doc",
  chunkId: id,
  title: "规则",
  content,
  category: null,
  team: null,
  tags: [],
  score: 1,
  keywordScore: 1,
  semanticScore: null,
  sources: ["keyword"],
  rerankScore: 1,
});

describe("answer context budget", () => {
  it("deduplicates identical passages, skips metadata, preserves full bodies and source order", () => {
    const first = passage("a", "完整条件");
    const second = passage("b", "另一个条件");
    const input = [
      passage("empty", ""),
      first,
      first,
      passage("other-id", "完整条件"),
      second,
    ];
    const before = structuredClone(input);
    expect(fitAnswerContexts(input, 5)).toEqual([first, second]);
    expect(input).toEqual(before);
    expect(
      fitAnswerContexts([first, { ...first, documentId: "other-doc" }], 5),
    ).toHaveLength(2);
  });

  it("bounds count and UTF16 characters without truncation, and preserves the existing oversized-first exception", () => {
    const full = passage("full", "😀".repeat(2999));
    const large = passage("large", "条件不能切断");
    const small = passage("small", "好");
    expect(fitAnswerContexts([full, large, small], 5)).toEqual([full, small]);
    const oversized = passage("oversized", "x".repeat(6001));
    expect(fitAnswerContexts([oversized, small], 5)).toEqual([oversized]);
    expect(
      fitAnswerContexts(
        Array.from({ length: 8 }, (_, i) => passage(String(i), String(i))),
        5,
      ),
    ).toHaveLength(5);
    expect(fitAnswerContexts([], 5)).toEqual([]);
    for (const limit of [0, 6, 1.5, NaN])
      expect(() => fitAnswerContexts([], limit)).toThrow();
  });
});
