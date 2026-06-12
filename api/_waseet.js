// ═══════════════════════════════════════════════════════════
//  دوال مساعدة مشتركة للتعامل مع API الوسيط (CommonJS)
// ═══════════════════════════════════════════════════════════

const WASEET_BASE = "https://api.alwaseet-iq.net/v1/merchant";

let cachedToken = null;
let tokenTime = 0;
const TOKEN_TTL = 1000 * 60 * 30; // 30 دقيقة

async function getToken() {
  if (cachedToken && Date.now() - tokenTime < TOKEN_TTL) {
    return cachedToken;
  }

  const username = process.env.WASEET_USERNAME;
  const password = process.env.WASEET_PASSWORD;

  if (!username || !password) {
    throw new Error("WASEET_USERNAME أو WASEET_PASSWORD غير موجودة بالإعدادات");
  }

  // نستخدم URLSearchParams بدل FormData (أضمن على Vercel)
  const body = new URLSearchParams();
  body.append("username", username);
  body.append("password", password);

  const res = await fetch(`${WASEET_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("رد غير متوقع من الوسيط عند الدخول: " + text.slice(0, 100));
  }

  if (!json.status || !json.data?.token) {
    throw new Error("فشل تسجيل الدخول للوسيط: " + (json.msg || "خطأ غير معروف"));
  }

  cachedToken = json.data.token;
  tokenTime = Date.now();
  return cachedToken;
}

async function waseetGet(path, params = {}) {
  const token = await getToken();
  const url = new URL(`${WASEET_BASE}/${path}`);
  url.searchParams.set("token", token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("رد غير متوقع من الوسيط: " + text.slice(0, 100));
  }
}

async function waseetPost(path, body = {}) {
  const token = await getToken();
  const url = new URL(`${WASEET_BASE}/${path}`);
  url.searchParams.set("token", token);

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    params.append(k, v);
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("رد غير متوقع من الوسيط: " + text.slice(0, 100));
  }
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = { getToken, waseetGet, waseetPost, setCors };