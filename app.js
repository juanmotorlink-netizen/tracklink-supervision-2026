
const $ = id => document.getElementById(id);
const DB_NAME = "tracklink-supervision-2026";
const STORE = "records";
const AUTH_KEY = "tracklink-local-auth-v1";

let records = [];
let pendingPhotos = [];
let editingRecord = null;
let currentUser = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function localAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function localPut(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function localDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function hashPassword(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map(x => x.toString(16).padStart(2, "0")).join("");
}

function showApp() {
  $("login").hidden = true;
  $("app").hidden = false;
  $("session").innerHTML = "";

  const label = document.createElement("span");
  label.textContent = `Usuario: ${currentUser}`;

  const logout = document.createElement("button");
  logout.type = "button";
  logout.className = "secondary";
  logout.textContent = "Salir";
  logout.onclick = () => {
    currentUser = null;
    $("app").hidden = true;
    $("login").hidden = false;
    $("password").value = "";
    $("session").innerHTML = "";
  };

  $("session").append(label, logout);
}

async function refresh() {
  records = await localAll();
  renderRecords();
  renderStats();
}

function getVal(id) {
  return $(id).value;
}

function signature(id) {
  return $(id).toDataURL("image/png");
}

function setupCanvas(id) {
  const canvas = $(id);
  const ctx = canvas.getContext("2d");
  let drawing = false;

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height
    };
  }

  canvas.width = 900;
  canvas.height = 300;

  canvas.addEventListener("pointerdown", event => {
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  });

  canvas.addEventListener("pointermove", event => {
    if (!drawing) return;
    const p = point(event);
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#142f45";
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });

  const stop = () => drawing = false;
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
}

["sigTecnico", "sigSupervisor"].forEach(setupCanvas);

document.querySelectorAll(".clearSig").forEach(button => {
  button.addEventListener("click", () => {
    const canvas = $(button.dataset.canvas);
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  });
});

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function addFiles(fileList) {
  for (const file of Array.from(fileList || [])) {
    if (!file.type.startsWith("image/")) continue;
    try {
      pendingPhotos.push({
        name: file.name,
        data: await fileToDataURL(file)
      });
    } catch (error) {
      console.error("No se pudo leer una fotografía", error);
      alert(`No se pudo agregar ${file.name}.`);
    }
  }
  renderPreview();
}

function renderPreview() {
  const preview = $("preview");
  preview.innerHTML = "";

  pendingPhotos.forEach((photo, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "photo-item";

    const img = document.createElement("img");
    img.src = photo.data;
    img.alt = photo.name || "Evidencia fotográfica";
    img.title = photo.name || "Fotografía";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Quitar";
    remove.onclick = () => {
      pendingPhotos.splice(index, 1);
      renderPreview();
    };

    wrapper.append(img, remove);
    preview.append(wrapper);
  });
}

$("photos").addEventListener("change", event => addFiles(event.target.files));
$("gallery").addEventListener("change", event => addFiles(event.target.files));

function clearSignatures() {
  ["sigTecnico", "sigSupervisor"].forEach(id => {
    const canvas = $(id);
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  });
}

function resetForm() {
  $("recordForm").reset();
  $("recordId").value = "";
  editingRecord = null;
  pendingPhotos = [];
  renderPreview();
  clearSignatures();

  $("fecha").value = new Date().toISOString().slice(0, 10);
  $("hora").value = new Date().toTimeString().slice(0, 5);
  $("saveMsg").textContent = "";
  $("photos").value = "";
  $("gallery").value = "";
}

$("clearForm").addEventListener("click", resetForm);

