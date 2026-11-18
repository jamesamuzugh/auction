// Safe to import from client components: plain data only.

export const GHANA_REGIONS = [
  "Greater Accra",
  "Ashanti",
  "Central",
  "Eastern",
  "Western",
  "Western North",
  "Volta",
  "Oti",
  "Northern",
  "Savannah",
  "North East",
  "Upper East",
  "Upper West",
  "Bono",
  "Bono East",
  "Ahafo",
];

export type ItemSize = "small" | "medium" | "large" | "xl";

export const SIZES: { value: ItemSize; label: string; hint: string }[] = [
  { value: "small", label: "Small", hint: "Fits in a backpack: phone, book, shoes, small electronics" },
  { value: "medium", label: "Medium", hint: "Up to a big box one person carries easily: laptop, microwave, mixer" },
  { value: "large", label: "Large", hint: "Bulky but one or two people can carry it: TV, bicycle, office chair" },
  { value: "xl", label: "Extra large", hint: "Needs a van: sofa, bed, fridge, washing machine" },
];

export type DistanceBand = "same_city" | "same_region" | "other_region";

export const BANDS: { value: DistanceBand; label: string }[] = [
  { value: "same_city", label: "Same city or town" },
  { value: "same_region", label: "Same region" },
  { value: "other_region", label: "Another region" },
];

export const sizeLabel = (s: string) => SIZES.find((x) => x.value === s)?.label ?? s;
export const bandLabel = (b: string) => BANDS.find((x) => x.value === b)?.label ?? b;
