const DATA_URL = "data/Libya_Tourism_Atlas_Central_Database_2026.geojson";
const STORAGE_KEY = "LDTA_2026_LOCAL_EDITS_V1";

let rawGeoJSON = null;
let workingFeatures = [];
let layerGroup = null;
let map = null;
let selectedId = null;
let visibleFeatures = [];

const fields = [
  "Arabic_Name","English_Name","Main_Category","Sub_Category","Municipality","Tourism_Region",
  "Short_Description","Photos","Confidence_Level","Publish_Status","Verification_Notes"
];

function localEdits(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch(e){ return {}; }
}

function setLocalEdits(edits){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
}

function getId(feature){
  return feature?.properties?.Atlas_ID || feature?.properties?.id || "";
}

function normalizeText(v){ return (v ?? "").toString().trim(); }

function isMissingDescription(p){
  const d = normalizeText(p.Short_Description);
  return !d || d.length < 20 || d === normalizeText(p.Arabic_Name);
}

function isMissingPhoto(p){
  const photos = normalizeText(p.Photos);
  return !/(https?:\/\/|data:image|\.jpg|\.jpeg|\.png|\.webp)/i.test(photos);
}

function isMissingEnglish(p){ return !normalizeText(p.English_Name); }

function isMissingMunicipality(p){
  const m = normalizeText(p.Municipality);
  return !m || m.includes("غير محدد");
}

function needsCompletion(feature){
  const p = feature.properties || {};
  return isMissingDescription(p) || isMissingPhoto(p) || isMissingEnglish(p) || isMissingMunicipality(p);
}

function applyEditsToFeature(feature){
  const id = getId(feature);
  const edits = localEdits()[id];
  if(!edits) return feature;
  feature.properties = {...feature.properties, ...edits};
  feature.properties.__edited = true;
  return feature;
}

function rebuildWorkingFeatures(){
  workingFeatures = rawGeoJSON.features.map(f => applyEditsToFeature(JSON.parse(JSON.stringify(f))));
}

function initMap(){
  map = L.map("map", {zoomControl:true}).setView([27.5, 17.0], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);
  layerGroup = L.layerGroup().addTo(map);
}

function markerStyle(feature){
  const p = feature.properties || {};
  if(p.__edited) return "#0f766e";
  if(needsCompletion(feature)) return "#b7791f";
  if((p.Publish_Status || "").includes("قابل")) return "#0f4c81";
  return "#6b7280";
}

function renderMap(features){
  layerGroup.clearLayers();
  const bounds = [];
  features.forEach(feature => {
    const coords = feature.geometry?.coordinates || [];
    if(coords.length < 2) return;
    const lon = Number(coords[0]), lat = Number(coords[1]);
    if(!isFinite(lat) || !isFinite(lon)) return;
    const p = feature.properties || {};
    const id = getId(feature);
    const marker = L.circleMarker([lat, lon], {
      radius: 6,
      color: markerStyle(feature),
      fillColor: markerStyle(feature),
      fillOpacity: .85,
      weight: 1
    });
    marker.bindPopup(`
      <div class="popupTitle">${escapeHtml(p.Arabic_Name || id)}</div>
      <div class="popupMeta">${escapeHtml(p.Main_Category || "")}</div>
      <div class="popupMeta">${escapeHtml(p.Municipality || "")}</div>
      <a class="popupBtn" onclick="selectFeature('${escapeJs(id)}')">تحرير البطاقة</a>
    `);
    marker.on("click", () => selectFeature(id));
    marker.addTo(layerGroup);
    bounds.push([lat, lon]);
  });
  if(bounds.length){
    try{ map.fitBounds(bounds, {padding:[25,25], maxZoom: 8}); } catch(e){}
  }
}

