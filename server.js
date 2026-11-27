"use strict";

/* ==================== SERVER E DATABASE CONDIVISO ==================== */

// Espone il sito e le API attraverso un unico server HTTP.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

// Memorizza utenti, segnalazioni, match e messaggi in un database persistente.
const db = new DatabaseSync(path.join(__dirname, "museo.sqlite"));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);`);
const PORT = Number(process.env.PORT || 3000);
const kinds = new Set([
  "mcp_reports",
  "mcp_matches",
  "mcp_messages",
  "mcp_notifications",
]);
const statuses = new Set(["open", "checking", "resolved", "archived"]);
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
const get = (kind, id) => {
  const row = db
    .prepare("SELECT json FROM records WHERE kind=? AND id=?")
    .get(kind, id);
  return row ? JSON.parse(row.json) : null;
};
const all = (kind) =>
  db
    .prepare("SELECT json FROM records WHERE kind=?")
    .all(kind)
    .map((x) => JSON.parse(x.json));
const put = (kind, obj) =>
  db
    .prepare(
      "INSERT INTO records(kind,id,json) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json",
    )
    .run(kind, obj.id, JSON.stringify(obj));
const remove = (kind, id) =>
  db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
const account = (id) =>
  db.prepare("SELECT id,name,email,role FROM accounts WHERE id=?").get(id);
const publicUser = (u) =>
  u && { id: u.id, name: u.name, email: u.email, role: u.role };
const passwordHash = (password, salt) =>
  crypto.scryptSync(password, salt, 64).toString("hex");
const safe = (v, max = 800) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const participant = (match, user) => {
  const a = get("mcp_reports", match.lostReportId),
    b = get("mcp_reports", match.foundReportId);
  return !!(a && b && (a.userId === user.id || b.userId === user.id));
};
const notify = (userId, text) =>
  put("mcp_notifications", {
    id: uid(),
    userId,
    text,
    createdAt: now(),
    read: false,
  });
const history = (report, text) => {
  report.history = Array.isArray(report.history) ? report.history : [];
  report.history.push({ id: uid(), date: now(), text });
  put("mcp_reports", report);
};

/* ==================== AUTENTICAZIONE SERVER ==================== */

// Conserva la sessione in un cookie HttpOnly non accessibile da JavaScript.
function currentUser(req) {
  const token = /(?:^|;\s*)mcp_token=([^;]+)/.exec(
    req.headers.cookie || "",
  )?.[1];
  if (!token) return null;
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const row = db
    .prepare("SELECT user_id FROM sessions WHERE token_hash=? AND expires>?")
    .get(hash, Date.now());
  return row ? account(row.user_id) : null;
}
function setCookie(res, token, age) {
  res.setHeader(
    "Set-Cookie",
    `mcp_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
}
function loginSession(res, user) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    crypto.createHash("sha256").update(token).digest("hex"),
    user.id,
    Date.now() + 604800000,
  );
  setCookie(res, token, 604800);
}
function requireUser(user) {
  if (!user) fail(401, "Effettua l'accesso.");
}

/* ==================== AUTORIZZAZIONI SUL SERVER ==================== */