function readRecordForm() {
  return {
    id: $("recordId").value || crypto.randomUUID(),
    fecha: getVal("fecha"),
    hora: getVal("hora"),
    orte: getVal("orte").trim(),
    tecnico: getVal("tecnico").trim(),
    cliente: getVal("cliente").trim(),
    chasis: getVal("chasis").trim(),
    supervisor: getVal("supervisor").trim(),
    zapato: getVal("zapato"),
    pantalon: getVal("pantalon"),
    polo: getVal("polo"),
    casaca: getVal("casaca"),
    orteOk: getVal("orteOk"),
    senales: getVal("senales"),
    camuflaje: getVal("camuflaje"),
    herramientas: getVal("herramientas"),
    observaciones: getVal("observaciones").trim(),
    firmaTecnico: signature("sigTecnico"),
    firmaSupervisor: signature("sigSupervisor"),
    photos: pendingPhotos.slice(),
    createdAt: editingRecord?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    savedBy: currentUser
  };
}

$("recordForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const record = readRecordForm();
    await localPut(record);
    $("saveMsg").textContent =
      "Registro guardado correctamente en este dispositivo.";
    resetForm();
    await refresh();
  } catch (error) {
    console.error(error);
    $("saveMsg").textContent =
      "No se pudo guardar. Verifica el espacio disponible del dispositivo.";
  }
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function renderRecords() {
  const container = $("records");
  container.innerHTML = "";

  const ordered = [...records].sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || "")
  );

  if (!ordered.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent =
      "Todavía no hay registros guardados en este dispositivo.";
    container.append(empty);
    return;
  }

  ordered.forEach(record => {
    const card = document.createElement("div");
    card.className = "record";

    const info = document.createElement("div");
    const title = document.createElement("b");
    title.textContent =
      `${record.orte || "Sin ORTE"} · ${record.tecnico || "Sin técnico"}`;

    const detail = document.createElement("small");
    detail.textContent =
      `${record.fecha || ""} · ${record.cliente || ""} · ${(record.photos || []).length} fotografía(s)`;

    info.append(title, detail);

    const actions = document.createElement("div");
    actions.className = "actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary";
    edit.textContent = "Editar";
    edit.onclick = () => editRecord(record);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Borrar registro";
    remove.onclick = () => deleteRecord(record);

    actions.append(edit, remove);
    card.append(info, actions);
    container.append(card);
  });
}

function editRecord(record) {
  const fields = [
    "fecha", "hora", "orte", "tecnico", "cliente", "chasis",
    "supervisor", "zapato", "pantalon", "polo", "casaca",
    "orteOk", "senales", "camuflaje", "herramientas",
    "observaciones"
  ];

  fields.forEach(id => {
    $(id).value = record[id] ?? "";
  });

  $("recordId").value = record.id;
  editingRecord = record;
  pendingPhotos = (record.photos || []).map(photo => ({ ...photo }));
  renderPreview();

  ["sigTecnico", "sigSupervisor"].forEach((id, index) => {
    const canvas = $(id);
    const data = index === 0 ? record.firmaTecnico : record.firmaSupervisor;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (data) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = data;
    }
  });

  document.querySelector('[data-tab="registro"]').click();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteRecord(record) {
  const reference = record.orte || record.id;

  if (!confirm(
    `¿Seguro que deseas borrar el registro ${reference}? Esta acción no se puede deshacer.`
  )) return;

  await localDelete(record.id);
  await refresh();
}

function renderStats() {
  const total = records.length;
  const byTech = {};
  const byMonth = {};

  records.forEach(record => {
    const tech = record.tecnico || "Sin técnico";
    byTech[tech] = (byTech[tech] || 0) + 1;

    const month = (record.fecha || "").slice(0, 7) || "Sin fecha";
    byMonth[month] = (byMonth[month] || 0) + 1;
  });

  const stats = $("stats");
  stats.innerHTML = "";

  const summary = document.createElement("div");
  summary.className = "stat";
  summary.innerHTML = `<b>${total}</b>Supervisiones registradas`;

  const photos = document.createElement("div");
  photos.className = "stat";
  photos.innerHTML =
    `<b>${records.reduce((sum, record) => sum + (record.photos || []).length, 0)}</b>Fotografías guardadas`;

  stats.append(summary, photos);

  const techTitle = document.createElement("h2");
  techTitle.textContent = "Supervisiones por técnico";
  stats.append(techTitle);

  Object.entries(byTech).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
    const item = document.createElement("div");
    item.className = "stat";
    item.innerHTML = `<b>${count}</b>${escapeHtml(name)}`;
    stats.append(item);
  });

  const monthTitle = document.createElement("h2");
  monthTitle.textContent = "Supervisiones por mes";
  stats.append(monthTitle);

  Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0])).forEach(([month, count]) => {
    const item = document.createElement("div");
    item.className = "stat";
    item.innerHTML = `<b>${count}</b>${escapeHtml(month)}`;
    stats.append(item);
  });
}

