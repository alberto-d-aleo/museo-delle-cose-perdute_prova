"use strict";

/* ==================== ARCHIVIAZIONE DATI ==================== */

// Definizione delle chiavi utilizzate per salvare i dati nel localStorage.
const STORAGE = {
  USERS: "mcp_users",
  REPORTS: "mcp_reports",
  MATCHES: "mcp_matches",
  MESSAGES: "mcp_messages",
  NOTIFICATIONS: "mcp_notifications",
  SESSION: "mcp_session",
};

// Recupera in sicurezza un insieme di dati dal localStorage.
// Utilizza una copia temporanea dei dati ricevuti dal database condiviso.
const serverCache = Object.fromEntries(
  Object.values(STORAGE).map((key) => [key, []]),
);
let activeSession = null;
let writeQueue = Promise.resolve();
let serverReady = false;
const getData = (key) => structuredClone(serverCache[key] || []);

// Salva un valore nel localStorage convertendolo in JSON.
// Invia soltanto le differenze al server, che verifica identità e permessi.
const setData = (key, value) => {
  const previous = serverCache[key] || [];
  const oldMap = new Map(previous.map((item) => [item.id, item]));
  const newMap = new Map(value.map((item) => [item.id, item]));
  const changes = [...new Set([...oldMap.keys(), ...newMap.keys()])]
    .filter(
      (id) => JSON.stringify(oldMap.get(id)) !== JSON.stringify(newMap.get(id)),
    )
    .map((id) => ({ id, next: newMap.get(id) || null }));
  serverCache[key] = structuredClone(value);
  if (!serverReady || !changes.length) return;
  // Le nuove notifiche sono create esclusivamente dal server.
  if (key === STORAGE.NOTIFICATIONS)
    changes.splice(
      0,
      changes.length,
      ...changes.filter(
        (c) => c.next && previous.some((item) => item.id === c.id),
      ),
    );
  if (!changes.length) return;
  writeQueue = writeQueue
    .then(async () => {
      const response = await fetch("/api/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: key, changes }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Salvataggio non riuscito.");
    })
    .catch(async (error) => {
      toast(error.message);
      await refreshServerData();
    });
};

// Recupera la sessione dell'utente attualmente autenticato.
// La sessione è confermata dal server tramite un cookie protetto.
const getSession = () => activeSession;

// Salva oppure elimina la sessione dell'utente.
// Mantiene soltanto i dati pubblici del profilo nella memoria temporanea.
const setSession = (user) => {
  activeSession = user;
};

// Richiede al server la versione aggiornata degli archivi autorizzati.
async function refreshServerData() {
  const response = await fetch("/api/bootstrap", { cache: "no-store" });
  if (!response.ok) throw new Error("Impossibile collegarsi al server.");
  const data = await response.json();
  activeSession = data.user;
  serverCache[STORAGE.USERS] = data.users;
  serverCache[STORAGE.REPORTS] = data.reports;
  serverCache[STORAGE.MATCHES] = data.matches;
  serverCache[STORAGE.MESSAGES] = data.messages;
  serverCache[STORAGE.NOTIFICATIONS] = data.notifications;
  serverReady = true;
}

