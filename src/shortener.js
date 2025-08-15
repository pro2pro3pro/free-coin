export async function shorten(platform, longUrl) {
  const map = {
    yeumoney: process.env.SHORTENER_YEUMONEY_API,
    link4m: process.env.SHORTENER_LINK4M_API,
    bbmkts: process.env.SHORTENER_BBMKTS_API
  };
  const api = map[platform];
  if (!api) throw new Error("Shortener API not configured for " + platform);
  const prefix = api.endsWith("=") ? api : (api.includes("=") ? api : (api + "?url="));
  return prefix + encodeURIComponent(longUrl);
}