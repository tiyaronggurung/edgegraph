export type Sport = "NBA" | "NFL" | "NHL" | "MLB" | "Tennis" | "Soccer";

export const SPORTS: { key: Sport; icon: string; label: string }[] = [
  { key: "NBA", icon: "🏀", label: "NBA" },
  { key: "NFL", icon: "🏈", label: "NFL" },
  { key: "NHL", icon: "🏒", label: "NHL" },
  { key: "MLB", icon: "⚾", label: "MLB" },
  { key: "Tennis", icon: "🎾", label: "Tennis" },
  { key: "Soccer", icon: "⚽", label: "Soccer" },
];

export const sportIcon = (s: string) =>
  SPORTS.find((x) => x.key === s)?.icon ?? "🎯";
