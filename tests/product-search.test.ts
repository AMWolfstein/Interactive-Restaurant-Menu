import { describe, expect, it } from "vitest";
import { matchesProductSearch, productSearchTerms, productSearchText } from "../lib/product-search";
import type { MenuItem } from "../lib/types";

const rice: MenuItem = {
  id: "rice", categoryId: "staples", name: "رُزّ مِصــري ٢ كجم",
  nameEn: "Egyptian rice", description: "حبّة طويلة",
  supplier: "شركة الإخلاص", searchKeywords: "تموين بلدي، حبوب",
  price: 100, available: true, isNew: false, spicy: 0,
};
const text = productSearchText(rice);
const matches = (query: string) => matchesProductSearch(text, productSearchTerms(query));

describe("catalog search", () => {
  it.each([
    "أرز", "الأَرُزّ", "ارز", "رز", "مصري 2", "مصري ۲", "شركة الاخلاص", "حبه طويلة",
  ])("matches Arabic variation in %s", (query) => expect(matches(query)).toBe(true));

  it("finds custom keywords and requires every search term across the indexed fields", () => {
    expect(matches("تموين بلدي إخلاص")).toBe(true);
    expect(matches("EGYPTIAN حبوب")).toBe(true);
    expect(matches("أرز بسمتي")).toBe(false);
    expect(productSearchTerms(" ـ … ")).toEqual([]);
  });
});