$("exportBtn").addEventListener("click", () => {
  if (!window.XLSX) {
    alert("No se pudo cargar Excel. Conéctate a internet y vuelve a intentarlo.");
    return;
  }

  const rows = records.map(record => ({
    Fecha: record.fecha || "",
    Hora: record.hora || "",
    ORTE: record.orte || "",
    Técnico: record.tecnico || "",
    Cliente: record.cliente || "",
    "Placa o chasis": record.chasis || "",
    "Supervisado por": record.supervisor || "",
    Zapato: record.zapato || "",
    Pantalón: record.pantalon || "",
    Polo: record.polo || "",
    Casaca: record.casaca || "",
    "ORTE verificada": record.orteOk || "",
    "Puntos de señales": record.senales || "",
    Camuflaje: record.camuflaje || "",
    Herramientas: record.herramientas || "",
    "Recomendaciones y observaciones": record.observaciones || "",
    "Cantidad de fotografías": (record.photos || []).length
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Supervisiones");
  XLSX.writeFile(workbook, "TRACKLINK_SUPERVISION_2026.xlsx");
});

$("refreshBtn").addEventListener("click", refresh);

document.querySelectorAll("nav button").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach(item =>
      item.classList.toggle("active", item === button)
    );

    document.querySelectorAll(".tab").forEach(section => {
      section.hidden = section.id !== button.dataset.tab;
    });

    if (button.dataset.tab === "lista" ||
        button.dataset.tab === "estadisticas") {
      refresh();
    }
  });
});

$("loginBtn").addEventListener("click", async () => {
  const username = getVal("email").trim();
  const password = getVal("password");
  const message = $("loginMsg");

  if (username.length < 3 || password.length < 6) {
    message.textContent =
      "Ingresa un usuario de al menos 3 caracteres y una contraseña de al menos 6.";
    return;
  }

  try {
    const stored = localStorage.getItem(AUTH_KEY);
    const passwordHash = await hashPassword(password);

    if (!stored) {
      localStorage.setItem(AUTH_KEY, JSON.stringify({
        username,
        passwordHash,
        createdAt: new Date().toISOString()
      }));
      currentUser = username;
      message.textContent = "Acceso local creado.";
    } else {
      const account = JSON.parse(stored);

      if (account.username !== username ||
          account.passwordHash !== passwordHash) {
        message.textContent = "Usuario o contraseña incorrectos.";
        return;
      }

      currentUser = username;
    }

    showApp();
    resetForm();
    await refresh();
  } catch (error) {
    console.error(error);
    message.textContent =
      "No se pudo validar el acceso en este navegador.";
  }
});

$("email").setAttribute("type", "text");
$("email").setAttribute("autocomplete", "username");

const loginDescription = $("login").querySelector("p");
if (loginDescription) {
  loginDescription.textContent = "Ingresa con tu cuenta local de supervisor.";
}

const loginLabel = $("email").closest("label");
if (loginLabel) {
  loginLabel.firstChild.textContent = "Usuario";
}

$("loginMsg").textContent = localStorage.getItem(AUTH_KEY)
  ? "Ingresa con el usuario y contraseña que registraste en este dispositivo."
  : "Primer ingreso: escribe el usuario y la contraseña que deseas crear para este dispositivo.";

resetForm();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js")
    .catch(error => console.warn("Service worker", error));
}
