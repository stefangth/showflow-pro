/* Stable 6-colour avatar palette — deterministic from any string seed */
const PALETTE = [
  { bg: "#EDE9FE", text: "#4738B0" }, // violet
  { bg: "#FFEDD5", text: "#C2410C" }, // amber-orange
  { bg: "#CFFAFE", text: "#0E7490" }, // cyan
  { bg: "#D1FAE5", text: "#065F46" }, // green
  { bg: "#FEF9C3", text: "#92400E" }, // yellow
  { bg: "#FCE7F3", text: "#9D174D" }, // pink
];

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function getAvatarTone(seed: string): { bg: string; text: string } {
  return PALETTE[hashSeed(seed) % PALETTE.length];
}
