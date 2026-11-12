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
    "orteOk", "senales", "camuflaje", "herramientas", "observaciones"
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
      img.onload = () =>
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
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

  Object.entries(byTech).sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => {
      const item = document.createElement("div");
      item.className = "stat";
      item.innerHTML = `<b>${count}</b>${escapeHtml(name)}`;
      stats.append(item);
    });

  const monthTitle = document.createElement("h2");
  monthTitle.textContent = "Supervisiones por mes";
  stats.append(monthTitle);

  Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]))
    .forEach(([month, count]) => {
      const item = document.createElement("div");
      item.className = "stat";
      item.innerHTML = `<b>${count}</b>${escapeHtml(month)}`;
      stats.append(item);
    });
}

$("exportBtn").addEventListener("click", () => {
  if (!window.XLSX) {
    alert(
      "No se pudo cargar el módulo de Excel. Conéctate a internet y vuelve a intentarlo."
    );
    return;
  }

  if (!records.length) {
    alert("Todavía no hay registros para exportar.");
    return;
  }

  const checks = [
    ["Zapato", "zapato"],
    ["Pantalón", "pantalon"],
    ["Polo", "polo"],
    ["Casaca", "casaca"],
    ["ORTE verificada", "orteOk"],
    ["Puntos de señales", "senales"],
    ["Camuflaje", "camuflaje"],
    ["Uso de herramientas", "herramientas"]
  ];

  const totalPhotos = records.reduce(
    (sum, r) => sum + (r.photos || []).length, 0
  );

  const technicians = [
    ...new Set(records.map(r => (r.tecnico || "").trim()).filter(Boolean))
  ];

  let yesCount = 0;
  let noCount = 0;
  let applicableCount = 0;

  checks.forEach(([, key]) => records.forEach(r => {
    const value = String(r[key] || "").trim().toLowerCase();

    if (value === "sí" || value === "si") {
      yesCount++;
      applicableCount++;
    } else if (value === "no") {
      noCount++;
      applicableCount++;
    }
  }));

  const compliance = applicableCount ? yesCount / applicableCount : 0;
  const complianceText =
    `${(compliance * 100).toFixed(1).replace(".", ",")}%`;

  const monthMap = {};
  const techMap = {};
  const checkMap = {};

  records.forEach(r => {
    const month = (r.fecha || "").slice(0, 7) || "Sin fecha";
    monthMap[month] = (monthMap[month] || 0) + 1;

    const tech = (r.tecnico || "").trim() || "Sin técnico";
    techMap[tech] = (techMap[tech] || 0) + 1;

    checks.forEach(([label, key]) => {
      const value = String(r[key] || "").trim().toLowerCase();

      if (!checkMap[label]) {
        checkMap[label] = { si: 0, no: 0, na: 0 };
      }

      if (value === "sí" || value === "si") checkMap[label].si++;
      else if (value === "no") checkMap[label].no++;
      else if (value === "no aplica") checkMap[label].na++;
    });
  });

  const navy = "102B46";
  const blue = "087EAF";
  const pale = "EAF2F8";
  const white = "FFFFFF";
  const ink = "203448";
  const green = "DDF2E5";
  const red = "FCE4E4";

  const border = {
    top: { style: "thin", color: "D5E0E8" },
    bottom: { style: "thin", color: "D5E0E8" },
    left: { style: "thin", color: "D5E0E8" },
    right: { style: "thin", color: "D5E0E8" }
  };

  const wb = XLSX.utils.book_new();

  function paint(ws, range, style) {
    const decoded = XLSX.utils.decode_range(range);

    for (let row = decoded.s.r; row <= decoded.e.r; row++) {
      for (let col = decoded.s.c; col <= decoded.e.c; col++) {
        const address = XLSX.utils.encode_cell({ r: row, c: col });
        if (!ws[address]) ws[address] = { t: "s", v: "" };
        ws[address].s = {
          ...(ws[address].s || {}),
          ...style
        };
      }
    }
  }

  function merge(ws, range) {
    ws["!merges"] = ws["!merges"] || [];
    ws["!merges"].push(XLSX.utils.decode_range(range));
  }

  function addSection(ws, row, col, title, width) {
    const end = XLSX.utils.encode_cell({
      r: row - 1,
      c: col + width - 1
    });
    const begin = XLSX.utils.encode_cell({
      r: row - 1,
      c: col
    });
    const range = `${begin}:${end}`;

    merge(ws, range);
    ws[begin] = {
      t: "s",
      v: title,
      s: {
        fill: { fgColor: { rgb: navy } },
        font: { bold: true, color: { rgb: white }, sz: 11 },
        alignment: { vertical: "center" }
      }
    };

    paint(ws, range, {
      fill: { fgColor: { rgb: navy } },
      font: { bold: true, color: { rgb: white }, sz: 11 },
      alignment: { vertical: "center" }
    });

    ws["!rows"] = ws["!rows"] || [];
    ws["!rows"][row - 1] = { hpt: 23 };
  }

  // HOJA 1: DASHBOARD GERENCIAL
  const dash = XLSX.utils.aoa_to_sheet([]);

  merge(dash, "A1:H1");
  dash.A1 = {
    t: "s",
    v: "TRACKLINK | SUPERVISIÓN TÉCNICA 2026",
    s: {
      fill: { fgColor: { rgb: navy } },
      font: { bold: true, color: { rgb: white }, sz: 18 },
      alignment: { horizontal: "center", vertical: "center" }
    }
  };

  paint(dash, "A1:H1", {
    fill: { fgColor: { rgb: navy } },
    font: { bold: true, color: { rgb: white }, sz: 18 },
    alignment: { horizontal: "center", vertical: "center" }
  });

  merge(dash, "A2:H2");
  dash.A2 = {
    t: "s",
    v: `RESUMEN GERENCIAL · Actualizado: ${new Date().toLocaleString("es-PE")}`,
    s: {
      font: { italic: true, color: { rgb: "647789" }, sz: 10 },
      alignment: { horizontal: "center" }
    }
  };

  paint(dash, "A2:H2", {
    fill: { fgColor: { rgb: "F4F7FA" } },
    alignment: { horizontal: "center" }
  });

  dash["!rows"] = [{ hpt: 34 }, { hpt: 22 }];

  const cards = [
    {
      label: "SUPERVISIONES REALIZADAS",
      value: records.length,
      range: "A4:B4",
      valueRange: "A5:B6"
    },
    {
      label: "TÉCNICOS SUPERVISADOS",
      value: technicians.length,
      range: "C4:D4",
      valueRange: "C5:D6"
    },
    {
      label: "CUMPLIMIENTO GENERAL",
      value: complianceText,
      range: "E4:F4",
      valueRange: "E5:F6"
    },
    {
      label: "INCUMPLIMIENTOS",
      value: noCount,
      range: "G4:H4",
      valueRange: "G5:H6"
    }
  ];

  cards.forEach((card, index) => {
    merge(dash, card.range);
    merge(dash, card.valueRange);

    const labelCell = card.range.split(":")[0];
    const valueCell = card.valueRange.split(":")[0];

    dash[labelCell] = { t: "s", v: card.label };
    dash[valueCell] = {
      t: typeof card.value === "number" ? "n" : "s",
      v: card.value
    };

    const valueFill = index === 3 ? red : (index === 2 ? green : pale);

    paint(dash, card.range, {
      fill: { fgColor: { rgb: navy } },
      font: { bold: true, color: { rgb: white }, sz: 9 },
      alignment: {
        horizontal: "center",
        vertical: "center",
        wrapText: true
      },
      border
    });

    paint(dash, card.valueRange, {
      fill: { fgColor: { rgb: valueFill } },
      font: {
        bold: true,
        color: { rgb: index === 3 ? "B42318" : blue },
        sz: 22
      },
      alignment: { horizontal: "center", vertical: "center" },
      border
    });
  });

  dash["!rows"][3] = { hpt: 24 };
  dash["!rows"][4] = { hpt: 25 };
  dash["!rows"][5] = { hpt: 25 };

  addSection(dash, 9, 0, "SUPERVISIONES POR MES", 3);
  addSection(dash, 9, 4, "SUPERVISIONES POR TÉCNICO", 4);

  const monthRows = [["Mes", "Cantidad", "Participación"]];
  const monthEntries = Object.entries(monthMap)
    .sort((a, b) => a[0].localeCompare(b[0]));

  monthEntries.forEach(([month, count]) => {
    monthRows.push([
      month,
      count,
      records.length ? count / records.length : 0
    ]);
  });

  XLSX.utils.sheet_add_aoa(dash, monthRows, { origin: "A10" });

  const techRows = [["Técnico", "Cantidad", "Participación", "Indicador"]];

  Object.entries(techMap).sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => {
      techRows.push([
        name,
        count,
        records.length ? count / records.length : 0,
        "■".repeat(
          Math.max(
            1,
            Math.round(count / Math.max(...Object.values(techMap)) * 10)
          )
        )
      ]);
    });

  XLSX.utils.sheet_add_aoa(dash, techRows, { origin: "E10" });

  const headerStyle = {
    fill: { fgColor: { rgb: blue } },
    font: { bold: true, color: { rgb: white } },
    alignment: {
      horizontal: "center",
      vertical: "center",
      wrapText: true
    },
    border
  };

  paint(dash, "A10:C10", headerStyle);
  paint(
    dash,
    `A11:C${Math.max(11, 10 + monthEntries.length)}`,
    {
      font: { color: { rgb: ink } },
      border,
      alignment: { vertical: "center" }
    }
  );

  paint(dash, "E10:H10", headerStyle);
  paint(
    dash,
    `E11:H${Math.max(11, 10 + Object.keys(techMap).length)}`,
    {
      font: { color: { rgb: ink } },
      border,
      alignment: { vertical: "center" }
    }
  );

  monthEntries.forEach((_, i) => {
    const cell = "C" + (11 + i);
    if (dash[cell]) dash[cell].z = "0.0%";
  });

  Object.keys(techMap).forEach((_, i) => {
    const cell = "G" + (11 + i);
    if (dash[cell]) dash[cell].z = "0.0%";
  });

  const checkStart = Math.max(
    13,
    12 + monthEntries.length,
    12 + Object.keys(techMap).length
  );

  addSection(
    dash,
    checkStart,
    0,
    "CUMPLIMIENTO DE LISTA DE VERIFICACIÓN",
    4
  );

  const checkRows = [[
    "Criterio evaluado",
    "Sí cumple",
    "No cumple",
    "No aplica"
  ]];

  checks.forEach(([label]) => {
    const item = checkMap[label] || { si: 0, no: 0, na: 0 };
    checkRows.push([label, item.si, item.no, item.na]);
  });

  XLSX.utils.sheet_add_aoa(
    dash,
    checkRows,
    { origin: `A${checkStart + 1}` }
  );

  paint(
    dash,
    `A${checkStart + 1}:D${checkStart + 1}`,
    headerStyle
  );

  paint(
    dash,
    `A${checkStart + 2}:D${checkStart + 1 + checks.length}`,
    {
      border,
      alignment: { vertical: "center" },
      font: { color: { rgb: ink } }
    }
  );

  dash["!cols"] = [
    { wch: 25 },
    { wch: 14 },
    { wch: 16 },
    { wch: 15 },
    { wch: 25 },
    { wch: 13 },
    { wch: 15 },
    { wch: 18 }
  ];

  dash["!freeze"] = { xSplit: 0, ySplit: 3 };
  XLSX.utils.book_append_sheet(wb, dash, "DASHBOARD");

  // HOJA 2: DETALLE DE REGISTROS
  const detailHeaders = [
    "Fecha",
    "Hora",
    "ORTE",
    "Técnico",
    "Cliente",
    "Placa o chasis",
    "Supervisado por",
    "Zapato",
    "Pantalón",
    "Polo",
    "Casaca",
    "ORTE verificada",
    "Puntos de señales",
    "Camuflaje",
    "Uso de herramientas",
    "Recomendaciones y observaciones",
    "Cantidad de fotografías",
    "Firma del técnico",
    "Firma del supervisor"
  ];

  const detailRows = records
    .slice()
    .sort((a, b) =>
      (a.fecha || "").localeCompare(b.fecha || "") ||
      (a.hora || "").localeCompare(b.hora || "")
    )
    .map(r => [
      r.fecha || "",
      r.hora || "",
      r.orte || "",
      r.tecnico || "",
      r.cliente || "",
      r.chasis || "",
      r.supervisor || "",
      r.zapato || "",
      r.pantalon || "",
      r.polo || "",
      r.casaca || "",
      r.orteOk || "",
      r.senales || "",
      r.camuflaje || "",
      r.herramientas || "",
      r.observaciones || "",
      (r.photos || []).length,
      r.firmaTecnico ? "Registrada" : "No registrada",
      r.firmaSupervisor ? "Registrada" : "No registrada"
    ]);

  const detail = XLSX.utils.aoa_to_sheet([
    detailHeaders,
    ...detailRows
  ]);

  paint(detail, "A1:S1", {
    fill: { fgColor: { rgb: navy } },
    font: { bold: true, color: { rgb: white } },
    alignment: {
      horizontal: "center",
      vertical: "center",
      wrapText: true
    },
    border
  });

  if (detailRows.length) {
    paint(detail, `A2:S${detailRows.length + 1}`, {
      border,
      alignment: { vertical: "top", wrapText: true },
      font: { color: { rgb: ink } }
    });
  }

  detail["!cols"] = [
    12, 9, 15, 23, 24, 20, 23, 11, 12, 10,
    11, 16, 18, 14, 19, 42, 16, 18, 20
  ].map(wch => ({ wch }));

  detail["!rows"] = [{ hpt: 34 }];
  detail["!autofilter"] = {
    ref: `A1:S${Math.max(1, detailRows.length + 1)}`
  };
  detail["!freeze"] = { xSplit: 0, ySplit: 1 };

  XLSX.utils.book_append_sheet(wb, detail, "REGISTROS");

  // HOJA 3: RESUMEN GENERAL
  const summary = XLSX.utils.aoa_to_sheet([
    ["INDICADOR", "RESULTADO"],
    ["Total de supervisiones", records.length],
    ["Técnicos supervisados", technicians.length],
    ["Fotografías adjuntas", totalPhotos],
    ["Ítems que cumplen (Sí)", yesCount],
    ["Ítems que no cumplen (No)", noCount],
    ["Porcentaje de cumplimiento", complianceText],
    [
      "Registros con firma del técnico",
      records.filter(r => !!r.firmaTecnico).length
    ],
    [
      "Registros con firma del supervisor",
      records.filter(r => !!r.firmaSupervisor).length
    ]
  ]);

  paint(summary, "A1:B1", headerStyle);
  paint(summary, "A2:B9", {
    border,
    font: { color: { rgb: ink } },
    alignment: { vertical: "center" }
  });

  summary["!cols"] = [
    { wch: 38 },
    { wch: 24 }
  ];

  XLSX.utils.book_append_sheet(wb, summary, "RESUMEN");

  XLSX.writeFile(
    wb,
    "TRACKLINK_SUPERVISION_2026.xlsx",
    {
      bookType: "xlsx",
      compression: true
    }
  );
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

    if (
      button.dataset.tab === "lista" ||
      button.dataset.tab === "estadisticas"
    ) {
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
      localStorage.setItem(
        AUTH_KEY,
        JSON.stringify({
          username,
          passwordHash,
          createdAt: new Date().toISOString()
        })
      );

      currentUser = username;
      message.textContent = "Acceso local creado.";
    } else {
      const account = JSON.parse(stored);

      if (
        account.username !== username ||
        account.passwordHash !== passwordHash
      ) {
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
  loginDescription.textContent =
    "Ingresa con tu cuenta local de supervisor.";
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
