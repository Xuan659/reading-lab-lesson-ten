const DEFAULT_STATE = { submissions: {}, drafts: {}, storyOpen: false };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const teacherResponse = await handleTeacherRequest(request, env);
      if (teacherResponse) return teacherResponse;
      if (["/api/stage", "/api/reset"].includes(url.pathname) && !(await isTeacherRequest(request, env))) {
        return Response.json({ error: "Teacher login required" }, { status: 401, headers: { "cache-control": "no-store" } });
      }
      const id = env.CLASSROOM.idFromName("lesson-ten");
      const classroom = env.CLASSROOM.get(id);
      if (url.pathname === "/api/state" && request.method === "GET") {
        const response = await classroom.fetch(request);
        const allState = await response.json();
        if (await isTeacherRequest(request, env)) return Response.json(allState, { headers: { "cache-control": "no-store" } });
        const group = Number(url.searchParams.get("group"));
        const filtered = { storyOpen: !!allState.storyOpen, submissions: {}, drafts: {} };
        if (Number.isInteger(group) && group >= 1 && group <= 7) {
          for (const stage of ["meaning", "story"]) {
            const stateKey = `${group}:${stage}`;
            if (allState.submissions[stateKey]) filtered.submissions[stateKey] = allState.submissions[stateKey];
            if (allState.drafts[stateKey]) filtered.drafts[stateKey] = allState.drafts[stateKey];
          }
        }
        return Response.json(filtered, { headers: { "cache-control": "no-store" } });
      }
      return classroom.fetch(request);
    }
    if (url.pathname === "/" || url.pathname === "/index.html") return env.ASSETS.fetch(new Request(new URL("/index.html", request.url)));
    return env.ASSETS.fetch(request);
  }
};

export class ClassroomRoom {
  constructor(ctx) { this.ctx = ctx; }
  async read() { return (await this.ctx.storage.get("classroom")) || structuredClone(DEFAULT_STATE); }
  async write(state) { await this.ctx.storage.put("classroom", state); }
  async update(mutator) {
    return this.ctx.storage.transaction(async transaction => {
      const state = (await transaction.get("classroom")) || structuredClone(DEFAULT_STATE);
      const result = await mutator(state);
      await transaction.put("classroom", state);
      return result;
    });
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/state") return Response.json(await this.read(), { headers: { "cache-control": "no-store" } });
    if (request.method === "POST" && url.pathname === "/api/draft") {
      const body = await request.json();
      if (!valid(body)) return Response.json({ error: "Invalid draft" }, { status: 400 });
      await this.update(state => { state.drafts[`${body.group}:${body.stage}`] = body.answers; });
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/submit") {
      const body = await request.json();
      if (!valid(body)) return Response.json({ error: "Invalid submission" }, { status: 400 });
      const result = await this.update(state => {
        if (body.stage === "story" && !state.storyOpen) return { locked: true };
        state.submissions[`${body.group}:${body.stage}`] = { answers: body.answers, submittedAt: new Date().toISOString() };
        delete state.drafts[`${body.group}:${body.stage}`];
        return { ok: true };
      });
      if (result.locked) return Response.json({ error: "Stage locked" }, { status: 423 });
      return Response.json(result);
    }
    if (request.method === "POST" && url.pathname === "/api/reset") {
      await this.ctx.storage.put("classroom", structuredClone(DEFAULT_STATE));
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/stage") {
      const body = await request.json();
      if (typeof body.storyOpen !== "boolean") return Response.json({ error: "Invalid stage" }, { status: 400 });
      await this.update(state => { state.storyOpen = body.storyOpen; });
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  }
}

function valid(body) {
  return Number.isInteger(body.group) && body.group >= 1 && body.group <= 7 &&
    ["meaning", "story"].includes(body.stage) && body.answers && typeof body.answers === "object" &&
    Object.values(body.answers).every(value => typeof value === "string" && value.length <= 5000);
}

async function handleTeacherRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/teacher/session" && request.method === "GET") {
    return Response.json({ configured: !!(env.TEACHER_PASSWORD && env.TEACHER_SESSION_SECRET), authenticated: await isTeacherRequest(request, env) }, { headers: { "cache-control": "no-store" } });
  }
  if (url.pathname === "/api/teacher/logout" && request.method === "POST") {
    return Response.json({ ok: true }, { headers: { "set-cookie": "teacher_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0", "cache-control": "no-store" } });
  }
  if (url.pathname === "/api/teacher/login" && request.method === "POST") {
    if (!env.TEACHER_PASSWORD || !env.TEACHER_SESSION_SECRET) {
      return Response.json({ error: "Teacher login is not configured" }, { status: 503, headers: { "cache-control": "no-store" } });
    }
    let body;
    try { body = await request.json(); } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
    if (typeof body.password !== "string" || body.password !== env.TEACHER_PASSWORD) {
      return Response.json({ error: "Incorrect password" }, { status: 401, headers: { "cache-control": "no-store" } });
    }
    const expires = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
    const signature = await signSession(String(expires), env.TEACHER_SESSION_SECRET);
    const token = `${expires}.${signature}`;
    return Response.json({ ok: true }, {
      headers: {
        "set-cookie": `teacher_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${8 * 60 * 60}`,
        "cache-control": "no-store"
      }
    });
  }
  return null;
}

async function isTeacherRequest(request, env) {
  if (!env.TEACHER_SESSION_SECRET) return false;
  const cookie = request.headers.get("cookie") || "";
  const raw = cookie.split(";").map(value => value.trim()).find(value => value.startsWith("teacher_session="))?.slice("teacher_session=".length);
  if (!raw) return false;
  const [expiry, signature, extra] = raw.split(".");
  if (extra || !/^\d+$/.test(expiry) || Number(expiry) <= Math.floor(Date.now() / 1000)) return false;
  return verifySession(expiry, signature, env.TEACHER_SESSION_SECRET);
}

async function importSessionKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signSession(payload, secret) {
  const signature = await crypto.subtle.sign("HMAC", await importSessionKey(secret), new TextEncoder().encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}
async function verifySession(payload, signature, secret) {
  try {
    return await crypto.subtle.verify("HMAC", await importSessionKey(secret), base64UrlToBytes(signature), new TextEncoder().encode(payload));
  } catch { return false; }
}
function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
