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
    const del=document.createElement("button");del.className="danger";del.textContent="Borrar registro";del.onclick=()=>deleteRecord(r);
    actions.append(edit,del);el.append(info,actions);$("records").append(el);
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
$("exportBtn").onclick=()=>{
  if(!window.XLSX){alert("No se pudo cargar el módulo Excel. Revisa tu conexión.");return;}
  const rows=records.map(({id,photos,firmaTecnico,firmaSupervisor,pending,...r})=>({...r,"Cantidad de fotos":(photos||[]).length}));
  const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Supervisiones");XLSX.writeFile(wb,"TRACKLINK_SUPERVISION_2026.xlsx");
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