// Applica controlli a ogni scrittura, senza fidarsi dei permessi del browser.
function change(kind, before, after, user) {
  requireUser(user);
  if (!kinds.has(kind)) fail(400, "Archivio non valido.");
  if (before && !after) {
    if (kind !== "mcp_reports" || before.userId !== user.id)
      fail(403, "Eliminazione non autorizzata.");
    remove(kind, before.id);
    all("mcp_matches")
      .filter(
        (m) => m.lostReportId === before.id || m.foundReportId === before.id,
      )
      .forEach((m) => remove("mcp_matches", m.id));
    return;
  }
  if (!after || !safe(after.id, 100) || (before && before.id !== after.id))
    fail(400, "Dati non validi.");
  if (!before) {
    if (kind === "mcp_reports") {
      if (
        after.userId !== user.id ||
        !["lost", "found"].includes(after.type) ||
        !safe(after.title, 80) ||
        !safe(after.description) ||
        !safe(after.category, 80) ||
        !safe(after.place, 200) ||
        !/^\d{4}-\d\d-\d\d$/.test(after.date) ||
        !Number.isFinite(after.lat) ||
        !Number.isFinite(after.lng) ||
        Math.abs(after.lat) > 90 ||
        Math.abs(after.lng) > 180 ||
        (after.image || "").length > 1500000
      )
        fail(400, "Segnalazione non valida.");
      after = {
        ...after,
        userId: user.id,
        status: "open",
        moderation: "pending",
        createdAt: now(),
        history: [
          {
            id: uid(),
            date: now(),
            text: "Segnalazione inviata alla moderazione.",
          },
        ],
      };
    } else if (kind === "mcp_messages") {
      const r = get("mcp_reports", after.reportId);
      if (
        !r ||
        r.moderation !== "approved" ||
        r.userId === user.id ||
        !safe(after.text, 800)
      )
        fail(403, "Messaggio non autorizzato.");
      after = {
        id: after.id,
        reportId: r.id,
        fromUserId: user.id,
        toUserId: r.userId,
        text: after.text.trim(),
        createdAt: now(),
        read: false,
      };
      notify(r.userId, `Hai ricevuto un messaggio relativo a "${r.title}".`);
      history(r, "Nuovo messaggio inviato tramite la piattaforma.");
    } else if (kind === "mcp_matches") {
      const lost = get("mcp_reports", after.lostReportId),
        found = get("mcp_reports", after.foundReportId);
      if (
        !lost ||
        !found ||
        lost.type !== "lost" ||
        found.type !== "found" ||
        lost.moderation !== "approved" ||
        found.moderation !== "approved" ||
        !["open", "checking"].includes(lost.status) ||
        !["open", "checking"].includes(found.status) ||
        all(kind).some(
          (m) =>
            m.lostReportId === lost.id &&
            m.foundReportId === found.id &&
            m.status !== "rejected",
        )
      )
        fail(400, "Match non valido.");
      after = {
        id: after.id,
        lostReportId: lost.id,
        foundReportId: found.id,
        proposedBy: user.id,
        score: Math.max(0, Math.min(100, Number(after.score) || 0)),
        status: "proposed",
        verificationQuestion: "",
        questionAskedBy: null,
        questionAskedAt: null,
        verificationAnswer: "",
        answerGivenBy: null,
        answerGivenAt: null,
        createdAt: now(),
      };
      for (const r of [lost, found]) {
        if (r.status === "open") r.status = "checking";
        history(r, "È stato proposto un possibile match.");
        notify(r.userId, `Nuovo match proposto per "${r.title}".`);
      }
    } else fail(403, "Creazione non autorizzata.");
    put(kind, after);
    return;
  }
  if (kind === "mcp_reports") {
    const keys = Object.keys(after).filter((k) => !equal(after[k], before[k]));
    if (!keys.length) return;
    const owner = before.userId === user.id;
    const mod = user.role === "moderator";
    const moderationChange = keys.includes("moderation");
    if (moderationChange) {
      if (
        !mod ||
        before.moderation !== "pending" ||
        !["approved", "rejected"].includes(after.moderation) ||
        keys.some((k) => !["moderation", "history"].includes(k))
      )
        fail(403, "Moderazione non autorizzata.");
      const r = { ...before, moderation: after.moderation };
      history(
        r,
        after.moderation === "approved"
          ? "Segnalazione approvata dalla moderazione."
          : "Segnalazione rifiutata dalla moderazione.",
      );
      notify(
        r.userId,
        `La segnalazione "${r.title}" è stata ${after.moderation === "approved" ? "approvata" : "rifiutata"}.`,
      );
      // Avvisa gli autori di segnalazioni compatibili quando ne viene approvata una nuova.
      if (after.moderation === "approved") {
        for (const candidate of all("mcp_reports")) {
          if (
            candidate.id === r.id ||
            candidate.userId === r.userId ||
            candidate.moderation !== "approved" ||
            candidate.type === r.type ||
            candidate.category !== r.category
          )
            continue;
          const samePlace =
            candidate.place.toLowerCase() === r.place.toLowerCase();
          const days =
            Math.abs(new Date(candidate.date) - new Date(r.date)) / 86400000;
          if (samePlace || days <= 14)
            notify(
              candidate.userId,
              `È stato pubblicato un oggetto potenzialmente simile a "${candidate.title}".`,
            );
        }
      }
      return;
    }
    if (
      !owner &&
      !keys.every((k) => k === "history") &&
      !(
        keys.every((k) => ["status", "history"].includes(k)) &&
        before.status === "open" &&
        after.status === "checking"
      )
    )
      fail(403, "Modifica non autorizzata.");
    if (keys.some((k) => !["status", "history"].includes(k)))
      fail(403, "Campi protetti.");
    if (keys.includes("status") && !statuses.has(after.status))
      fail(400, "Stato non valido.");
    let nextHistory = before.history || [];
    if (keys.includes("history")) {
      const requested = after.history || [];
      if (
        !Array.isArray(requested) ||
        requested.some((x) => !safe(x.text, 250))
      )
        fail(400, "Storico non valido.");
      // Non duplica gli eventi che il server ha già registrato automaticamente.
      const last = requested.at(-1);
      if (
        last &&
        !nextHistory.some((h) => h.id === last.id || h.text === last.text)
      ) {
        if (!owner) {
          const related = all("mcp_matches").some(
            (m) =>
              [m.lostReportId, m.foundReportId].includes(before.id) &&
              participant(m, user),
          );
          if (!related) return;
        }
        nextHistory = [
          ...nextHistory,
          { id: uid(), date: now(), text: last.text },
        ];
      }
    }
    put(kind, { ...before, status: after.status, history: nextHistory });
    return;
  }
  if (kind === "mcp_matches") {
    if (!participant(before, user)) fail(403, "Match non autorizzato.");
    const lost = get("mcp_reports", before.lostReportId),
      found = get("mcp_reports", before.foundReportId);
    const keys = Object.keys(after).filter((k) => !equal(after[k], before[k]));
    if (!keys.length) return;
    const base = [
      "status",
      "verificationQuestion",
      "questionAskedBy",
      "questionAskedAt",
      "verificationAnswer",
      "answerGivenBy",
      "answerGivenAt",
      "score",
    ];
    if (keys.some((k) => !base.includes(k))) fail(403, "Campi protetti.");
    if (keys.includes("score") && keys.length === 1) return;
    if (
      after.status === "verification" &&
      user.id === found.userId &&
      !before.verificationQuestion &&
      !before.verificationAnswer &&
      safe(after.verificationQuestion, 300) &&
      after.questionAskedBy === user.id &&
      keys.every((k) =>
        [
          "status",
          "verificationQuestion",
          "questionAskedBy",
          "questionAskedAt",
        ].includes(k),
      )
    ) {
      put(kind, {
        ...before,
        status: "verification",
        verificationQuestion: after.verificationQuestion,
        questionAskedBy: user.id,
        questionAskedAt: now(),
      });
      notify(
        lost.userId,
        `Hai ricevuto una domanda di verifica per "${lost.title}".`,
      );
      return;
    }
    if (
      after.status === "verification" &&
      user.id === lost.userId &&
      before.verificationQuestion &&
      !before.verificationAnswer &&
      safe(after.verificationAnswer, 300) &&
      after.answerGivenBy === user.id &&
      keys.every((k) =>
        [
          "status",
          "verificationAnswer",
          "answerGivenBy",
          "answerGivenAt",
        ].includes(k),
      )
    ) {
      put(kind, {
        ...before,
        verificationAnswer: after.verificationAnswer,
        answerGivenBy: user.id,
        answerGivenAt: now(),
      });
      notify(
        found.userId,
        `Hai ricevuto una risposta di verifica per "${found.title}".`,
      );
      return;
    }
    if (
      user.id === found.userId &&
      after.status === "confirmed" &&
      before.verificationQuestion &&
      before.verificationAnswer &&
      keys.length === 1 &&
      keys[0] === "status"
    ) {
      put(kind, { ...before, status: "confirmed" });
      for (const r of [lost, found]) {
        r.status = "resolved";
        history(r, "Match confermato dopo la verifica. Segnalazione risolta.");
        notify(r.userId, `Il match per "${r.title}" è stato confermato.`);
      }
      return;
    }
    if (
      user.id === found.userId &&
      after.status === "rejected" &&
      !["confirmed", "rejected"].includes(before.status) &&
      keys.length === 1 &&
      keys[0] === "status"
    ) {
      put(kind, { ...before, status: "rejected" });
      for (const r of [lost, found]) {
        if (r.status === "checking") r.status = "open";
        history(r, "Il match proposto è stato rifiutato.");
        notify(r.userId, `Il match relativo a "${r.title}" è stato rifiutato.`);
      }
      return;
    }
    fail(403, "Transizione match non autorizzata.");
  }
  if (kind === "mcp_messages") {
    if (
      before.toUserId !== user.id ||
      Object.keys(after).some(
        (k) => !equal(after[k], before[k]) && k !== "read",
      ) ||
      after.read !== true
    )
      fail(403, "Messaggio non autorizzato.");
    put(kind, { ...before, read: true });
    return;
  }
  if (kind === "mcp_notifications") {
    if (
      before.userId !== user.id ||
      Object.keys(after).some(
        (k) => !equal(after[k], before[k]) && k !== "read",
      ) ||
      after.read !== true
    )
      fail(403, "Notifica non autorizzata.");
    put(kind, { ...before, read: true });
    return;
  }
}

