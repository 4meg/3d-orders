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

  const form = new FormData();
  form.append("username", username);
  form.append("password", password);

  const res = await fetch(`${WASEET_BASE}/login`, {
    method: "POST",
    body: form,
  });

  const json = await res.json();

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
  return res.json();
}

async function waseetPost(path, body = {}) {
  const token = await getToken();
  const url = new URL(`${WASEET_BASE}/${path}`);
  url.searchParams.set("token", token);

  const form = new FormData();
  for (const [k, v] of Object.entries(body)) {
    form.append(k, v);
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    body: form,
  });
  return res.json();
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = { getToken, waseetGet, waseetPost, setCors };
