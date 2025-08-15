import { getCurrentMultiplier } from "./multiplier.js";

export const BASE_COINS = {
  yeumoney: 145,
  link4m: 140,
  bbmkts: 140
};

export function computeCoins(platform, at = new Date()) {
  const base = BASE_COINS[platform] ?? 0;
  const m = getCurrentMultiplier(at);
  return { base, multiplier: m, total: Math.floor(base * m) };
}