/* ==================== LETTURA DATI AUTORIZZATI ==================== */

// Invia a ogni utente soltanto i dati pubblici e quelli a cui può accedere.
function snapshot(user) {
  const reports = all("mcp_reports")
    .filter(
      (r) =>
        r.moderation === "approved" ||
        (user && (r.userId === user.id || user.role === "moderator")),
    )
    .map((r) => {
      if (user && (r.userId === user.id || user.role === "moderator")) return r;
      const { privateDetail, ...visible } = r;
      return visible;
    });
  const ids = new Set(reports.map((r) => r.id));
  const matches = user
    ? all("mcp_matches").filter((m) => {
        const a = get("mcp_reports", m.lostReportId),
          b = get("mcp_reports", m.foundReportId);
        return a && b && (a.userId === user.id || b.userId === user.id);
      })
    : [];
  return {
    user: publicUser(user),
    users: db.prepare("SELECT id,name FROM accounts").all(),
    reports,
    matches,
    messages: user
      ? all("mcp_messages").filter(
          (m) => m.fromUserId === user.id || m.toUserId === user.id,
        )
      : [],
    notifications: user
      ? all("mcp_notifications").filter((n) => n.userId === user.id)
      : [],
  };
}

/* ==================== ROUTING HTTP ==================== */

