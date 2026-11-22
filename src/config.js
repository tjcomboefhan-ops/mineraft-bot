require("dotenv").config();
const e = process.env;
module.exports = {
  host: e.MC_HOST || "127.0.0.1",
  port: parseInt(e.MC_PORT || "25565", 10),
  mode: (e.MODE || "auto").toLowerCase(),
  botName: e.BOT_NAME || "TJ_AI",
  msAccount: e.MS_ACCOUNT || undefined,
  clientVersion: e.CLIENT_VERSION || "1.21.4",
  viaPort: parseInt(e.VIAPROXY_PORT || "25570", 10),
  apiKey: e.OPENROUTER_API_KEY || "",
  model: e.OPENROUTER_MODEL || "openrouter/auto",
  dashPort: parseInt(e.DASH_PORT || "3000", 10),
  dashPassword: e.DASH_PASSWORD || "",
  dashHost: e.DASH_HOST || "0.0.0.0",
  adminUser: e.ADMIN_USER || "admin",
  trustProxy: e.TRUST_PROXY ? (/^\d+$/.test(e.TRUST_PROXY) ? parseInt(e.TRUST_PROXY, 10) : (e.TRUST_PROXY === "true" ? true : e.TRUST_PROXY)) : false,
  allowIps: (e.ALLOW_IPS || "").split(",").map((x) => x.trim()).filter(Boolean),
  unlockAll: (e.UNLOCK_ALL || "false") === "true",
};
