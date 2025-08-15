import "dotenv/config";
import express from "express";
import session from "express-session";
import passport from "passport";
import DiscordStrategy from "passport-discord";
import morgan from "morgan";
import { fileURLToPath } from "url";
import path from "path";
import axios from "axios";
import dayjs from "dayjs";
import { db, getUser, setNormalCoin, setVipCoin, getDailyLink, getClaimBySubid, markClaimAwarded, hasAwardedOnIP, countAwardedTodayByPlatform } from "./db.js";
import { computeCoins } from "./coin.js";
import { getClient } from "./bot.js";

const app = express();
app.set("view engine", "ejs");
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.set("views", path.join(__dirname, "views"));
app.use("/public", express.static(path.join(__dirname, "..", "public")));
app.use(express.urlencoded({ extended:true }));
app.use(express.json());
app.use(morgan("tiny"));

const ADMIN_IDS = (process.env.ADMIN_WHITELIST_IDS||"").split(",").map(s=>s.trim()).filter(Boolean);

app.use(session({
  secret: process.env.SESSION_SECRET || "change_me",
  resave:false,
  saveUninitialized:false
}));

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: "/auth/callback",
  scope: ["identify"]
}, (accessToken, refreshToken, profile, done)=> done(null, profile)));
passport.serializeUser((u,done)=>done(null,u));
passport.deserializeUser((o,done)=>done(null,o));
app.use(passport.initialize());
app.use(passport.session());

function isAdmin(req,res,next){
  if (req.user && ADMIN_IDS.includes(req.user.id)) return next();
  return res.status(403).send("Forbidden");
}

app.get("/", (_req,res)=> res.redirect("/admin"));
app.get("/auth/login", passport.authenticate("discord"));
app.get("/auth/callback", passport.authenticate("discord", { failureRedirect:"/" }), (req,res)=> res.redirect("/admin"));
app.post("/auth/logout", (req,res,next)=>{ req.logout(err=> err?next(err):res.redirect("/")); });

app.get("/admin", (req,res)=>{
  if (!req.user) return res.render("login");
  if (!ADMIN_IDS.includes(req.user.id)) return res.status(403).send("Bạn không có quyền vào dashboard");
  res.render("admin", { user:req.user });
});
app.post("/admin/lookup", isAdmin, (req,res)=>{
  const u = getUser(req.body.user_id);
  res.render("user", { target:u });
});
app.post("/admin/set", isAdmin, (req,res)=>{
  const { user_id, normal_coin, vip_coin } = req.body;
  if (normal_coin !== undefined) setNormalCoin(user_id, parseInt(normal_coin||"0",10));
  if (vip_coin !== undefined) setVipCoin(user_id, parseInt(vip_coin||"0",10));
  const u = getUser(user_id);
  res.render("user", { target:u });
});

app.get("/admin/logs", isAdmin, (req,res)=>{
  const q = {
    user_id: (req.query.user_id||"").trim(),
    platform: (req.query.platform||"").trim(),
    status: (req.query.status||"").trim(),
    from: (req.query.from||"").trim(),
    to: (req.query.to||"").trim()
  };
  let sql = "SELECT id, user_id, date, platform, subid, status, coins_awarded, ip, created_at FROM claims WHERE 1=1";
  const args = [];
  if (q.user_id){ sql += " AND user_id = ?"; args.push(q.user_id); }
  if (q.platform){ sql += " AND platform = ?"; args.push(q.platform); }
  if (q.status){ sql += " AND status = ?"; args.push(q.status); }
  if (q.from){ sql += " AND date >= ?"; args.push(q.from); }
  if (q.to){ sql += " AND date <= ?"; args.push(q.to); }
  sql += " ORDER BY id DESC LIMIT 500";
  const rows = db.prepare(sql).all(...args);
  res.render("admin_logs", { rows, q });
});

/** Claim endpoint */
app.get("/claim", async (req,res)=>{
  const { platform, subid, uid } = req.query;
  if (!platform || !subid || !uid) return res.status(400).send("Thiếu tham số.");

  const date = dayjs().format("YYYY-MM-DD");
  const entry = getDailyLink(String(uid), date, String(platform));
  const claim = getClaimBySubid(String(subid));
  if (!entry || !claim) return res.status(400).send("Link không hợp lệ / đã hết hạn.");

  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  if (hasAwardedOnIP(ip, date, String(platform))) {
    return res.status(429).send("IP này đã claim hôm nay cho nền tảng này.");
  }

  const counts = countAwardedTodayByPlatform(String(uid), date);
  const limits = { yeumoney:2, link4m:1, bbmkts:1 };
  if ((counts[platform]||0) >= (limits[platform]||0)) {
    return res.status(429).send("Hôm nay bạn đã hết lượt cho nền tảng này.");
  }

  if (claim.status !== "awarded") {
    const { total } = computeCoins(String(platform), new Date());
    setNormalCoin(String(uid), (getUser(String(uid)).normal_coin || 0) + total);
    markClaimAwarded(claim.id, total, ip);

    if (process.env.DISCORD_WEBHOOK_URL) {
      try { await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: `✅ <@${uid}> vừa nhận **${total}** coin từ **${platform}** (IP: ${ip})` }); } catch {}
    }
    try {
      const client = getClient();
      const user = await client.users.fetch(String(uid));
      await user.send(`Bạn đã nhận **${total}** coin từ **${platform}**. GG! 🎉`);
    } catch {}
  }

  res.sendFile(path.join(__dirname, "views", "claimed.html"));
});

export function startWeb(){
  const port = process.env.PORT || 3000;
  app.listen(port, ()=> console.log("Web listening on " + port));
}