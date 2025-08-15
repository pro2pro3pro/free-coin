export const HOURLY_MULTIPLIER = {
  "00": 1.120, "01": 1.110, "02": 1.100, "03": 1.090,
  "04": 1.080, "05": 1.070, "06": 1.060, "07": 1.050,
  "08": 1.040, "09": 1.030, "10": 1.020, "11": 1.010,
  "12": 1.000, "13": 0.995, "14": 0.990, "15": 0.985,
  "16": 0.980, "17": 0.975, "18": 0.970, "19": 0.965,
  "20": 0.960, "21": 0.955, "22": 0.950, "23": 0.945
};

export function getCurrentMultiplier(date = new Date()) {
  const hour = String(date.getHours()).padStart(2, "0");
  return HOURLY_MULTIPLIER[hour] ?? 1.0;
}

export function renderMultiplierTable() {
  return Object.entries(HOURLY_MULTIPLIER).map(([h,v]) => `${h}:00 → x${v.toFixed(3)}`).join("\\n");
}