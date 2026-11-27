"use strict";

/* ==================== ASSEGNAZIONE MODERATORE ==================== */

// Permette all'amministratore del server di promuovere un account esistente.
// Eseguire: node promuovi-moderatore.js email@esempio.it
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const email = String(process.argv[2] || "")
  .trim()
  .toLowerCase();
if (!email) {
  console.error("Indica l'email dell'account da promuovere.");
  process.exit(1);
}
const db = new DatabaseSync(path.join(__dirname, "museo.sqlite"));
const result = db
  .prepare("UPDATE accounts SET role='moderator' WHERE email=?")
  .run(email);
if (result.changes !== 1) {
  console.error("Account non trovato.");
  process.exitCode = 1;
} else
  console.log("Ruolo moderatore assegnato. Effettuare nuovamente l'accesso.");
db.close();
