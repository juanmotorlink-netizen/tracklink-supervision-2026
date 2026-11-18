import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDocs, deleteDoc,
  serverTimestamp, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebaseConfig.js";

const $ = id => document.getElementById(id);
const dbName = "tracklink-supervision-2026", storeName = "records";
let app, auth, db, user = null, records = [], pendingPhotos = [];
let stopRecords = null, stopPhotos = null, remotePhotos = new Map();

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) { console.error("Firebase no pudo inicializarse:", e); }

function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(dbName, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(storeName, { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function localAll() {
  const d = await openDB();
  return new Promise(res => {
    const q = d.transaction(storeName).objectStore(storeName).getAll();
    q.onsuccess = () => res(q.result || []);
  });
}
async function localPut(v) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const q = d.transaction(storeName, "readwrite").objectStore(storeName).put(v);
    q.onsuccess = res; q.onerror = () => rej(q.error);
  });
}
async function localDelete(id) {
  const d = await openDB();
  return new Promise(res => {
    const q = d.transaction(storeName, "readwrite").objectStore(storeName).delete(id);
    q.onsuccess = res;
  });
}
function showApp() {
  $("login").hidden = true; $("app").hidden = false;
  $("session").innerHTML = `${escapeHtml(user?.email || "")} <button id="logout" class="secondary">Salir</button>`;
  $("logout").onclick = async () => { await signOut(auth); };
}
async function refresh() { records = await localAll(); renderRecords(); renderStats(); }
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function compressPhoto(file) {
  const source = await fileToDataUrl(file);
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = source; });
  const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  let dataUrl = canvas.toDataURL("image/jpeg", 0.68);
  if (dataUrl.length > 850000) dataUrl = canvas.toDataURL("image/jpeg", 0.48);
  if (dataUrl.length > 950000) throw new Error(`La foto ${file.name} es demasiado pesada. Selecciona una imagen más pequeña.`);
  return { name: file.name, dataUrl };
}
function stopLiveSync() {
  if (stopRecords) stopRecords();
  if (stopPhotos) stopPhotos();
  stopRecords = stopPhotos = null;
  remotePhotos.clear();
}
function startLiveSync() {
  stopLiveSync();
  if (!db || !user || !navigator.onLine) return;
  stopRecords = onSnapshot(collection(db, "supervisiones"), async snap => {
    const locals = await localAll();
    const localMap = new Map(locals.map(r => [r.id, r]));
    for (const change of snap.docChanges()) {
      const remote = { id: change.doc.id, ...change.doc.data(), pending: false };
      const local = localMap.get(remote.id);
      if (change.type === "removed") {
        if (!local?.pending) await localDelete(remote.id);
      } else if (!local?.pending) {
        await localPut(remote);
      }
    }
    await refresh();
  }, err => console.error("Error al recibir supervisiones:", err));
  stopPhotos = onSnapshot(collection(db, "evidencias"), async snap => {
    for (const change of snap.docChanges()) {
      const p = change.doc.data();
      if (!p.recordId) continue;
      if (!remotePhotos.has(p.recordId)) remotePhotos.set(p.recordId, []);
      let arr = remotePhotos.get(p.recordId);
      arr = arr.filter(x => x.id !== change.doc.id);
      if (change.type !== "removed") arr.push({ id: change.doc.id, name: p.name, dataUrl: p.dataUrl });
      remotePhotos.set(p.recordId, arr);
    }
    const locals = await localAll();
    for (const r of locals) {
      const ps = (remotePhotos.get(r.id) || []).sort((a,b)=>a.id.localeCompare(b.id)).map(({name,dataUrl})=>({name,dataUrl}));
      if (!r.pending && remotePhotos.has(r.id)) { r.photos = ps; await localPut(r); }
    }
    await refresh();
  }, err => console.error("Error al recibir evidencias:", err));
}
async function syncOne(r) {
  if (!db || !user || !navigator.onLine) return false;
  try {
    const photos = [];
    for (const p of (r.photos || [])) {
      if (p.dataUrl) photos.push({ name: p.name, dataUrl: p.dataUrl });
      else if (p.data) photos.push(await compressPhoto(p.data));
    }
    const clean = { ...r, photos: [], ownerUid: user.uid, updatedAt: serverTimestamp() };
    delete clean.pending;
    await setDoc(doc(db, "supervisiones", r.id), clean, { merge: true });

    // Las imágenes se guardan como documentos separados de Firestore.
    // Así evitamos el límite de 1 MiB por documento y no usamos Firebase Storage.
    for (let i = 0; i < photos.length; i++) {
      await setDoc(doc(db, "evidencias", `${r.id}_${i}`), {
        recordId: r.id, ownerUid: user.uid, name: photos[i].name,
        dataUrl: photos[i].dataUrl, index: i, updatedAt: serverTimestamp()
      });
    }
    const old = await getDocs(query(collection(db, "evidencias"), where("recordId", "==", r.id)));
    for (const d of old.docs) {
      const index = Number(d.data().index);
      if (Number.isFinite(index) && index >= photos.length) await deleteDoc(d.ref);
    }
    r.photos = photos; r.pending = false; r.ownerUid = user.uid;
    await localPut(r);
    return true;
  } catch (e) {
    console.warn("Pendiente de sincronización:", e);
    $("saveMsg").textContent = "Guardado en el celular. No se pudo sincronizar: " + (e.message || e);
    return false;
  }
}
async function syncPending() {
  if (!db || !user || !navigator.onLine) return;
  // Migra también registros locales antiguos que todavía no existen en la nube.
  const cloud = await getDocs(collection(db, "supervisiones"));
  const cloudIds = new Set(cloud.docs.map(d => d.id));
  for (const r of await localAll()) {
    if (r.pending || !cloudIds.has(r.id)) await syncOne(r);
  }
}
function getVal(id) { return $(id).value; }
function signature(id) {
  const c = $(id);
  // Reducir el tamaño de la firma sin perder su legibilidad.
  const out = document.createElement("canvas"); out.width = 600; out.height = 200;
  out.getContext("2d").drawImage(c, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", 0.65);
}
function setupCanvas(id) {
  const c = $(id), ctx = c.getContext("2d"); let drawing = false;
  function pos(e) { const r = c.getBoundingClientRect(); return { x:(e.clientX-r.left)*c.width/r.width, y:(e.clientY-r.top)*c.height/r.height }; }
  c.width = 900; c.height = 300;
  c.addEventListener("pointerdown", e => { drawing=true; c.setPointerCapture(e.pointerId); const p=pos(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); });
  c.addEventListener("pointermove", e => { if(!drawing)return; const p=pos(e); ctx.lineWidth=4; ctx.lineCap="round"; ctx.strokeStyle="#142f45"; ctx.lineTo(p.x,p.y); ctx.stroke(); });
  c.addEventListener("pointerup",()=>drawing=false); c.addEventListener("pointercancel",()=>drawing=false);
}
["sigTecnico","sigSupervisor"].forEach(setupCanvas);
document.querySelectorAll(".clearSig").forEach(b=>b.onclick=()=>{const c=$(b.dataset.canvas);c.getContext("2d").clearRect(0,0,c.width,c.height);});
function addFiles(list) {
  for (const f of list) { if (!f.type.startsWith("image/")) continue; pendingPhotos.push({name:f.name,data:f}); }
  renderPreview();
}
function renderPreview() {
  $("preview").innerHTML = "";
  pendingPhotos.forEach((p,i) => {
    const img=document.createElement("img");
    img.src=p.dataUrl || (p.data ? URL.createObjectURL(p.data) : "");
    img.title=p.name; $("preview").append(img);
    const b=document.createElement("button"); b.className="danger"; b.textContent="Quitar";
    b.onclick=()=>{pendingPhotos.splice(i,1);renderPreview();}; $("preview").append(b);
  });
}
$("photos").onchange=e=>addFiles(e.target.files);
$("gallery").onchange=e=>addFiles(e.target.files);
function resetForm() {
  $("recordForm").reset(); $("recordId").value=""; pendingPhotos=[]; renderPreview();
  ["sigTecnico","sigSupervisor"].forEach(id=>$(id).getContext("2d").clearRect(0,0,$(id).width,$(id).height));
  $("fecha").value=new Date().toISOString().slice(0,10); $("hora").value=new Date().toTimeString().slice(0,5);
}
$("clearForm").onclick=resetForm;
$("recordForm").onsubmit=async e=>{
  e.preventDefault();
  const id=$("recordId").value||crypto.randomUUID();
  if (pendingPhotos.length > 8) { alert("Por el plan gratuito, selecciona como máximo 8 fotografías por supervisión."); return; }
  const r={
    id,fecha:getVal("fecha"),hora:getVal("hora"),orte:getVal("orte"),tecnico:getVal("tecnico"),
    cliente:getVal("cliente"),chasis:getVal("chasis"),supervisor:getVal("supervisor"),
    zapato:getVal("zapato"),pantalon:getVal("pantalon"),polo:getVal("polo"),casaca:getVal("casaca"),
    orteOk:getVal("orteOk"),senales:getVal("senales"),camuflaje:getVal("camuflaje"),
    herramientas:getVal("herramientas"),observaciones:getVal("observaciones"),
    firmaTecnico:signature("sigTecnico"),firmaSupervisor:signature("sigSupervisor"),
    photos:pendingPhotos.slice(),pending:true,createdAt:new Date().toISOString()
  };
  await localPut(r);
  $("saveMsg").textContent="Registro guardado en el celular. Sincronizando…";
  const ok=await syncOne(r);
  resetForm(); await refresh();
  $("saveMsg").textContent=ok?"Registro guardado y compartido con los demás supervisores.":"Registro guardado en este celular; se sincronizará cuando haya conexión.";
};
function renderRecords() {
  $("records").innerHTML="";
  records.sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||"")).forEach(r=>{
    const el=document.createElement("div");el.className="record";
    const info=document.createElement("div");
    info.innerHTML=`<b>${escapeHtml(r.orte||"Sin ORTE")} · ${escapeHtml(r.tecnico||"")}</b><small>${escapeHtml(r.fecha||"")} · ${escapeHtml(r.cliente||"")} · ${(r.photos||[]).length} foto(s) · ${r.pending?"Pendiente de sincronizar":"Compartido"}</small>`;
    const actions=document.createElement("div");
    const edit=document.createElement("button");edit.className="secondary";edit.textContent="Editar";edit.onclick=()=>editRecord(r);
    const pdf=document.createElement("button");pdf.className="secondary";pdf.textContent="Informe PDF";pdf.onclick=()=>printCheckReport(r);
    const del=document.createElement("button");del.className="danger";del.textContent="Borrar registro";del.onclick=()=>deleteRecord(r);
    actions.append(edit,pdf,del);el.append(info,actions);$("records").append(el);
  });
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function editRecord(r) {
  const map={fecha:"fecha",hora:"hora",orte:"orte",tecnico:"tecnico",cliente:"cliente",chasis:"chasis",supervisor:"supervisor",zapato:"zapato",pantalon:"pantalon",polo:"polo",casaca:"casaca",orteOk:"orteOk",senales:"senales",camuflaje:"camuflaje",herramientas:"herramientas",observaciones:"observaciones"};
  Object.entries(map).forEach(([k,id])=>$(id).value=r[k]||"");
  $("recordId").value=r.id;
  pendingPhotos=(r.photos||[]).map(p=>p.dataUrl?{name:p.name,dataUrl:p.dataUrl}:p);
  renderPreview();$("lista").hidden=true;$("registro").hidden=false;document.querySelector('[data-tab="registro"]').click();
}
async function deleteRecord(r) {
  if(!confirm(`¿Seguro que deseas borrar el registro ${r.orte||r.id}? Esta acción se reflejará en todos los dispositivos.`))return;
  if(r.ownerUid && r.ownerUid!==user?.uid){alert("Solo el supervisor que creó el registro puede borrarlo.");return;}
  await localDelete(r.id);
  if(db&&user&&navigator.onLine){
    try{
      await deleteDoc(doc(db,"supervisiones",r.id));
      const ps=await getDocs(query(collection(db,"evidencias"),where("recordId","==",r.id)));
      for(const p of ps.docs) await deleteDoc(p.ref);
    }catch(e){alert("No se pudo borrar en la nube: "+e.message);}
  }
  await refresh();
}
function renderStats(){
  const total=records.length,byTech={};
  records.forEach(r=>byTech[r.tecnico||"Sin técnico"]=(byTech[r.tecnico||"Sin técnico"]||0)+1);
  $("stats").innerHTML=`<div class="stat"><b>${total}</b>Supervisiones registradas</div><div class="stat"><b>${records.reduce((n,r)=>n+(r.photos||[]).length,0)}</b>Fotografías</div>`+
    Object.entries(byTech).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="stat"><b>${v}</b>${escapeHtml(k)}</div>`).join("");
}
async function printCheckReport(r) {
  const esc = escapeHtml;
  if (!window.html2pdf) {
    alert("No se pudo cargar el generador de PDF. Verifica tu conexión e inténtalo nuevamente.");
    return;
  }
  const checks = [
    ["Zapato", r.zapato], ["Pantalón", r.pantalon], ["Polo", r.polo], ["Casaca", r.casaca],
    ["ORTE verificada", r.orteOk], ["Puntos de señales", r.senales],
    ["Camuflaje", r.camuflaje], ["Uso correcto de herramientas", r.herramientas]
  ];
  const photos = (r.photos || []).map((p, i) => {
    const src = p.dataUrl || p.url || "";
    return src ? `<figure><img src="${src}" alt="Evidencia ${i+1}"><figcaption>${esc(p.name || `Evidencia ${i+1}`)}</figcaption></figure>` : "";
  }).join("");
  const signatureImg = (src, label) => src ? `<div class="signature"><img src="${src}" alt="${label}"><span>${label}</span></div>` : `<div class="signature empty"><span>${label}: No registrada</span></div>`;
  container.style.cssText = "position:absolute;left:0;top:0;width:794px;background:#fff;z-index:9999;pointer-events:none";
 container.innerHTML = html;
  const filename = `INFORME_CHEQUEO_${String(sequence).padStart(3,"0")}.pdf`;
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;background:#fff;z-index:-1";
  container.innerHTML = `<style>
  *{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#203448;margin:0}header{background:#102b46;color:#fff;padding:16px 20px;border-bottom:5px solid #1683b5}header strong{font-size:21px;letter-spacing:1px}header span{display:block;font-size:11px;letter-spacing:2px;color:#c7dceb;margin-top:4px}h1{font-size:20px;color:#102b46;margin:18px 0 4px}.sub{color:#667989;margin:0 0 16px}.section{background:#102b46;color:#fff;padding:8px 10px;font-weight:bold;margin:15px 0 8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:7px 12px}.field{border-bottom:1px solid #d8e1e8;padding:5px 2px;min-height:31px}.field b{display:block;color:#667989;font-size:9px;text-transform:uppercase;margin-bottom:3px}.checks{width:100%;border-collapse:collapse}.checks td,.checks th{border:1px solid #d8e1e8;padding:8px;text-align:left}.checks th{background:#eaf2f8}.yes{color:#187447;font-weight:bold}.no{color:#b42318;font-weight:bold}.photos{display:grid;grid-template-columns:1fr 1fr;gap:10px}.photos figure{margin:0;border:1px solid #d8e1e8;padding:6px;break-inside:avoid;page-break-inside:avoid}.photos img{width:100%;height:180px;object-fit:contain}.photos figcaption{font-size:9px;color:#667989}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:25px;margin-top:16px}.signature{height:100px;border-bottom:1px solid #526879;display:flex;flex-direction:column;align-items:center;justify-content:end}.signature img{max-width:100%;height:72px;object-fit:contain}.signature span{font-size:10px;margin:5px}.obs{border:1px solid #d8e1e8;padding:10px;min-height:55px;white-space:pre-wrap}.footer{margin-top:20px;color:#82909b;font-size:9px;text-align:center}</style>
  <header><strong>TRACKLINK</strong><span>SUPERVISIÓN TÉCNICA 2026</span></header>
  <h1>INFORME DE CHEQUEO</h1><p class="sub">Registro individual de supervisión técnica, verificación de vestimenta e instalación.</p>
  <div class="section">1. DATOS DE LA SUPERVISIÓN</div><div class="grid">
  ${[["Fecha",r.fecha],["Hora",r.hora],["ORTE de trabajo",r.orte],["Técnico",r.tecnico],["Cliente",r.cliente],["Placa o chasis",r.chasis],["Supervisado por",r.supervisor]].map(([k,v])=>`<div class="field"><b>${k}</b>${esc(v || "—")}</div>`).join("")}
  </div><div class="section">2. VERIFICACIÓN DE VESTIMENTA E INSTALACIÓN</div>
  <table class="checks"><thead><tr><th>Ítem evaluado</th><th>Resultado</th></tr></thead><tbody>${checks.map(([k,v])=>`<tr><td>${k}</td><td class="${String(v).toLowerCase()==="no"?"no":"yes"}">${esc(v || "Sin dato")}</td></tr>`).join("")}</tbody></table>
  <div class="section">3. RECOMENDACIONES Y/O OBSERVACIONES</div><div class="obs">${esc(r.observaciones || "Sin observaciones registradas")}</div>
  <div class="section">4. EVIDENCIA FOTOGRÁFICA (${(r.photos||[]).length})</div><div class="photos">${photos || "Sin fotografías adjuntas"}</div>
  <div class="section">5. FIRMAS DIGITALES</div><div class="signatures">${signatureImg(r.firmaTecnico,"Técnico instalador")}${signatureImg(r.firmaSupervisor,"Supervisor")}</div>
  <div class="footer">TRACKLINK · INFORME DE CHEQUEO · Registro ${esc(r.id)}</div>`;
  document.body.appendChild(container);
  try {
    const images = [...container.querySelectorAll("img")];
    await Promise.all(images.map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.onload=resolve; img.onerror=resolve; })));
    await window.html2pdf().set({
      margin: [10, 10, 12, 10], filename,
      image: { type: "jpeg", quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"] }
    }).from(container).save();
  } catch (error) {
    console.error("Error al generar PDF", error);
    alert("No se pudo generar el PDF. Inténtalo nuevamente.");
  } finally {
    container.remove();
  }
}

$("exportBtn").onclick=()=>{
  if(!window.XLSX){alert("No se pudo cargar el módulo Excel. Revisa tu conexión.");return;}
  if(!records.length){alert("Todavía no hay registros para exportar.");return;}
  const wb=XLSX.utils.book_new();
  const navy="102B46", blue="087EAF", pale="EAF2F8", ink="203448", green="DDF2E5", red="FCE4E4", white="FFFFFF", line="D5E0E8";
  const border={top:{style:"thin",color:{rgb:line}},bottom:{style:"thin",color:{rgb:line}},left:{style:"thin",color:{rgb:line}},right:{style:"thin",color:{rgb:line}}};
  const headerStyle={fill:{fgColor:{rgb:blue}},font:{bold:true,color:{rgb:white}},alignment:{horizontal:"center",vertical:"center",wrapText:true},border};
  function styleRange(ws,range,style){const rg=XLSX.utils.decode_range(range);for(let R=rg.s.r;R<=rg.e.r;R++)for(let C=rg.s.c;C<=rg.e.c;C++){const a=XLSX.utils.encode_cell({r:R,c:C});if(!ws[a])ws[a]={t:"s",v:""};ws[a].s={...(ws[a].s||{}),...style};}}
  function merge(ws,range){ws["!merges"]=(ws["!merges"]||[]).concat([XLSX.utils.decode_range(range)]);}
  function title(ws,range,text){merge(ws,range);const a=range.split(":")[0];ws[a]={t:"s",v:text,s:{fill:{fgColor:{rgb:navy}},font:{bold:true,color:{rgb:white},sz:17},alignment:{horizontal:"center",vertical:"center"}}};styleRange(ws,range,{fill:{fgColor:{rgb:navy}},font:{bold:true,color:{rgb:white},sz:17},alignment:{horizontal:"center",vertical:"center"}});ws["!rows"]=[{hpt:32}];}
  const checks=[["Zapato","zapato"],["Pantalón","pantalon"],["Polo","polo"],["Casaca","casaca"],["ORTE verificada","orteOk"],["Puntos de señales","senales"],["Camuflaje","camuflaje"],["Uso correcto de herramientas","herramientas"]];
  const techMap={}, monthMap={}, errorMap={}; let yes=0,no=0,na=0,photos=0;
  records.forEach(r=>{const t=r.tecnico||"Sin técnico";techMap[t]??={total:0,errors:0,yes:0,no:0};techMap[t].total++;
    const m=(r.fecha||"Sin fecha").slice(0,7);monthMap[m]=(monthMap[m]||0)+1;photos+=(r.photos||[]).length;
    checks.forEach(([label,key])=>{const v=String(r[key]??"").trim().toLowerCase();errorMap[label]??={yes:0,no:0,na:0};if(v==="sí"||v==="si"){yes++;techMap[t].yes++;errorMap[label].yes++;}else if(v==="no"){no++;techMap[t].no++;techMap[t].errors++;errorMap[label].no++;}else if(v==="no aplica"){na++;errorMap[label].na++;}});
  });
  const techs=Object.keys(techMap).length, applicable=yes+no, compliance=applicable?yes/applicable:0;
  // DASHBOARD
  const dash=XLSX.utils.aoa_to_sheet([]);title(dash,"A1:H1","TRACKLINK | SUPERVISIÓN TÉCNICA 2026");merge(dash,"A2:H2");dash.A2={t:"s",v:`DASHBOARD GERENCIAL · Actualizado ${new Date().toLocaleString("es-PE")}`,s:{font:{italic:true,color:{rgb:"647789"}},alignment:{horizontal:"center"}}};
  const cards=[["SUPERVISIONES",records.length],["TÉCNICOS",techs],["CUMPLIMIENTO",compliance],["INCUMPLIMIENTOS",no]];
  cards.forEach((c,i)=>{const col=i*2;const a=XLSX.utils.encode_cell({r:3,c:col}),b=XLSX.utils.encode_cell({r:3,c:col+1}),v=XLSX.utils.encode_cell({r:4,c:col});merge(dash,`${a}:${b}`);dash[a]={t:"s",v:c[0]};merge(dash,`${v}:${XLSX.utils.encode_cell({r:5,c:col+1})}`);dash[v]={t:"n",v:c[1]};styleRange(dash,`${a}:${b}`,{fill:{fgColor:{rgb:navy}},font:{bold:true,color:{rgb:white},sz:9},alignment:{horizontal:"center",vertical:"center",wrapText:true},border});styleRange(dash,`${v}:${XLSX.utils.encode_cell({r:5,c:col+1})}`,{fill:{fgColor:{rgb:i===3?red:(i===2?green:pale)}},font:{bold:true,color:{rgb:i===3?"B42318":blue},sz:20},alignment:{horizontal:"center",vertical:"center"},border});if(i===2)dash[v].z="0.0%";});
  const monthRows=[["Mes","Supervisiones"] ,...Object.entries(monthMap).sort((a,b)=>a[0].localeCompare(b[0])).map(x=>x)];
  const techRows=[["Técnico","Supervisiones","Incumplimientos","Cumplimiento"],...Object.entries(techMap).sort((a,b)=>b[1].total-a[1].total).map(([n,v])=>[n,v.total,v.errors,(v.yes+v.no)?v.yes/(v.yes+v.no):0])];
  merge(dash,"A8:B8");dash.A8={t:"s",v:"SUPERVISIONES POR MES"};styleRange(dash,"A8:B8",{fill:{fgColor:{rgb:navy}},font:{bold:true,color:{rgb:white}}});
  XLSX.utils.sheet_add_aoa(dash,monthRows,{origin:"A9"});styleRange(dash,"A9:B9",headerStyle);if(monthRows.length>1)styleRange(dash,`A10:B${8+monthRows.length}`,{border,alignment:{vertical:"center"},font:{color:{rgb:ink}}});
  merge(dash,"D8:G8");dash.D8={t:"s",v:"DESEMPEÑO POR TÉCNICO"};styleRange(dash,"D8:G8",{fill:{fgColor:{rgb:navy}},font:{bold:true,color:{rgb:white}}});
  XLSX.utils.sheet_add_aoa(dash,techRows,{origin:"D9"});styleRange(dash,"D9:G9",headerStyle);if(techRows.length>1)styleRange(dash,`D10:G${8+techRows.length}`,{border,alignment:{vertical:"center"},font:{color:{rgb:ink}}});for(let i=1;i<techRows.length;i++)if(dash[`G${9+i}`])dash[`G${9+i}`].z="0.0%";
  const erow=Math.max(12,10+monthRows.length,10+techRows.length);merge(dash,`A${erow}:D${erow}`);dash[`A${erow}`]={t:"s",v:"INCUMPLIMIENTOS POR CRITERIO"};styleRange(dash,`A${erow}:D${erow}`,{fill:{fgColor:{rgb:navy}},font:{bold:true,color:{rgb:white}}});
  const errRows=[["Criterio","Sí cumple","No cumple","No aplica"],...checks.map(([label])=>[label,errorMap[label].yes,errorMap[label].no,errorMap[label].na])];XLSX.utils.sheet_add_aoa(dash,errRows,{origin:`A${erow+1}`});styleRange(dash,`A${erow+1}:D${erow+1}`,headerStyle);styleRange(dash,`A${erow+2}:D${erow+errRows.length}`,{border,alignment:{vertical:"center"},font:{color:{rgb:ink}}});
  dash["!cols"]=[{wch:28},{wch:15},{wch:18},{wch:26},{wch:15},{wch:17},{wch:16},{wch:15}];dash["!freeze"]={xSplit:0,ySplit:3};XLSX.utils.book_append_sheet(wb,dash,"DASHBOARD");
  // REGISTROS
  const headers=["Fecha","Hora","ORTE","Técnico","Cliente","Placa o chasis","Supervisado por",...checks.map(x=>x[0]),"Observaciones","Cantidad de fotos","Fotos (nombres)","Firma técnico","Firma supervisor","ID del registro"];
  const rows=records.slice().sort((a,b)=>(a.fecha||"").localeCompare(b.fecha||"")||(a.hora||"").localeCompare(b.hora||"")).map(r=>[r.fecha||"",r.hora||"",r.orte||"",r.tecnico||"",r.cliente||"",r.chasis||"",r.supervisor||"",...checks.map(x=>r[x[1]]||""),r.observaciones||"",(r.photos||[]).length,(r.photos||[]).map(p=>p.name||"Foto").join("; "),r.firmaTecnico?"Registrada":"No registrada",r.firmaSupervisor?"Registrada":"No registrada",r.id]);
  const detail=XLSX.utils.aoa_to_sheet([headers,...rows]);styleRange(detail,`A1:${XLSX.utils.encode_col(headers.length-1)}1`,headerStyle);if(rows.length)styleRange(detail,`A2:${XLSX.utils.encode_col(headers.length-1)}${rows.length+1}`,{border,alignment:{vertical:"top",wrapText:true},font:{color:{rgb:ink}}});detail["!cols"]=[12,9,16,23,23,20,22,11,12,10,11,16,18,14,22,38,15,32,18,20,38].map(wch=>({wch}));detail["!autofilter"]={ref:`A1:${XLSX.utils.encode_col(headers.length-1)}${rows.length+1}`};detail["!freeze"]={xSplit:0,ySplit:1};XLSX.utils.book_append_sheet(wb,detail,"REGISTROS");
  // ESTADÍSTICAS
  const stats=XLSX.utils.aoa_to_sheet([["ESTADÍSTICAS DE SUPERVISIÓN 2026"],["Indicador","Resultado"],["Total de supervisiones",records.length],["Técnicos supervisados",techs],["Fotografías registradas",photos],["Ítems conformes",yes],["Incumplimientos detectados",no],["No aplica",na],["Cumplimiento general",compliance],[],["TÉCNICO","SUPERVISIONES","INCUMPLIMIENTOS","CUMPLIMIENTO"],...techRows.slice(1),[],["CRITERIO","SÍ","NO","NO APLICA"],...errRows.slice(1)]);
  styleRange(stats,"A1:D1",{fill:{fgColor:{rgb:navy}},font:{bold:true,color:{rgb:white},sz:16}});styleRange(stats,"A2:B2",headerStyle);styleRange(stats,"A12:D12",headerStyle);styleRange(stats,`A${13}:D${11+techRows.length}`,{border,alignment:{vertical:"center"},font:{color:{rgb:ink}}});const errHeaderRow=14+techRows.length;styleRange(stats,`A${errHeaderRow}:D${errHeaderRow}`,headerStyle);styleRange(stats,`A${errHeaderRow+1}:D${errHeaderRow+checks.length}`,{border,alignment:{vertical:"center"},font:{color:{rgb:ink}}});stats["!cols"]=[{wch:34},{wch:18},{wch:20},{wch:20}];XLSX.utils.book_append_sheet(wb,stats,"ESTADÍSTICAS");
  // INFORME DE CHEQUEO: un bloque por cada registro para consulta e impresión desde Excel.
  const report=[];const sorted=records.slice().sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||"")||(b.hora||"").localeCompare(a.hora||""));
  sorted.forEach((r,i)=>{if(i)report.push([],[]);report.push(["TRACKLINK | SUPERVISIÓN TÉCNICA 2026"],["INFORME DE CHEQUEO"],[`Registro: ${r.id}`],["DATOS DE LA SUPERVISIÓN","VALOR","",""],["Fecha",r.fecha||"","Hora",r.hora||""],["ORTE",r.orte||"","Técnico",r.tecnico||""],["Cliente",r.cliente||"","Placa o chasis",r.chasis||""],["Supervisado por",r.supervisor||""],[],["VERIFICACIÓN","RESULTADO"],...checks.map(([label,key])=>[label,r[key]||"Sin dato"]),[],["RECOMENDACIONES Y/O OBSERVACIONES"],[r.observaciones||"Sin observaciones registradas"],[],["EVIDENCIAS FOTOGRÁFICAS"],["Cantidad",(r.photos||[]).length],["Archivos",(r.photos||[]).map(p=>p.name||"Foto").join("; ")||"Sin fotografías"],[],["FIRMAS DIGITALES"],["Técnico instalador",r.firmaTecnico?"Registrada":"No registrada"],["Supervisor",r.firmaSupervisor?"Registrada":"No registrada"]);});
  const reportWs=XLSX.utils.aoa_to_sheet(report);const lastCol="D";styleRange(reportWs,`A1:${lastCol}${Math.max(1,report.length)}`,{border,alignment:{vertical:"top",wrapText:true},font:{color:{rgb:ink}}});
  for(let i=0;i<report.length;i++){const v=report[i]?.[0];if(v==="TRACKLINK | SUPERVISIÓN TÉCNICA 2026"||v==="INFORME DE CHEQUEO"){merge(reportWs,`A${i+1}:D${i+1}`);styleRange(reportWs,`A${i+1}:D${i+1}`,{fill:{fgColor:{rgb:navy}},font:{bold:true,color:{rgb:white},sz:v.startsWith("TRACKLINK")?15:13},alignment:{horizontal:"center"}});}else if(["DATOS DE LA SUPERVISIÓN","VERIFICACIÓN","RECOMENDACIONES Y/O OBSERVACIONES","EVIDENCIAS FOTOGRÁFICAS","FIRMAS DIGITALES"].includes(v)){merge(reportWs,`A${i+1}:D${i+1}`);styleRange(reportWs,`A${i+1}:D${i+1}`,{fill:{fgColor:{rgb:blue}},font:{bold:true,color:{rgb:white}}});}}
  reportWs["!cols"]=[{wch:28},{wch:32},{wch:22},{wch:32}];reportWs["!pageSetup"]={orientation:"portrait",paperSize:9,fitToWidth:1,fitToHeight:0};reportWs["!margins"]={left:0.3,right:0.3,top:0.5,bottom:0.5,header:0.2,footer:0.2};XLSX.utils.book_append_sheet(wb,reportWs,"INFORME DE CHEQUEO");
  XLSX.writeFile(wb,"TRACKLINK_SUPERVISION_2026_PROFESIONAL.xlsx",{bookType:"xlsx",compression:true});
};
$("refreshBtn").onclick=refresh;
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("active",x===b));document.querySelectorAll(".tab").forEach(x=>x.hidden=x.id!==b.dataset.tab);if(b.dataset.tab==="lista"||b.dataset.tab==="estadisticas")refresh();});
$("loginBtn").onclick=async()=>{
  if(!auth){$("loginMsg").textContent="No se pudo conectar con Firebase. Revisa firebaseConfig.js.";return;}
  try{await signInWithEmailAndPassword(auth,getVal("email"),getVal("password"));}
  catch(e){$("loginMsg").textContent="No se pudo iniciar sesión: "+e.message;}
};
if(auth) onAuthStateChanged(auth,async u=>{
  user=u;
  if(u){showApp();await refresh();startLiveSync();await syncPending();}
  else{stopLiveSync();$("app").hidden=true;$("login").hidden=false;}
});
window.addEventListener("online",async()=>{if(user){startLiveSync();await syncPending();}});
window.addEventListener("offline",stopLiveSync);
resetForm();
if("serviceWorker"in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