// Esegue le richieste di accesso e registrazione senza salvare password nel browser.
async function accountRequest(endpoint, body) {
  const response = await fetch(`/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Operazione non riuscita.");
  await refreshServerData();
  return result;
}

// Generazione di un identificatore univoco per gli elementi creati.
const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

// Restituzione di data e ora correnti in formato ISO.
const nowISO = () => new Date().toISOString();

/* ==================== ELEMENTI DOM ==================== */

// Creazione di scorciatoie per selezionare uno o più elementi HTML.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// Recupera gli elementi principali del menu.
const menuButton = $("#menuButton");
const sideMenu = $("#sideMenu");
const menuOverlay = $("#menuOverlay");
const closeMenuButton = $("#closeMenu");

// Recupera gli elementi della finestra modale.
const modalOverlay = $("#modalOverlay");
const modalContent = $("#modalContent");
const modalClose = $("#modalClose");

// Recupera il contenitore delle notifiche temporanee.
const toastContainer = $("#toastContainer");

// Recupera gli elementi principali dell'archivio.
const reportsGrid = $("#reportsGrid");
const archiveCount = $("#archiveCount");

// Recupera i moduli principali.
const reportForm = $("#reportForm");
const loginForm = $("#loginForm");
const registerForm = $("#registerForm");

// Memorizza le mappe e la posizione selezionata.
let reportMap = null;
let publicMap = null;
let selectedMarker = null;
let selectedCoordinates = null;

// Memorizza la scheda attualmente selezionata nella sezione Match.
let currentMatchTab = "suggested";

/* ==================== FUNZIONI GENERALI ==================== */

// Protegge il testo dinamico da caratteri HTML potenzialmente pericolosi.
function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Convertimento di una data nel formato italiano.
function formatDate(value) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

// Convertimento di data e ora nel formato italiano.
function formatDateTime(value) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

// Converte il tipo tecnico della segnalazione in testo leggibile.
function typeLabel(type) {
  return type === "lost" ? "SMARRITO" : "RITROVATO";
}

// Convertimento dello stato tecnico della segnalazione in testo leggibile.
function statusLabel(status) {
  const labels = {
    open: "Aperta",
    checking: "In verifica",
    resolved: "Risolta",
    archived: "Archiviata",
  };

  return labels[status] || status;
}

// Convertimento dello stato della moderazione in testo leggibile.
function moderationLabel(status) {
  const labels = {
    pending: "In attesa",
    approved: "Approvata",
    rejected: "Rifiutata",
  };

  return labels[status] || status;
}

// Mostra un breve messaggio temporaneo all'utente.
function toast(message) {
  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;

  toastContainer.appendChild(element);

  setTimeout(() => {
    element.remove();
  }, 3500);
}

// Restituisce l'utente attualmente autenticato.
function getCurrentUser() {
  return getSession();
}

// Cerca un utente attraverso il suo identificatore.
function getUserById(id) {
  return getData(STORAGE.USERS).find((user) => user.id === id);
}

// Verifica che l'utente sia autenticato prima di continuare.
function requireLogin() {
  if (!getCurrentUser()) {
    toast("Accedi per utilizzare questa funzione.");
    showSection("login");
    return false;
  }

  return true;
}

/* ==================== MENU ==================== */

// Apertura del menu laterale.
function openMenu() {
  sideMenu.classList.add("open");
  menuOverlay.classList.add("open");
  menuButton.setAttribute("aria-expanded", "true");
}

// Chiusura del menu laterale.
function closeMenu() {
  sideMenu.classList.remove("open");
  menuOverlay.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
}

// Collega i pulsanti alle funzioni di apertura e chiusura.
menuButton.addEventListener("click", openMenu);
closeMenuButton.addEventListener("click", closeMenu);
menuOverlay.addEventListener("click", closeMenu);

/* ==================== NAVIGAZIONE ==================== */

// Mostra la sezione richiesta e controlla eventuali permessi.
function showSection(id) {
  const protectedSections = ["dashboard", "matches", "messages"];

  // Reindirizza al login se una sezione privata viene aperta senza accesso.
  if (protectedSections.includes(id) && !getCurrentUser()) {
    id = "login";
    toast("Accedi per visualizzare questa sezione.");
  }

  // Impedisce agli utenti normali di accedere alla moderazione.
  if (id === "moderation" && getCurrentUser()?.role !== "moderator") {
    id = "home";
    toast("Area riservata ai moderatori.");
  }

  // Nasconde tutte le sezioni.
  $$(".page-section").forEach((section) => {
    section.classList.remove("active");
  });

  const target = document.getElementById(id);

  if (!target) return;

  // Mostra solamente la sezione richiesta.
  target.classList.add("active");

  closeMenu();

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });

  // Aggiorna dinamicamente il contenuto della sezione aperta.
  if (id === "archive") renderArchive();
  if (id === "dashboard") renderDashboard();
  if (id === "matches") renderMatches();
  if (id === "messages") renderMessages();
  if (id === "moderation") renderModeration();

  // Aggiorna la mappa pubblica dopo che la sezione è visibile.
  if (id === "mapPage") {
    setTimeout(renderPublicMap, 80);
  }

  // Prepara modulo e mappa della nuova segnalazione.
  if (id === "newReport") {
    updateNewReportState();
    setTimeout(initReportMap, 80);
  }
}

// Gestisce centralmente tutti i pulsanti che cambiano sezione.
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-section]");

  if (!target) return;

  showSection(target.dataset.section);
});

/* ==================== INTERFACCIA ACCOUNT ==================== */

// Aggiornamento del menu in base all'utente autenticato.
function updateAccountUI() {
  const user = getCurrentUser();

  const authElements = $$(".auth-only");
  const moderatorElements = $$(".moderator-only");

  if (user) {
    // Mostra le funzioni disponibili agli utenti autenticati.
    authElements.forEach((element) => element.classList.remove("hidden"));

    $("#loginMenuButton").classList.add("hidden");
    $("#registerMenuButton").classList.add("hidden");
    $("#logoutButton").classList.remove("hidden");

    $("#headerUser").textContent = user.name;
    $("#notificationButton").classList.remove("hidden");

    // Mostra la moderazione solamente agli utenti autorizzati.
    if (user.role === "moderator") {
      moderatorElements.forEach((element) => {
        element.classList.remove("hidden");
      });
    } else {
      moderatorElements.forEach((element) => {
        element.classList.add("hidden");
      });
    }
  } else {
    // Nasconde le funzioni private quando non esiste una sessione.
    authElements.forEach((element) => element.classList.add("hidden"));

    moderatorElements.forEach((element) => element.classList.add("hidden"));

    $("#loginMenuButton").classList.remove("hidden");
    $("#registerMenuButton").classList.remove("hidden");
    $("#logoutButton").classList.add("hidden");
    $("#notificationButton").classList.add("hidden");
    $("#headerUser").textContent = "Archivio digitale";
  }

  updateCounters();
  updateNewReportState();
}

// Termina la sessione e torna alla home.
$("#logoutButton").addEventListener("click", async () => {
  await accountRequest("logout", {});
  setSession(null);
  updateAccountUI();
  closeMenu();
  showSection("home");
  toast("Sessione terminata.");
});

/* ==================== REGISTRAZIONE ==================== */

// Registra un nuovo utente e avvia automaticamente la sessione.
registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#registerName").value.trim();
  const email = $("#registerEmail").value.trim().toLowerCase();
  const password = $("#registerPassword").value;
  // Impedisce la registrazione della stessa email più volte.
  // Crea il nuovo profilo utente.
  // Il server assegna il ruolo utente senza accettare privilegi dal modulo.
  try {
    await accountRequest("register", { name, email, password });
    registerForm.reset();
    updateAccountUI();
    toast("Account creato.");
    showSection("dashboard");
  } catch (error) {
    toast(error.message);
  }
});

/* ==================== LOGIN ==================== */

// Controlla le credenziali e avvia la sessione.
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("#loginEmail").value.trim().toLowerCase();
  const password = $("#loginPassword").value;
  // Blocca l'accesso se le credenziali non corrispondono.
  try {
    await accountRequest("login", { email, password });
    loginForm.reset();
    updateAccountUI();
    toast(`Bentornato, ${getCurrentUser().name}.`);
    showSection("dashboard");
  } catch (error) {
    toast(error.message);
  }
});

/* ==================== NUOVA SEGNALAZIONE ==================== */

// Mostra il modulo solo agli utenti autenticati.
function updateNewReportState() {
  const user = getCurrentUser();

  if (!reportForm) return;

  if (user) {
    reportForm.classList.remove("hidden");
    $("#newReportLoginNotice").classList.add("hidden");
  } else {
    reportForm.classList.add("hidden");
    $("#newReportLoginNotice").classList.remove("hidden");
  }
}

/* ==================== MAPPA DEL MODULO ==================== */

// Inizializzazione della mappa utilizzata per scegliere la posizione.
function initReportMap() {
  if (!window.L) return;

  // Riutilizza la mappa se è già stata creata.
  if (reportMap) {
    reportMap.invalidateSize();
    return;
  }

  reportMap = L.map("reportMap").setView([45.4642, 9.19], 13);

  // Carica la cartografia OpenStreetMap.
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
  }).addTo(reportMap);

  // Memorizza la posizione scelta dall'utente con un clic.
  reportMap.on("click", (event) => {
    selectedCoordinates = {
      lat: event.latlng.lat,
      lng: event.latlng.lng,
    };

    if (selectedMarker) {
      selectedMarker.setLatLng(event.latlng);
    } else {
      selectedMarker = L.marker(event.latlng).addTo(reportMap);
    }
  });
}

/* ==================== IMMAGINI ==================== */

// Ridimensiona e comprime l'immagine prima del salvataggio.
function resizeImage(file, maxWidth = 1200, quality = 0.78) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      const image = new Image();

      image.onload = () => {
        let width = image.width;
        let height = image.height;

        // Riduzione delle immagini troppo larghe mantenendo le proporzioni.
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));

          width = maxWidth;
        }

        const canvas = document.createElement("canvas");

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");

        ctx.drawImage(image, 0, 0, width, height);

        resolve(canvas.toDataURL("image/jpeg", quality));
      };

      image.onerror = reject;
      image.src = event.target.result;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ==================== PUBBLICAZIONE ==================== */

// Crea una nuova segnalazione con i dati inseriti nel modulo.
reportForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!requireLogin()) return;

  // Richiesta obbligatoria di una posizione geografica.
  if (!selectedCoordinates) {
    toast("Seleziona un punto sulla mappa.");
    return;
  }

  const user = getCurrentUser();
  const file = $("#reportImage").files[0];

  let image = "";

  // Elaborazione dell'immagine prima di salvarla.
  try {
    image = await resizeImage(file);
  } catch {
    toast("Impossibile elaborare l'immagine.");
    return;
  }

  // Costruzione dell'oggetto contenente tutti i dati della segnalazione.
  const report = {
    id: uid(),
    userId: user.id,
    type: $("#reportType").value,
    category: $("#reportCategory").value,
    title: $("#reportTitle").value.trim(),
    description: $("#reportDescription").value.trim(),
    privateDetail: $("#privateDetail").value.trim(),
    place: $("#reportPlace").value.trim(),
    date: $("#reportDate").value,
    lat: selectedCoordinates.lat,
    lng: selectedCoordinates.lng,
    image,
    status: "open",
    moderation: "pending",
    createdAt: nowISO(),

    // Registra la prima operazione nello storico.
    history: [
      {
        id: uid(),
        date: nowISO(),
        text: "Segnalazione inviata alla moderazione.",
      },
    ],
  };

  const reports = getData(STORAGE.REPORTS);

  reports.unshift(report);
  setData(STORAGE.REPORTS, reports);

  // Ripristina il modulo dopo l'invio.
  reportForm.reset();
  selectedCoordinates = null;

  if (selectedMarker && reportMap) {
    reportMap.removeLayer(selectedMarker);
    selectedMarker = null;
  }

  toast("Segnalazione inviata alla moderazione.");
  showSection("dashboard");
});

/* ==================== ARCHIVIO ==================== */

// Restituisce solamente le segnalazioni approvate.
function getApprovedReports() {
  return getData(STORAGE.REPORTS).filter(
    (report) => report.moderation === "approved",
  );
}

// Applica ricerca e filtri alle segnalazioni pubbliche.
function getFilteredReports() {
  const search = $("#searchInput").value.trim().toLowerCase();
  const type = $("#filterType").value;
  const category = $("#filterCategory").value;
  const place = $("#filterPlace").value.trim().toLowerCase();
  const status = $("#filterStatus").value;

  return getApprovedReports().filter((report) => {
    const searchable = `${report.title} ${report.description}`.toLowerCase();

    if (search && !searchable.includes(search)) return false;
    if (type && report.type !== type) return false;
    if (category && report.category !== category) return false;

    if (place && !report.place.toLowerCase().includes(place)) return false;

    if (status && report.status !== status) return false;

    return true;
  });
}

// Generazione del codice HTML di una scheda dell'archivio.
function reportCard(report) {
  const image = report.image
    ? `
            <img
                src="${report.image}"
                alt="${escapeHTML(report.title)}"
            >
        `
    : `
            <div class="image-placeholder">
                IMMAGINE NON DISPONIBILE
            </div>
        `;

  return `
        <article class="report-card">

            <div class="report-image">
                ${image}

                <span class="card-tag ${report.type}">
                    ${typeLabel(report.type)}
                </span>
            </div>

            <div class="card-body">

                <div class="card-meta">
                    <span>${escapeHTML(report.category)}</span>
                    <span>${formatDate(report.date)}</span>
                </div>

                <h3>${escapeHTML(report.title)}</h3>

                <p>
                    ${escapeHTML(
                      report.description.length > 140
                        ? report.description.slice(0, 140) + "…"
                        : report.description,
                    )}
                </p>

            </div>

            <div class="card-footer">

                <span class="status ${report.status}">
                    ${statusLabel(report.status)}
                </span>

                <button
                    class="small-button"
                    onclick="openReport('${report.id}')"
                >
                    Dettagli
                </button>

            </div>

        </article>
    `;
}

// Visualizza nell'archivio tutte le segnalazioni filtrate.
function renderArchive() {
  const reports = getFilteredReports();

  archiveCount.textContent = `${reports.length} ${
    reports.length === 1 ? "segnalazione" : "segnalazioni"
  }`;

  // Mostra un messaggio se la ricerca non produce risultati.
  if (!reports.length) {
    reportsGrid.innerHTML = `
            <div class="empty-state">
                Nessuna segnalazione corrisponde alla ricerca.
            </div>
        `;
    return;
  }

  reportsGrid.innerHTML = reports.map(reportCard).join("");
}

// Aggiorna automaticamente l'archivio quando cambia un filtro.
[
  "#searchInput",
  "#filterType",
  "#filterCategory",
  "#filterPlace",

  "#filterStatus",
].forEach((selector) => {
  $(selector).addEventListener("input", renderArchive);
  $(selector).addEventListener("change", renderArchive);
});

/* ==================== DETTAGLIO SEGNALAZIONE ==================== */

// Apertura della pagina completa di una segnalazione.
window.openReport = function (id) {
  const report = getData(STORAGE.REPORTS).find((item) => item.id === id);

  if (!report) return;

  const author = getUserById(report.userId);
  const currentUser = getCurrentUser();

  // Controlla se la segnalazione appartiene all'utente corrente.
  const isOwner = currentUser && currentUser.id === report.userId;

  const image = report.image
    ? `
            <img
                src="${report.image}"
                alt="${escapeHTML(report.title)}"
            >
        `
    : `
            <div class="image-placeholder">
                IMMAGINE NON DISPONIBILE
            </div>
        `;

  // Genera lo storico delle operazioni dalla più recente.
  const history = (report.history || [])
    .slice()
    .reverse()
    .map(
      (item) => `
            <div class="history-item">
                ${formatDateTime(item.date)}
                ·
                ${escapeHTML(item.text)}
            </div>
        `,
    )
    .join("");

  // Costruisce dinamicamente la pagina di dettaglio.
  $("#reportDetailContent").innerHTML = `
        <div class="detail-layout">

            <div class="detail-image">
                ${image}
            </div>

            <div class="detail-info">

                <p class="eyebrow dark">
                    ${typeLabel(report.type)}
                    ·
                    ${escapeHTML(report.category)}
                </p>

                <h2>${escapeHTML(report.title)}</h2>

                <p>${escapeHTML(report.description)}</p>

                <div class="detail-data">

                    <div class="detail-row">
                        <span>Luogo</span>
                        <span>${escapeHTML(report.place)}</span>
                    </div>

                    <div class="detail-row">
                        <span>Data</span>
                        <span>${formatDate(report.date)}</span>
                    </div>

                    <div class="detail-row">
                        <span>Stato</span>
                        <span>${statusLabel(report.status)}</span>
                    </div>

                    <div class="detail-row">
                        <span>Autore</span>
                        <span>${escapeHTML(author?.name || "Utente")}</span>
                    </div>

                </div>

                <div class="detail-actions">

                    ${
                      !isOwner
                        ? `
                                <button
                                    class="button dark-button"
                                    onclick="openContactModal('${report.id}')"
                                >
                                    Contatta l'autore
                                </button>

                                <button
                                    class="small-button"
                                    onclick="showPossibleMatches('${report.id}')"
                                >
                                    Proponi un match
                                </button>
                            `
                        : ""
                    }

                    <button
                        class="small-button"
                        onclick="showQRCode('${report.id}')"
                    >
                        QR Code
                    </button>

                    ${
                      isOwner
                        ? `
                                <button
                                    class="small-button"
                                    onclick="openStatusModal('${report.id}')"
                                >
                                    Modifica stato
                                </button>

                                <button
                                    class="small-button danger-button"
                                    onclick="deleteReport('${report.id}')"
                                >
                                    Elimina
                                </button>
                            `
                        : ""
                    }

                </div>

                <div class="history">
                    <h3>Storico</h3>
                    ${history || "Nessuna interazione registrata."}
                </div>

            </div>

        </div>
    `;

  showSection("reportDetail");
};

/* ==================== MESSAGGI ==================== */

// Apertura del modulo per contattare l'autore di una segnalazione.
window.openContactModal = function (reportId) {
  if (!requireLogin()) return;

  const report = getData(STORAGE.REPORTS).find((item) => item.id === reportId);

  if (!report) return;

  // Impedisce di inviare messaggi a se stessi.
  if (report.userId === getCurrentUser().id) {
    toast("Questa segnalazione è tua.");
    return;
  }

  openModal(`
        <h2>Invia un messaggio</h2>

        <form id="contactForm">

            <label>
                Messaggio
                <textarea
                    id="contactText"
                    rows="6"
                    required
                    maxlength="800"
                    placeholder="Scrivi il tuo messaggio..."
                ></textarea>
            </label>

            <button class="button dark-button">
                Invia
            </button>

        </form>
    `);

  // Salva il messaggio quando viene inviato il modulo.
  $("#contactForm").addEventListener("submit", (event) => {
    event.preventDefault();

    const messages = getData(STORAGE.MESSAGES);

    messages.unshift({
      id: uid(),
      reportId,
      fromUserId: getCurrentUser().id,
      toUserId: report.userId,
      text: $("#contactText").value.trim(),
      createdAt: nowISO(),
      read: false,
    });

    setData(STORAGE.MESSAGES, messages);

    // Avvisa il destinatario del nuovo messaggio.
    addNotification(
      report.userId,
      `Hai ricevuto un messaggio relativo a "${report.title}".`,
    );

    addHistory(reportId, "Nuovo messaggio inviato tramite la piattaforma.");

    closeModal();
    toast("Messaggio inviato.");
    updateCounters();
  });
};

// Visualizza tutti i messaggi inviati o ricevuti dall'utente.
function renderMessages() {
  const user = getCurrentUser();

  if (!user) return;

  let messages = getData(STORAGE.MESSAGES);

  messages = messages.filter(
    (message) => message.toUserId === user.id || message.fromUserId === user.id,
  );

  // Segna come letti i messaggi ricevuti.
  messages.forEach((message) => {
    if (message.toUserId === user.id) {
      message.read = true;
    }
  });

  setData(
    STORAGE.MESSAGES,
    getData(STORAGE.MESSAGES).map((original) => {
      const updated = messages.find((item) => item.id === original.id);

      return updated || original;
    }),
  );

  const container = $("#messageList");

  if (!messages.length) {
    container.innerHTML = `
            <div class="empty-state">
                Nessun messaggio.
            </div>
        `;

    updateCounters();
    return;
  }

  // Ordina e visualizza i messaggi dal più recente.
  container.innerHTML = messages
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((message) => {
      const otherId =
        message.fromUserId === user.id ? message.toUserId : message.fromUserId;

      const otherUser = getUserById(otherId);

      const report = getData(STORAGE.REPORTS).find(
        (item) => item.id === message.reportId,
      );

      return `
                <div class="list-item">

                    <div>
                        <h3>${escapeHTML(otherUser?.name || "Utente")}</h3>

                        <p>${escapeHTML(message.text)}</p>

                        <p>
                            <button
                                class="small-button"
                                onclick="openReport('${message.reportId}')"
                            >
                                ${escapeHTML(report?.title || "Segnalazione")}
                            </button>
                        </p>
                    </div>

                    <span class="list-date">
                        ${formatDateTime(message.createdAt)}
                    </span>

                </div>
            `;
    })
    .join("");

  updateCounters();
}

/* ==================== STORICO ==================== */

// Aggiunge una nuova interazione allo storico della segnalazione.
function addHistory(reportId, text) {
  const reports = getData(STORAGE.REPORTS);

  const report = reports.find((item) => item.id === reportId);

  if (!report) return;

  if (!Array.isArray(report.history)) {
    report.history = [];
  }

  report.history.push({
    id: uid(),
    date: nowISO(),
    text,
  });

  setData(STORAGE.REPORTS, reports);
}

/* ==================== STATO SEGNALAZIONE ==================== */

// Permette al proprietario di modificare lo stato della segnalazione.
window.openStatusModal = function (reportId) {
  const report = getData(STORAGE.REPORTS).find((item) => item.id === reportId);

  if (!report) return;

  if (report.userId !== getCurrentUser()?.id) return;

  openModal(`
        <h2>Stato</h2>

        <form id="statusForm">

            <label>

                Stato della segnalazione

                <select id="newStatus">
                    <option value="open">Aperta</option>
                    <option value="checking">In verifica</option>
                    <option value="resolved">Risolta</option>
                    <option value="archived">Archiviata</option>
                </select>
            </label>

            <button class="button dark-button">
                Salva
            </button>

        </form>
    `);

  $("#newStatus").value = report.status;

  // Salva il nuovo stato e registra l'operazione nello storico.
  $("#statusForm").addEventListener("submit", (event) => {
    event.preventDefault();

    const reports = getData(STORAGE.REPORTS);

    const target = reports.find((item) => item.id === reportId);

    const newStatus = $("#newStatus").value;

    target.status = newStatus;

    target.history.push({
      id: uid(),
      date: nowISO(),
      text: `Stato modificato in "${statusLabel(newStatus)}".`,
    });

    setData(STORAGE.REPORTS, reports);

    closeModal();
    toast("Stato aggiornato.");
    openReport(reportId);
  });
};

/* ==================== ELIMINAZIONE ==================== */

// Elimina una segnalazione e tutti i match collegati.
window.deleteReport = function (reportId) {
  const report = getData(STORAGE.REPORTS).find((item) => item.id === reportId);

  if (!report) return;

  // Consente l'eliminazione solamente al proprietario.
  if (report.userId !== getCurrentUser()?.id) return;

  const confirmed = confirm(
    "Vuoi eliminare definitivamente questa segnalazione?",
  );

  if (!confirmed) return;

  // Rimuove la segnalazione.
  setData(
    STORAGE.REPORTS,
    getData(STORAGE.REPORTS).filter((item) => item.id !== reportId),
  );

  // Rimuove i match associati alla segnalazione eliminata.
  setData(
    STORAGE.MATCHES,
    getData(STORAGE.MATCHES).filter(
      (match) =>
        match.lostReportId !== reportId && match.foundReportId !== reportId,
    ),
  );

  toast("Segnalazione eliminata.");
  showSection("dashboard");
};

/* ==================== MATCHING AUTOMATICO ==================== */

// Trasforma un testo in parole normalizzate utilizzabili nel confronto.
function normalizeWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

// Calcola la somiglianza tra le parole delle due segnalazioni.
function keywordScore(a, b) {
  const wordsA = new Set(normalizeWords(`${a.title} ${a.description}`));

  const wordsB = new Set(normalizeWords(`${b.title} ${b.description}`));

  if (!wordsA.size || !wordsB.size) return 0;

  let common = 0;

  wordsA.forEach((word) => {
    if (wordsB.has(word)) {
      common++;
    }
  });

  return Math.min(
    20,
    Math.round((common / Math.max(wordsA.size, wordsB.size)) * 40),
  );
}

// Assegna un punteggio in base alla vicinanza delle date.
function dateScore(a, b) {
  const first = new Date(a.date);
  const second = new Date(b.date);

  const difference = Math.abs(first - second) / 86400000;

  if (difference <= 1) return 20;
  if (difference <= 3) return 17;
  if (difference <= 7) return 13;
  if (difference <= 14) return 8;
  if (difference <= 30) return 4;

  return 0;
}

// Calcola la distanza geografica tra due segnalazioni.
function distanceKm(a, b) {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) {
    return Infinity;
  }

  const R = 6371;

  const dLat = ((b.lat - a.lat) * Math.PI) / 180;

  const dLng = ((b.lng - a.lng) * Math.PI) / 180;

  const lat1 = (a.lat * Math.PI) / 180;

  const lat2 = (b.lat * Math.PI) / 180;

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(x));
}

// Assegna un punteggio in base alla vicinanza geografica.
function locationScore(a, b) {
  const distance = distanceKm(a, b);

  if (distance <= 0.25) return 25;
  if (distance <= 0.5) return 23;
  if (distance <= 1) return 20;
  if (distance <= 2) return 16;
  if (distance <= 5) return 10;
  if (distance <= 10) return 5;

  return 0;
}

// Calcola la compatibilità complessiva tra uno smarrito e un ritrovato.
function calculateMatchScore(a, b) {
  if (a.type === b.type) return 0;

  let score = 0;

  // La stessa categoria aumenta fortemente la compatibilità.
  if (a.category === b.category) {
    score += 35;
  }

  score += locationScore(a, b);
  score += dateScore(a, b);
  score += keywordScore(a, b);

  return Math.min(100, score);
}

// Cerca automaticamente possibili corrispondenze per l'utente.
function getSuggestedMatchesForUser() {
  const user = getCurrentUser();

  if (!user) return [];

  const reports = getApprovedReports().filter(
    (report) => report.status === "open" || report.status === "checking",
  );

  const myReports = reports.filter((report) => report.userId === user.id);

  const suggestions = [];

  // Confronta ogni segnalazione personale con quelle degli altri utenti.
  myReports.forEach((myReport) => {
    reports.forEach((other) => {
      if (other.userId === user.id) return;
      if (other.type === myReport.type) return;

      const score = calculateMatchScore(myReport, other);

      // Mostra solo corrispondenze con una compatibilità minima.
      if (score >= 35) {
        suggestions.push({
          id: `${myReport.id}_${other.id}`,
          myReport,
          otherReport: other,
          score,
        });
      }
    });
  });

  // Ordina i risultati dal match più compatibile.
  return suggestions.sort((a, b) => b.score - a.score);
}

/* ==================== PROPOSTA MATCH ==================== */

// Mostra le proprie segnalazioni compatibili con quella selezionata.
window.showPossibleMatches = function (reportId) {
  if (!requireLogin()) return;

  const source = getData(STORAGE.REPORTS).find((item) => item.id === reportId);

  if (!source) return;

  const myOppositeReports = getApprovedReports()
    .filter(
      (report) =>
        report.userId === getCurrentUser().id &&
        report.type !== source.type &&
        report.status !== "archived" &&
        report.status !== "resolved",
    )
    .map((report) => ({
      report,
      score: calculateMatchScore(report, source),
    }))
    .sort((a, b) => b.score - a.score);

  if (!myOppositeReports.length) {
    toast("Non hai segnalazioni compatibili da proporre.");
    return;
  }

  // Mostra in una finestra i possibili oggetti da associare.
  openModal(`
        <h2>Proponi un match</h2>

        <p>
            Seleziona una tua segnalazione da confrontare.
        </p>

        <div class="list-container">

            ${myOppositeReports
              .map(
                (item) => `
                        <div class="list-item">

                            <div>
                                <h3>
                                    ${escapeHTML(item.report.title)}
                                </h3>

                                <p>
                                    Compatibilità automatica:
                                    <strong>${item.score}%</strong>
                                </p>
                            </div>

                            <button
                                class="small-button"
                                onclick="
                                    proposeMatch(
                                        '${item.report.id}',
                                        '${source.id}'
                                    )
                                "
                            >
                                Proponi
                            </button>

                        </div>
                    `,
              )
              .join("")}

        </div>
    `);
};

// Creazione di un nuovo match tra una segnalazione smarrita e una ritrovata.
window.proposeMatch = function (firstId, secondId) {
  if (!requireLogin()) return;

  const reports = getData(STORAGE.REPORTS);

  const first = reports.find((report) => report.id === firstId);

  const second = reports.find((report) => report.id === secondId);

  if (!first || !second) return;

  // Impedisce di associare due segnalazioni dello stesso tipo.
  if (first.type === second.type) return;

  // Identifica automaticamente quale oggetto è smarrito e quale ritrovato.
  const lost = first.type === "lost" ? first : second;

  const found = first.type === "found" ? first : second;

  const matches = getData(STORAGE.MATCHES);

  // Controlla che la stessa corrispondenza non sia già attiva.
  const exists = matches.some(
    (match) =>
      match.lostReportId === lost.id &&
      match.foundReportId === found.id &&
      match.status !== "rejected",
  );

  if (exists) {
    toast("Questo match è già stato proposto.");
    return;
  }

  // Crea il match predisponendo domanda e risposta di verifica.
  const match = {
    id: uid(),
    lostReportId: lost.id,
    foundReportId: found.id,
    proposedBy: getCurrentUser().id,
    score: calculateMatchScore(lost, found),
    status: "proposed",
    verificationQuestion: "",
    questionAskedBy: null,
    questionAskedAt: null,
    verificationAnswer: "",
    answerGivenBy: null,
    answerGivenAt: null,
    createdAt: nowISO(),
  };

  matches.unshift(match);
  setData(STORAGE.MATCHES, matches);

  // Porta entrambe le segnalazioni nello stato di verifica.
  [lost, found].forEach((report) => {
    if (report.status === "open") {
      report.status = "checking";
    }

    report.history.push({
      id: uid(),
      date: nowISO(),
      text: "È stato proposto un possibile match.",
    });
  });

  setData(STORAGE.REPORTS, reports);

  // Informa entrambi gli utenti della nuova corrispondenza.
  addNotification(lost.userId, `Nuovo match proposto per "${lost.title}".`);

  addNotification(found.userId, `Nuovo match proposto per "${found.title}".`);

  closeModal();
  toast("Match proposto.");
  showSection("matches");
};

/* ==================== VISUALIZZAZIONE MATCH ==================== */

// Visualizza match suggeriti oppure match già proposti.
function renderMatches() {
  const user = getCurrentUser();

  if (!user) return;

  const container = $("#matchList");

  // Visualizza le corrispondenze generate automaticamente.
  if (currentMatchTab === "suggested") {
    const suggestions = getSuggestedMatchesForUser();

    if (!suggestions.length) {
      container.innerHTML = `
                <div class="empty-state">
                    Nessun match automatico disponibile.
                </div>
            `;
      return;
    }

    container.innerHTML = suggestions
      .map(
        (item) => `
                <div class="match-card">

                    <div>
                        <h3>
                            ${escapeHTML(item.myReport.title)}
                            ↔
                            ${escapeHTML(item.otherReport.title)}
                        </h3>

                        <p>
                            ${escapeHTML(item.myReport.place)}
                            ·
                            ${escapeHTML(item.otherReport.place)}
                        </p>

                        <br>

                        <button
                            class="small-button"
                            onclick="
                                proposeMatch(
                                    '${item.myReport.id}',
                                    '${item.otherReport.id}'
                                )
                            "
                        >
                            Proponi match
                        </button>
                    </div>

                    <div class="match-score">
                        ${item.score}%
                    </div>

                </div>
            `,
      )
      .join("");

    return;
  }

  const reports = getData(STORAGE.REPORTS);

  // Recupera solamente i match che coinvolgono l'utente corrente.
  const matches = getData(STORAGE.MATCHES).filter((match) => {
    const lost = reports.find((report) => report.id === match.lostReportId);

    const found = reports.find((report) => report.id === match.foundReportId);

    return lost?.userId === user.id || found?.userId === user.id;
  });

  if (!matches.length) {
    container.innerHTML = `
            <div class="empty-state">
                Nessun match proposto.
            </div>
        `;
    return;
  }

  // Genera l'interfaccia specifica per il ruolo dell'utente nel match.
  container.innerHTML = matches
    .map((match) => {
      const lost = reports.find((report) => report.id === match.lostReportId);

      const found = reports.find((report) => report.id === match.foundReportId);

      if (!lost || !found) return "";

      // Determina chi ha perso e chi ha trovato l'oggetto.
      const isLostOwner = user.id === lost.userId;

      const isFoundOwner = user.id === found.userId;

      // Mantiene compatibili eventuali match creati con versioni precedenti.
      if (match.questionAskedBy === undefined) {
        match.questionAskedBy = match.verificationQuestion
          ? found.userId
          : null;
      }

      if (match.answerGivenBy === undefined) {
        match.answerGivenBy = match.verificationAnswer ? lost.userId : null;
      }

      let verificationHTML = "";

      // Se manca la domanda, chi ha trovato l'oggetto può formularla.
      if (!match.verificationQuestion) {
        if (isFoundOwner) {
          verificationHTML = `
                        <div class="verification-box">

                            <span class="verification-state">
                                Verifica richiesta
                            </span>

                            <strong>
                                Devi verificare il proprietario.
                            </strong>

                            <p>
                                Fai una domanda relativa a un
                                dettaglio dell'oggetto che non
                                dovrebbe essere noto pubblicamente.
                            </p>

                            <div class="verification-actions">
                                <button
                                    class="small-button"
                                    onclick="openVerification('${match.id}')"
                                >
                                    Fai una domanda
                                </button>
                            </div>

                        </div>
                    `;
        } else if (isLostOwner) {
          // Chi ha perso l'oggetto attende la domanda di verifica.
          verificationHTML = `
                        <div class="verification-box">

                            <span class="verification-state">
                                In attesa
                            </span>

                            <strong>Match proposto.</strong>

                            <p>
                                L'utente che ha ritrovato
                                l'oggetto non ha ancora inviato
                                una domanda di verifica.
                            </p>

                        </div>
                    `;
        }

        // Se esiste una domanda, chi ha perso l'oggetto può rispondere.
      } else if (!match.verificationAnswer) {
        if (isLostOwner) {
          verificationHTML = `
                        <div class="verification-box">

                            <span class="verification-state">
                                Domanda ricevuta
                            </span>

                            <strong>
                                ${escapeHTML(match.verificationQuestion)}
                            </strong>

                            <p>
                                Rispondi alla domanda di verifica
                                formulata dall'utente che ha
                                ritrovato l'oggetto.
                            </p>

                            <div class="verification-actions">
                                <button
                                    class="small-button"
                                    onclick="openVerification('${match.id}')"
                                >
                                    Rispondi
                                </button>
                            </div>

                        </div>
                    `;
        } else if (isFoundOwner) {
          // Chi ha trovato l'oggetto attende la risposta.
          verificationHTML = `
                        <div class="verification-box">

                            <span class="verification-state">
                                Risposta in attesa
                            </span>

                            <strong>Domanda inviata:</strong>

                            <p>
                                ${escapeHTML(match.verificationQuestion)}
                            </p>

                            <p>
                                Il proprietario dell'oggetto
                                smarrito non ha ancora risposto.
                            </p>

                        </div>
                    `;
        }
      } else {
        // Dopo la risposta vengono mostrate domanda e risposta.
        verificationHTML = `
                    <div class="verification-box">

                        <span class="verification-state">
                            Verifica completata
                        </span>

                        <strong>Domanda</strong>

                        <p>
                            ${escapeHTML(match.verificationQuestion)}
                        </p>

                        <strong>Risposta</strong>

                        <p>
                            ${escapeHTML(match.verificationAnswer)}
                        </p>

                        ${
                          isFoundOwner &&
                          !["confirmed", "rejected"].includes(match.status)
                            ? `
                                    <div class="verification-actions">

                                        <button
                                            class="small-button"
                                            onclick="confirmMatch('${match.id}')"
                                        >
                                            Conferma match
                                        </button>

                                        <button
                                            class="small-button danger-button"
                                            onclick="rejectMatch('${match.id}')"
                                        >
                                            Rifiuta match
                                        </button>

                                    </div>
                                `
                            : ""
                        }

                    </div>
                `;
      }

      // Costruisce la scheda completa del match.
      return `
                <div class="match-card">

                    <div>

                        <h3>
                            ${escapeHTML(lost.title)}
                            ↔
                            ${escapeHTML(found.title)}
                        </h3>

                        <p>
                            Stato:
                            <strong>${escapeHTML(match.status)}</strong>
                        </p>

                        <p>
                            Smarrito da:
                            <strong>
                                ${escapeHTML(
                                  getUserById(lost.userId)?.name || "Utente",
                                )}
                            </strong>
                        </p>

                        <p>
                            Ritrovato da:
                            <strong>
                                ${escapeHTML(
                                  getUserById(found.userId)?.name || "Utente",
                                )}
                            </strong>
                        </p>

                        ${verificationHTML}

                        ${
                          isFoundOwner &&
                          !["confirmed", "rejected"].includes(match.status) &&
                          !match.verificationAnswer
                            ? `
                                    <div class="verification-actions">

                                        <button
                                            class="small-button danger-button"
                                            onclick="rejectMatch('${match.id}')"
                                        >
                                            Rifiuta match
                                        </button>

                                    </div>
                                `
                            : ""
                        }

                    </div>

                    <div class="match-score">
                        ${match.score}%
                    </div>

                </div>
            `;
    })
    .join("");

  // Salva eventuali aggiornamenti di compatibilità dei vecchi match.
  setData(STORAGE.MATCHES, matches);
}

/* ==================== SCHEDE MATCH ==================== */

// Cambia tra match suggeriti e match proposti.
$$("[data-match-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    $$("[data-match-tab]").forEach((item) => {
      item.classList.remove("active");
    });

    button.classList.add("active");

    currentMatchTab = button.dataset.matchTab;

    renderMatches();
  });
});

/* ==================== VERIFICA MATCH ==================== */

// Gestione domanda e risposta in base al ruolo dell'utente.
window.openVerification = function (matchId) {
  if (!requireLogin()) return;

  const matches = getData(STORAGE.MATCHES);

  const match = matches.find((item) => item.id === matchId);

  if (!match) return;

  const reports = getData(STORAGE.REPORTS);

  const lost = reports.find((report) => report.id === match.lostReportId);

  const found = reports.find((report) => report.id === match.foundReportId);

  if (!lost || !found) return;

  const user = getCurrentUser();

  const isFoundOwner = user.id === found.userId;

  const isLostOwner = user.id === lost.userId;

  // Chi ha trovato l'oggetto può formulare la domanda.
  if (isFoundOwner && !match.verificationQuestion) {
    openModal(`
            <h2>Domanda di verifica</h2>

            <p>
                Inserisci una domanda relativa a un
                dettaglio non pubblico dell'oggetto.
            </p>

            <form id="verificationQuestionForm">

                <label>
                    Domanda

                    <textarea
                        id="verificationQuestion"
                        rows="4"
                        maxlength="300"
                        required
                        placeholder="Es. Che forma ha il ciondolo?"
                    ></textarea>
                </label>

                <button class="button dark-button">
                    Invia domanda
                </button>

            </form>
        `);

    // Salva la domanda ed avvisa il proprietario dell'oggetto smarrito.
    $("#verificationQuestionForm").addEventListener("submit", (event) => {
      event.preventDefault();

      const updatedMatches = getData(STORAGE.MATCHES);

      const target = updatedMatches.find((item) => item.id === matchId);

      if (!target) return;

      // Controlla nuovamente che la domanda provenga da chi ha trovato l'oggetto.
      if (getCurrentUser().id !== found.userId) {
        toast("Non sei autorizzato a formulare questa domanda.");
        return;
      }

      target.verificationQuestion = $("#verificationQuestion").value.trim();

      target.questionAskedBy = found.userId;

      target.questionAskedAt = nowISO();

      target.status = "verification";

      setData(STORAGE.MATCHES, updatedMatches);

      addHistory(lost.id, "È stata ricevuta una domanda di verifica.");

      addHistory(found.id, "È stata inviata una domanda di verifica.");

      addNotification(
        lost.userId,
        `Hai ricevuto una domanda di verifica per "${lost.title}".`,
      );

      closeModal();
      toast("Domanda di verifica inviata.");
      renderMatches();
    });

    return;
  }

  // Chi ha perso l'oggetto può rispondere alla domanda ricevuta.
  if (isLostOwner && match.verificationQuestion && !match.verificationAnswer) {
    openModal(`
            <h2>Rispondi alla verifica</h2>

            <div class="verification-box">

                <strong>Domanda</strong>

                <p>
                    ${escapeHTML(match.verificationQuestion)}
                </p>

            </div>

            <form id="verificationAnswerForm">

                <label>
                    Risposta

                    <textarea
                        id="verificationAnswer"
                        rows="4"
                        maxlength="300"
                        required
                        placeholder="Scrivi la tua risposta..."
                    ></textarea>
                </label>

                <button class="button dark-button">
                    Invia risposta
                </button>

            </form>
        `);

    // Salva la risposta e avvisa chi ha trovato l'oggetto.
    $("#verificationAnswerForm").addEventListener("submit", (event) => {
      event.preventDefault();

      const updatedMatches = getData(STORAGE.MATCHES);

      const target = updatedMatches.find((item) => item.id === matchId);

      if (!target) return;

      // Controlla che la risposta provenga dal proprietario dell'oggetto smarrito.
      if (getCurrentUser().id !== lost.userId) {
        toast("Non sei autorizzato a rispondere a questa verifica.");
        return;
      }

      target.verificationAnswer = $("#verificationAnswer").value.trim();

      target.answerGivenBy = lost.userId;

      target.answerGivenAt = nowISO();

      target.status = "verification";

      setData(STORAGE.MATCHES, updatedMatches);

      addHistory(
        lost.id,
        "È stata fornita una risposta alla domanda di verifica.",
      );

      addHistory(
        found.id,
        "È stata ricevuta una risposta alla domanda di verifica.",
      );

      addNotification(
        found.userId,
        `È arrivata una risposta alla verifica relativa a "${found.title}".`,
      );

      closeModal();
      toast("Risposta inviata.");
      renderMatches();
    });

    return;
  }

  // Informa chi ha trovato l'oggetto che deve attendere la risposta.
  if (isFoundOwner && match.verificationQuestion && !match.verificationAnswer) {
    toast("La domanda è già stata inviata. Attendi la risposta.");
    return;
  }

  // Informa chi ha perso l'oggetto che deve attendere la domanda.
  if (isLostOwner && !match.verificationQuestion) {
    toast(
      "L'utente che ha ritrovato l'oggetto non ha ancora formulato la domanda.",
    );
    return;
  }

  // Impedisce di ripetere una verifica già completata.
  toast("La verifica è già stata completata.");
};

/* ==================== CONFERMA MATCH ==================== */

// Conferma definitivamente un match dopo la verifica.
window.confirmMatch = function (matchId) {
  if (!requireLogin()) return;

  const matches = getData(STORAGE.MATCHES);

  const match = matches.find((item) => item.id === matchId);

  if (!match) return;

  const reports = getData(STORAGE.REPORTS);

  const lost = reports.find((report) => report.id === match.lostReportId);

  const found = reports.find((report) => report.id === match.foundReportId);

  if (!lost || !found) return;

  // Solo chi ha trovato l'oggetto può confermare il match.
  if (getCurrentUser().id !== found.userId) {
    toast(
      "Solo chi ha ritrovato l'oggetto può confermare il match dopo la verifica.",
    );
    return;
  }

  // La conferma richiede domanda e risposta già completate.
  if (!match.verificationQuestion || !match.verificationAnswer) {
    toast("Completa prima la domanda e la risposta di verifica.");
    return;
  }

  if (!confirm("Confermare che i due oggetti corrispondono?")) {
    return;
  }

  // Imposta il match come confermato.
  match.status = "confirmed";

  setData(STORAGE.MATCHES, matches);

  // Imposta entrambe le segnalazioni come risolte.
  [lost, found].forEach((report) => {
    report.status = "resolved";

    if (!Array.isArray(report.history)) {
      report.history = [];
    }

    report.history.push({
      id: uid(),
      date: nowISO(),
      text: "Match confermato dopo la verifica. Segnalazione risolta.",
    });

    addNotification(
      report.userId,
      `Il match per "${report.title}" è stato confermato.`,
    );
  });

  setData(STORAGE.REPORTS, reports);

  toast("Match confermato. Le segnalazioni sono state risolte.");

  renderMatches();
};

/* ==================== RIFIUTO MATCH ==================== */

// Permette a chi ha trovato l'oggetto di rifiutare la corrispondenza.
window.rejectMatch = function (matchId) {
  if (!requireLogin()) return;

  const matches = getData(STORAGE.MATCHES);

  const match = matches.find((item) => item.id === matchId);

  if (!match) return;

  const reports = getData(STORAGE.REPORTS);

  const lost = reports.find((report) => report.id === match.lostReportId);

  const found = reports.find((report) => report.id === match.foundReportId);

  if (!lost || !found) return;

  // Impedisce agli altri utenti di rifiutare definitivamente il match.
  if (getCurrentUser().id !== found.userId) {
    toast(
      "Solo chi ha ritrovato l'oggetto può rifiutare definitivamente questo match.",
    );
    return;
  }

  if (!confirm("Rifiutare questa corrispondenza?")) {
    return;
  }

  // Imposta il match come rifiutato.
  match.status = "rejected";

  setData(STORAGE.MATCHES, matches);

  // Riporta le segnalazioni in stato aperto quando necessario.
  [lost, found].forEach((report) => {
    if (report.status === "checking") {
      report.status = "open";
    }

    if (!Array.isArray(report.history)) {
      report.history = [];
    }

    report.history.push({
      id: uid(),
      date: nowISO(),
      text: "Il match proposto è stato rifiutato.",
    });

    addNotification(
      report.userId,
      `Il match relativo a "${report.title}" è stato rifiutato.`,
    );
  });

  setData(STORAGE.REPORTS, reports);

  toast("Match rifiutato.");
  renderMatches();
};

/* ==================== NOTIFICHE ==================== */

// Crea una nuova notifica destinata a un utente.
function addNotification(userId, text) {
  const notifications = getData(STORAGE.NOTIFICATIONS);

  notifications.unshift({
    id: uid(),
    userId,
    text,
    createdAt: nowISO(),
    read: false,
  });

  setData(STORAGE.NOTIFICATIONS, notifications);

  updateCounters();
}

// Visualizza le notifiche dell'utente nella dashboard.
function renderNotifications() {
  const user = getCurrentUser();

  if (!user) return;

  const notifications = getData(STORAGE.NOTIFICATIONS)
    .filter((notification) => notification.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const container = $("#notificationList");

  if (!notifications.length) {
    container.innerHTML = `
            <div class="empty-state">
                Nessuna notifica.
            </div>
        `;
    return;
  }

  container.innerHTML = notifications
    .map(
      (notification) => `
            <div class="list-item">

                <div>
                    <p>
                        ${escapeHTML(notification.text)}
                    </p>
                </div>

                <span class="list-date">
                    ${formatDateTime(notification.createdAt)}
                </span>

            </div>
        `,
    )
    .join("");
}

// Segna come lette tutte le notifiche dell'utente.
function markNotificationsRead() {
  const user = getCurrentUser();

  if (!user) return;

  const notifications = getData(STORAGE.NOTIFICATIONS);

  notifications.forEach((notification) => {
    if (notification.userId === user.id) {
      notification.read = true;
    }
  });

  setData(STORAGE.NOTIFICATIONS, notifications);

  updateCounters();
}

// Apre la dashboard e segna le notifiche come lette.
$("#notificationButton").addEventListener("click", () => {
  showSection("dashboard");
  markNotificationsRead();
  renderNotifications();
});

/* ==================== CONTATORI ==================== */

// Aggiorna il numero di notifiche e messaggi non letti.
function updateCounters() {
  const user = getCurrentUser();

  if (!user) {
    $("#notificationCounter").textContent = "0";
    $("#messageCounter").textContent = "0";
    return;
  }

  const unreadNotifications = getData(STORAGE.NOTIFICATIONS).filter(
    (item) => item.userId === user.id && !item.read,
  ).length;

  const unreadMessages = getData(STORAGE.MESSAGES).filter(
    (item) => item.toUserId === user.id && !item.read,
  ).length;

  $("#notificationCounter").textContent = unreadNotifications;

  $("#messageCounter").textContent = unreadMessages;
}

/* ==================== DASHBOARD ==================== */

// Genera statistiche, segnalazioni e notifiche personali.
function renderDashboard() {
  const user = getCurrentUser();

  if (!user) return;

  const reports = getData(STORAGE.REPORTS);

  const mine = reports.filter((report) => report.userId === user.id);

  const matches = getData(STORAGE.MATCHES);

  const myReportIds = new Set(mine.map((report) => report.id));

  // Seleziona tutti i match collegati alle segnalazioni personali.
  const myMatches = matches.filter(
    (match) =>
      myReportIds.has(match.lostReportId) ||
      myReportIds.has(match.foundReportId),
  );

  // Mostra le principali statistiche dell'utente.
  $("#dashboardStats").innerHTML = `
        <div class="stat-card">
            <strong>${mine.length}</strong>
            <span>Segnalazioni</span>
        </div>

        <div class="stat-card">
            <strong>
                ${mine.filter((report) => report.status === "open").length}
            </strong>
            <span>Aperte</span>
        </div>

        <div class="stat-card">
            <strong>${myMatches.length}</strong>
            <span>Match</span>
        </div>

        <div class="stat-card">
            <strong>
                ${mine.filter((report) => report.status === "resolved").length}
            </strong>
            <span>Risolte</span>
        </div>
    `;

  // Mostra le segnalazioni personali e il relativo stato di moderazione.
  $("#myReports").innerHTML = mine.length
    ? mine
        .map((report) => {
          const moderation = `
                        <div
                            style="
                                padding: 0 25px 12px;
                                font-size: .72rem;
                                color: #777;
                            "
                        >
                            Moderazione:
                            ${moderationLabel(report.moderation)}
                        </div>
                    `;

          return reportCard(report).replace(
            `<div class="card-footer">`,
            moderation + `<div class="card-footer">`,
          );
        })
        .join("")
    : `
                <div class="empty-state">
                    Non hai ancora pubblicato segnalazioni.
                </div>
            `;

  renderNotifications();
}

/* ==================== MODERAZIONE ==================== */

// Mostra al moderatore le segnalazioni ancora da revisionare.
function renderModeration() {
  const user = getCurrentUser();

  if (!user || user.role !== "moderator") return;

  const pending = getData(STORAGE.REPORTS).filter(
    (report) => report.moderation === "pending",
  );

  const container = $("#moderationList");

  if (!pending.length) {
    container.innerHTML = `
            <div class="empty-state">
                Non ci sono segnalazioni da revisionare.
            </div>
        `;
    return;
  }

  // Genera una scheda con i comandi Approva e Rifiuta.
  container.innerHTML = pending
    .map(
      (report) => `
            <article class="report-card">

                <div class="report-image">

                    ${
                      report.image
                        ? `
                                <img
                                    src="${report.image}"
                                    alt="${escapeHTML(report.title)}"
                                >
                            `
                        : `
                                <div class="image-placeholder">
                                    IMMAGINE NON DISPONIBILE
                                </div>
                            `
                    }

                    <span class="card-tag ${report.type}">
                        ${typeLabel(report.type)}
                    </span>

                </div>

                <div class="card-body">

                    <div class="card-meta">
                        <span>${escapeHTML(report.category)}</span>
                        <span>${formatDate(report.date)}</span>
                    </div>

                    <h3>${escapeHTML(report.title)}</h3>

                    <p>${escapeHTML(report.description)}</p>

                </div>

                <div class="card-footer">

                    <button
                        class="small-button"
                        onclick="
                            moderateReport(
                                '${report.id}',
                                'approved'
                            )
                        "
                    >
                        Approva
                    </button>

                    <button
                        class="small-button danger-button"
                        onclick="
                            moderateReport(
                                '${report.id}',
                                'rejected'
                            )
                        "
                    >
                        Rifiuta
                    </button>

                </div>

            </article>
        `,
    )
    .join("");
}

// Approva o rifiuta una segnalazione in attesa.
window.moderateReport = function (reportId, decision) {
  const user = getCurrentUser();

  if (!user || user.role !== "moderator") return;

  const reports = getData(STORAGE.REPORTS);

  const report = reports.find((item) => item.id === reportId);

  if (!report) return;

  // Registra la decisione del moderatore.
  report.moderation = decision;

  report.history.push({
    id: uid(),
    date: nowISO(),
    text:
      decision === "approved"
        ? "Segnalazione approvata dalla moderazione."
        : "Segnalazione rifiutata dalla moderazione.",
  });

  setData(STORAGE.REPORTS, reports);

  // Invia una notifica e cerca match se la segnalazione viene approvata.
  if (decision === "approved") {
    addNotification(
      report.userId,
      `La segnalazione "${report.title}" è stata approvata.`,
    );

    notifyAutomaticMatches(report);
  } else {
    addNotification(
      report.userId,
      `La segnalazione "${report.title}" è stata rifiutata.`,
    );
  }

  renderModeration();

  toast(
    decision === "approved"
      ? "Segnalazione approvata."
      : "Segnalazione rifiutata.",
  );
};

/* ==================== NOTIFICHE MATCH AUTOMATICI ==================== */

// Ricerca di corrispondenze quando viene approvata una nuova segnalazione.
function notifyAutomaticMatches(newReport) {
  const candidates = getApprovedReports().filter(
    (report) =>
      report.id !== newReport.id &&
      report.type !== newReport.type &&
      report.userId !== newReport.userId,
  );

  candidates.forEach((candidate) => {
    const score = calculateMatchScore(newReport, candidate);

    // Notifica entrambi gli utenti se la compatibilità è elevata.
    if (score >= 60) {
      addNotification(
        newReport.userId,
        `Possibile corrispondenza (${score}%) con "${candidate.title}".`,
      );

      addNotification(
        candidate.userId,
        `È stata pubblicata una segnalazione simile a "${candidate.title}" (${score}%).`,
      );
    }
  });
}

/* ==================== MAPPA PUBBLICA ==================== */

// Crea un marcatore diverso per oggetti smarriti e ritrovati.
function markerIcon(type) {
  return L.divIcon({
    className: "",
    html: `
            <div
                class="custom-map-marker ${type}"
            ></div>
        `,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

// Visualizza sulla mappa tutte le segnalazioni approvate.
function renderPublicMap() {
  if (!window.L) return;

  // Crea la mappa solamente al primo utilizzo.
  if (!publicMap) {
    publicMap = L.map("publicMap").setView([45.4642, 9.19], 12);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
    }).addTo(publicMap);
  } else {
    // Rimuove i vecchi marcatori prima dell'aggiornamento.
    publicMap.eachLayer((layer) => {
      if (layer instanceof L.Marker) {
        publicMap.removeLayer(layer);
      }
    });

    publicMap.invalidateSize();
  }

  // Recupera solamente le segnalazioni con coordinate valide.
  const reports = getApprovedReports().filter(
    (report) => Number.isFinite(report.lat) && Number.isFinite(report.lng),
  );

  const bounds = [];

  // Inserisce un marcatore per ogni segnalazione.
  reports.forEach((report) => {
    const marker = L.marker([report.lat, report.lng], {
      icon: markerIcon(report.type),
    }).addTo(publicMap);

    // Mostra le informazioni principali cliccando il marcatore.
    marker.bindPopup(`
            <strong>
                ${escapeHTML(report.title)}
            </strong>

            <br>

            ${typeLabel(report.type)}

            <br>

            ${escapeHTML(report.place)}

            <br><br>

            <button
                onclick="openReport('${report.id}')"
            >
                Apri
            </button>
        `);

    bounds.push([report.lat, report.lng]);
  });

  // Adatta automaticamente lo zoom ai marcatori presenti.
  if (bounds.length) {
    publicMap.fitBounds(bounds, {
      padding: [40, 40],
      maxZoom: 15,
    });
  }
}

/* ==================== QR CODE ==================== */

// Generazione di un QR Code che collega direttamente alla segnalazione.
window.showQRCode = function (reportId) {
  const report = getData(STORAGE.REPORTS).find((item) => item.id === reportId);

  if (!report) return;

  const baseURL = window.location.href.split("#")[0];

  const url = `${baseURL}#report=${encodeURIComponent(reportId)}`;

  openModal(`
        <h2>QR Code</h2>

        <p>
            Scansiona il codice per aprire direttamente
            la segnalazione.
        </p>

        <div id="qrCode"></div>

        <button
            class="button dark-button"
            onclick="printQR()"
        >
            Stampa QR Code
        </button>
    `);

  // Utilizza la libreria esterna per creare graficamente il QR.
  if (window.QRCode) {
    new QRCode(document.getElementById("qrCode"), {
      text: url,
      width: 220,
      height: 220,
    });
  } else {
    $("#qrCode").textContent = "Libreria QR Code non disponibile.";
  }
};

// Apre una pagina semplificata per stampare il QR Code.
window.printQR = function () {
  const qr = $("#qrCode");

  if (!qr) return;

  const popup = window.open("", "_blank", "width=600,height=700");

  // Avvisa se il browser impedisce l'apertura della finestra.
  if (!popup) {
    toast("Il browser ha bloccato la finestra di stampa.");
    return;
  }

  popup.document.write(`
        <!DOCTYPE html>

        <html lang="it">

        <head>
            <title>QR Code</title>

            <style>
                body {
                    font-family: Arial, sans-serif;
                    text-align: center;
                    padding: 60px;
                }

                img,
                canvas {
                    max-width: 300px;
                }
            </style>
        </head>

        <body>

            <h1>Museo delle Cose Perdute</h1>

            <p>
                Scansiona il QR Code per visualizzare
                la segnalazione.
            </p>

            ${qr.innerHTML}

        </body>

        </html>
    `);

  popup.document.close();

  // Avviamento della finestra di stampa dopo il caricamento del contenuto.
  setTimeout(() => {
    popup.print();
  }, 400);
};

/* ==================== FINESTRE MODALI ==================== */

// Mostra una finestra modale con contenuto dinamico.
function openModal(content) {
  modalContent.innerHTML = content;
  modalOverlay.classList.remove("hidden");
}

// Chiude e svuota la finestra modale.
function closeModal() {
  modalOverlay.classList.add("hidden");
  modalContent.innerHTML = "";
}

// Chiude la finestra tramite il pulsante X.
modalClose.addEventListener("click", closeModal);

// Chiude la finestra cliccando sullo sfondo.
modalOverlay.addEventListener("click", (event) => {
  if (event.target === modalOverlay) {
    closeModal();
  }
});

// Permette di chiudere menu e modali con il tasto Escape.
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal();
    closeMenu();
  }
});