function escapeHtml(str){
  return String(str ?? "").replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[s]));
}
function escapeJs(str){ return String(str ?? "").replace(/\\/g,"\\\\").replace(/'/g,"\\'"); }

function populateFilters(){
  const axes = [...new Set(workingFeatures.map(f => normalizeText(f.properties.Main_Category)).filter(Boolean))].sort();
  const statuses = [...new Set(workingFeatures.map(f => normalizeText(f.properties.Publish_Status)).filter(Boolean))].sort();
  fillSelect("axisFilter", axes, "كل المحاور");
  fillSelect("publishFilter", statuses, "كل الحالات");
}

function fillSelect(id, values, firstText){
  const sel = document.getElementById(id);
  const current = sel.value;
  sel.innerHTML = `<option value="">${firstText}</option>` + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  sel.value = current;
}

function updateKPIs(){
  const edits = localEdits();
  document.getElementById("kpiTotal").textContent = workingFeatures.length.toLocaleString("ar");
  document.getElementById("kpiMissingDescription").textContent = workingFeatures.filter(f => isMissingDescription(f.properties)).length.toLocaleString("ar");
  document.getElementById("kpiMissingPhotos").textContent = workingFeatures.filter(f => isMissingPhoto(f.properties)).length.toLocaleString("ar");
  document.getElementById("kpiMissingEnglish").textContent = workingFeatures.filter(f => isMissingEnglish(f.properties)).length.toLocaleString("ar");
  document.getElementById("kpiLocalEdits").textContent = Object.keys(edits).length.toLocaleString("ar");
}

function applyFilters(){
  const q = normalizeText(document.getElementById("searchInput").value).toLowerCase();
  const axis = document.getElementById("axisFilter").value;
  const status = document.getElementById("publishFilter").value;
  const missingOnly = document.getElementById("missingOnly").checked;
  const editedOnly = document.getElementById("editedOnly").checked;

  visibleFeatures = workingFeatures.filter(f => {
    const p = f.properties || {};
    const hay = [p.Atlas_ID,p.Arabic_Name,p.English_Name,p.Main_Category,p.Sub_Category,p.Municipality,p.Tourism_Region].join(" ").toLowerCase();
    if(q && !hay.includes(q)) return false;
    if(axis && p.Main_Category !== axis) return false;
    if(status && p.Publish_Status !== status) return false;
    if(missingOnly && !needsCompletion(f)) return false;
    if(editedOnly && !p.__edited) return false;
    return true;
  }).slice(0, 1500);

  renderList(visibleFeatures);
  renderMap(visibleFeatures);
}

function renderList(features){
  const el = document.getElementById("recordList");
  el.innerHTML = features.slice(0, 300).map(f => {
    const p = f.properties || {};
    const id = getId(f);
    const flags = [
      isMissingDescription(p) ? "وصف" : "",
      isMissingPhoto(p) ? "صور" : "",
      isMissingEnglish(p) ? "EN" : "",
      isMissingMunicipality(p) ? "بلدية" : ""
    ].filter(Boolean).join("، ");
    return `<div class="recordItem ${id===selectedId ? "active" : ""}" onclick="selectFeature('${escapeJs(id)}')">
      <b>${escapeHtml(p.Arabic_Name || id)}</b>
      <small>${escapeHtml(id)} | ${escapeHtml(p.Municipality || "غير محدد")}</small><br>
      <small>${flags ? "نواقص: " + escapeHtml(flags) : "مكتمل مبدئياً"}</small>
    </div>`;
  }).join("") || `<p class="muted">لا توجد نتائج مطابقة.</p>`;
}

function findFeatureById(id){
  return workingFeatures.find(f => getId(f) === id);
}

window.selectFeature = function(id){
  selectedId = id;
  const f = findFeatureById(id);
  if(!f) return;
  const p = f.properties || {};
  document.getElementById("selectedHint").classList.add("hidden");
  const form = document.getElementById("editForm");
  form.classList.remove("hidden");
  document.getElementById("atlasIdView").textContent = id;
  fields.forEach(name => {
    const input = form.elements[name];
    if(input) input.value = p[name] || "";
  });
  updateQualityList(p);
  renderPhotoPreview(p.Photos);
  renderList(visibleFeatures);
};

function updateQualityList(p){
  const tests = [
    ["الاسم العربي", !!normalizeText(p.Arabic_Name)],
    ["الاسم الإنجليزي", !isMissingEnglish(p)],
    ["الوصف السياحي", !isMissingDescription(p)],
    ["البلدية", !isMissingMunicipality(p)],
    ["الصورة", !isMissingPhoto(p)],
    ["التصنيف الرئيسي", !!normalizeText(p.Main_Category)],
    ["التصنيف الفرعي", !!normalizeText(p.Sub_Category)],
    ["حالة النشر", !!normalizeText(p.Publish_Status)]
  ];
  const ul = document.getElementById("qualityList");
  ul.innerHTML = tests.map(([label, ok]) => `<li class="${ok ? "quality-ok" : "quality-bad"}">${ok ? "✓" : "×"} ${label}</li>`).join("");
}

function renderPhotoPreview(text){
  const urls = normalizeText(text).split(/\n|,|\s+/).filter(u => /^https?:\/\//i.test(u)).slice(0,4);
  document.getElementById("photoPreview").innerHTML = urls.map(u => `<img src="${escapeHtml(u)}" onerror="this.style.display='none'">`).join("");
}

function saveCurrentEdit(e){
  e.preventDefault();
  if(!selectedId) return;
  const form = document.getElementById("editForm");
  const edit = {};
  fields.forEach(name => edit[name] = form.elements[name]?.value || "");
  edit.Last_Update = new Date().toISOString();
  const edits = localEdits();
  edits[selectedId] = edit;
  setLocalEdits(edits);
  rebuildWorkingFeatures();
  populateFilters();
  updateKPIs();
  applyFilters();
  selectFeature(selectedId);
}

function markCurrentReady(){
  if(!selectedId) return;
  const form = document.getElementById("editForm");
  form.elements["Publish_Status"].value = "قابل للنشر";
  form.elements["Confidence_Level"].value = "عالية";
}

function clearCurrentEdit(){
  if(!selectedId) return;
  const edits = localEdits();
  delete edits[selectedId];
  setLocalEdits(edits);
  rebuildWorkingFeatures();
  updateKPIs();
  applyFilters();
  selectFeature(selectedId);
}

function download(filename, text, type="application/json;charset=utf-8"){
  const blob = new Blob([text], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function mergedGeoJSON(){
  rebuildWorkingFeatures();
  return {...rawGeoJSON, features: workingFeatures.map(f => {
    const clean = JSON.parse(JSON.stringify(f));
    delete clean.properties.__edited;
    return clean;
  })};
}

function exportGeoJSON(){
  download("Libya_Tourism_Atlas_Central_Database_2026_UPDATED.geojson", JSON.stringify(mergedGeoJSON(), null, 2));
}

function exportPatches(){
  download("LDTA_2026_local_edits_patch.json", JSON.stringify(localEdits(), null, 2));
}

function exportCSV(){
  const rows = [["Atlas_ID","Arabic_Name","English_Name","Main_Category","Sub_Category","Municipality","Tourism_Region","Short_Description","Photos","Confidence_Level","Publish_Status","Verification_Notes","Missing_Description","Missing_Photos","Missing_English","Missing_Municipality","Edited"]];
  workingFeatures.forEach(f => {
    const p = f.properties || {};
    rows.push([
      getId(f),p.Arabic_Name,p.English_Name,p.Main_Category,p.Sub_Category,p.Municipality,p.Tourism_Region,p.Short_Description,p.Photos,p.Confidence_Level,p.Publish_Status,p.Verification_Notes,
      isMissingDescription(p) ? "YES":"NO",
      isMissingPhoto(p) ? "YES":"NO",
      isMissingEnglish(p) ? "YES":"NO",
      isMissingMunicipality(p) ? "YES":"NO",
      p.__edited ? "YES":"NO"
    ]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(",")).join("\n");
  download("LDTA_2026_quality_review.csv", "\ufeff" + csv, "text/csv;charset=utf-8");
}

async function loadDefaultData(){
  const res = await fetch(DATA_URL);
  rawGeoJSON = await res.json();
  rebuildWorkingFeatures();
  populateFilters();
  updateKPIs();
  applyFilters();
}

function importGeoJSONFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    rawGeoJSON = JSON.parse(reader.result);
    rebuildWorkingFeatures();
    populateFilters();
    updateKPIs();
    applyFilters();
  };
  reader.readAsText(file, "utf-8");
}

function importPatchFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    const incoming = JSON.parse(reader.result);
    const merged = {...localEdits(), ...incoming};
    setLocalEdits(merged);
    rebuildWorkingFeatures();
    populateFilters();
    updateKPIs();
    applyFilters();
  };
  reader.readAsText(file, "utf-8");
}

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  loadDefaultData().catch(err => {
    console.error(err);
    document.getElementById("recordList").innerHTML = "<p class='muted'>تعذر تحميل ملف GeoJSON. تأكد من وجوده داخل مجلد data.</p>";
  });

  document.getElementById("applyFilters").addEventListener("click", applyFilters);
  document.getElementById("searchInput").addEventListener("input", applyFilters);
  document.getElementById("editForm").addEventListener("submit", saveCurrentEdit);
  document.getElementById("markReady").addEventListener("click", markCurrentReady);
  document.getElementById("clearCurrentEdit").addEventListener("click", clearCurrentEdit);
  document.getElementById("exportGeoJSON").addEventListener("click", exportGeoJSON);
  document.getElementById("exportPatches").addEventListener("click", exportPatches);
  document.getElementById("exportCSV").addEventListener("click", exportCSV);
  document.getElementById("resetEdits").addEventListener("click", () => {
    if(confirm("هل تريد مسح جميع التعديلات المحفوظة محلياً؟")){
      localStorage.removeItem(STORAGE_KEY);
      rebuildWorkingFeatures();
      updateKPIs();
      applyFilters();
    }
  });
  document.getElementById("geojsonFile").addEventListener("change", e => {
    if(e.target.files[0]) importGeoJSONFile(e.target.files[0]);
  });
  document.getElementById("patchFile").addEventListener("change", e => {
    if(e.target.files[0]) importPatchFile(e.target.files[0]);
  });
});