// Limita dimensione delle richieste e accetta modifiche solo dalla stessa origine.
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2500000) {
        reject(
          Object.assign(new Error("Richiesta troppo grande."), { status: 413 }),
        );
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        reject(Object.assign(new Error("JSON non valido."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}
const respond = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
};
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        if (
          req.method !== "GET" &&
          req.headers.origin &&
          new URL(req.headers.origin).host !== req.headers.host
        )
          fail(403, "Origine non autorizzata.");
        const user = currentUser(req);
        if (url.pathname === "/api/bootstrap" && req.method === "GET")
          return respond(res, 200, snapshot(user));
        if (url.pathname === "/api/register" && req.method === "POST") {
          const b = await readBody(req),
            name = String(b.name || "").trim(),
            email = String(b.email || "")
              .trim()
              .toLowerCase(),
            password = b.password;
          if (
            !safe(name, 60) ||
            !/^\S+@\S+\.\S+$/.test(email) ||
            email.length > 200 ||
            typeof password !== "string" ||
            password.length < 8 ||
            password.length > 200
          )
            fail(
              400,
              "Inserisci dati validi e una password di almeno 8 caratteri.",
            );
          if (db.prepare("SELECT id FROM accounts WHERE email=?").get(email))
            fail(409, "Esiste già un account con questa email.");
          const id = uid(),
            salt = crypto.randomBytes(16).toString("hex");
          db.prepare("INSERT INTO accounts VALUES(?,?,?,?,?,?)").run(
            id,
            name,
            email,
            passwordHash(password, salt),
            salt,
            "user",
          );
          const created = account(id);
          loginSession(res, created);
          return respond(res, 200, { user: created });
        }
        if (url.pathname === "/api/login" && req.method === "POST") {
          const b = await readBody(req),
            row = db.prepare("SELECT * FROM accounts WHERE email=?").get(
              String(b.email || "")
                .trim()
                .toLowerCase(),
            );
          if (
            !row ||
            typeof b.password !== "string" ||
            !crypto.timingSafeEqual(
              Buffer.from(row.hash, "hex"),
              Buffer.from(passwordHash(b.password, row.salt), "hex"),
            )
          )
            fail(401, "Email o password non corretti.");
          const u = account(row.id);
          loginSession(res, u);
          return respond(res, 200, { user: u });
        }
        if (url.pathname === "/api/logout" && req.method === "POST") {
          const token = /(?:^|;\s*)mcp_token=([^;]+)/.exec(
            req.headers.cookie || "",
          )?.[1];
          if (token)
            db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
              crypto.createHash("sha256").update(token).digest("hex"),
            );
          setCookie(res, "", 0);
          return respond(res, 200, { ok: true });
        }
        if (url.pathname === "/api/change" && req.method === "POST") {
          requireUser(user);
          const b = await readBody(req);
          if (
            !kinds.has(b.kind) ||
            !Array.isArray(b.changes) ||
            b.changes.length > 100
          )
            fail(400, "Modifiche non valide.");
          db.exec("BEGIN IMMEDIATE");
          try {
            for (const c of b.changes) {
              if (!safe(c.id, 100)) fail(400, "Identificativo non valido.");
              const before = get(b.kind, c.id);
              if (c.previous !== undefined && !equal(before, c.previous))
                fail(
                  409,
                  "Dati modificati da un altro utente. Ricarica la pagina.",
                );
              change(b.kind, before, c.next, user);
            }
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
          return respond(res, 200, { ok: true });
        }
        fail(404, "API non trovata.");
      }
      if (req.method !== "GET") fail(405, "Metodo non consentito.");
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      if (!["/index.html", "/style.css", "/script.js"].includes(pathname))
        fail(404, "File non trovato.");
      const file = path.join(__dirname, "public", pathname);
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)],
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      if (!res.headersSent)
        respond(res, e.status || 500, {
          error: e.status ? e.message : "Errore interno del server.",
        });
    }
  })
  .listen(PORT, () =>
    console.log(`Museo delle Cose Perdute: http://localhost:${PORT}`),
  );
