import type { MenuItem } from "./types";

const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  ارز: ["رز"],
  رز: ["ارز"],
};
const DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";

export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[\p{M}\u0640]/gu, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىيئ]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩۰-۹]/g, (digit) => String(DIGITS.indexOf(digit) % 10))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function productSearchText(item: MenuItem): string {
  return normalizeSearchText([
    item.name, item.nameEn, item.description, item.descriptionEn, item.supplier, item.searchKeywords,
  ].join(" "));
}

export function productSearchTerms(query: string): string[][] {
  const terms = normalizeSearchText(query);
  if (!terms) return [];
  return terms.split(" ").map((term) => {
    const bare = term.startsWith("ال") ? term.slice(2) : term;
    const synonyms = Object.hasOwn(SYNONYMS, bare) ? SYNONYMS[bare] : [];
    return synonyms.length ? [term, bare, ...synonyms] : [term];
  });
}

export function matchesProductSearch(text: string, terms: string[][]): boolean {
  return terms.every((alternatives) => alternatives.some((term) => text.includes(term)));
}