/* ==================== APERTURA TRAMITE QR ==================== */

// Controlla se l'URL contiene l'identificatore di una segnalazione.
function openReportFromHash() {
  const hash = window.location.hash;

  if (!hash.startsWith("#report=")) {
    return false;
  }

  const reportId = decodeURIComponent(hash.replace("#report=", ""));

  const report = getData(STORAGE.REPORTS).find((item) => item.id === reportId);

  // Apre solamente segnalazioni pubbliche già approvate.
  if (report && report.moderation === "approved") {
    openReport(reportId);
    return true;
  }

  return false;
}

// Controlla nuovamente il QR se cambia l'indirizzo della pagina.
window.addEventListener("hashchange", openReportFromHash);

/* ==================== INIZIALIZZAZIONE DATI ==================== */

// Crea nel localStorage gli archivi ancora inesistenti.
function initializeStorage() {
  // Il database viene creato dal server e non richiede archivi nel browser.
}

/* ==================== AVVIO APPLICAZIONE ==================== */

// Inizializza dati, account, archivio e pagina iniziale.
async function initializeApp() {
  initializeStorage();
  try {
    await refreshServerData();
  } catch (error) {
    toast(error.message);
    return;
  }
  updateAccountUI();
  renderArchive();

  // Controlla se il sito è stato aperto tramite un QR Code.
  const openedFromQR = openReportFromHash();

  // Se non esiste un collegamento diretto mostra la homepage.
  if (!openedFromQR) {
    showSection("home");
  }
}

// Aggiorna i dati condivisi quando la pagina torna in primo piano.
window.addEventListener("focus", async () => {
  await writeQueue;
  try {
    await refreshServerData();
    updateAccountUI();
  } catch (error) {
    toast(error.message);
  }
});

// Avvia l'intera applicazione.
initializeApp();
