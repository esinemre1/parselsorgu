/* =====================================================================
   TKGM Parsel Sorgulama — main.js
   Doğrulanmış API adresleri:
     İl listesi  : idariYapi/ilListe
     İlçe listesi: idariYapi/ilceListe/{ilId}
     Mahalle list: idariYapi/mahalleListe/{ilceId}
     Parsel sorgu: parsel/{mahalleId}/{ada}/{parsel}    ← tek Feature döner
   ===================================================================== */

// ── HARİTA KURULUMU ──────────────────────────────────────────────────────────
const map = L.map('map', { zoomControl: false, maxZoom: 22 }).setView([39.0, 35.0], 6);

const googleSat = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { maxZoom: 22 });
const esriSat   = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 22 });
const streetMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });

let currentBase = googleSat;
googleSat.addTo(map);

const drawnItems = new L.FeatureGroup().addTo(map);
const labelLayer = new L.LayerGroup().addTo(map);
let labelsVisible = true;
let currentParcelLayer = null;
let currentFeature = null;

// ── API YARDIMCISI ───────────────────────────────────────────────────────────
async function tkgm(path) {
    try {
        const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const isFileProtocol = window.location.protocol === 'file:';
        
        let proxyUrl = '';
        if (isFileProtocol || isLocalHost) {
            // Bilgisayarında lokal çalışırken Node.js sunucusu devrede
            proxyUrl = 'http://localhost:3002/api/tkgm/' + path;
        } else {
            // Canlı sunucuya atıldığında PHP proxy dosyası devrede
            proxyUrl = 'proxy.php?path=' + encodeURIComponent(path);
        }

        const r = await fetch(proxyUrl);
        if (!r.ok) return null;
        return await r.json();
    } catch (e) {
        console.error('[TKGM Hata]', e);
        return null;
    }
}

// ── TAB YÖNETİMİ ────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const tab = document.getElementById('tab-' + btn.dataset.tab);
        if (tab) tab.classList.add('active');
    });
});

// ── İDARİ SORGU ─────────────────────────────────────────────────────────────
const provSel  = document.getElementById('province');
const distSel  = document.getElementById('district');
const mahSel   = document.getElementById('neighborhood');
const adaInp   = document.getElementById('block');
const parInp   = document.getElementById('parcel');
const srchBtn  = document.getElementById('search-btn');
const clrBtn   = document.getElementById('clear-btn');
const provLoad = document.getElementById('prov-loader');
const distLoad = document.getElementById('dist-loader');
const mahLoad  = document.getElementById('mah-loader');

function setLoader(el, show) {
    if (!el) return;
    if (show) el.classList.remove('d-none');
    else      el.classList.add('d-none');
}

// İl listesini yükle
async function loadProvinces() {
    setLoader(provLoad, true);
    const data = await tkgm('idariYapi/ilListe');
    setLoader(provLoad, false);
    if (!data || !data.features) return;
    provSel.innerHTML = '<option value="">-- İl Seçiniz --</option>';
    data.features
        .map(f => ({ id: f.properties.id, name: f.properties.text || f.properties.ad || '' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
        .forEach(({ id, name }) => {
            provSel.innerHTML += `<option value="${id}">${name}</option>`;
        });
}

// İl seçilince ilçeleri yükle
provSel.addEventListener('change', async () => {
    distSel.innerHTML = '<option value="">Yükleniyor...</option>';
    distSel.disabled  = true;
    mahSel.innerHTML  = '<option value="">-- Önce İlçe Seçiniz --</option>';
    mahSel.disabled   = true;
    if (!provSel.value) return;
    setLoader(distLoad, true);
    const data = await tkgm('idariYapi/ilceListe/' + provSel.value);
    setLoader(distLoad, false);
    if (!data || !data.features) return;
    distSel.innerHTML = '<option value="">-- İlçe Seçiniz --</option>';
    data.features
        .map(f => ({ id: f.properties.id, name: f.properties.text || f.properties.ad || '' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
        .forEach(({ id, name }) => {
            distSel.innerHTML += `<option value="${id}">${name}</option>`;
        });
    distSel.disabled = false;
});

// İlçe seçilince mahalleleri yükle
distSel.addEventListener('change', async () => {
    mahSel.innerHTML = '<option value="">Yükleniyor...</option>';
    mahSel.disabled  = true;
    if (!distSel.value) return;
    setLoader(mahLoad, true);
    const data = await tkgm('idariYapi/mahalleListe/' + distSel.value);
    setLoader(mahLoad, false);
    if (!data || !data.features) return;
    mahSel.innerHTML = '<option value="">-- Mahalle Seçiniz --</option>';
    data.features
        .map(f => ({ id: f.properties.id, name: f.properties.text || f.properties.ad || '' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
        .forEach(({ id, name }) => {
            mahSel.innerHTML += `<option value="${id}">${name}</option>`;
        });
    mahSel.disabled = false;
});

// Parsel Sorgula
srchBtn.addEventListener('click', async () => {
    if (!mahSel.value || !adaInp.value || !parInp.value) {
        alert('Lütfen İl, İlçe, Mahalle, Ada ve Parsel bilgilerini doldurunuz.');
        return;
    }
    srchBtn.disabled = true;
    srchBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Sorgulanıyor...';

    // ── Doğru endpoint: parsel/{mahalleId}/{ada}/{parsel} ──
    // API tek bir GeoJSON Feature nesnesi döndürür (fetures array değil)
    const data = await tkgm(`parsel/${mahSel.value}/${adaInp.value}/${parInp.value}`);

    srchBtn.disabled  = false;
    srchBtn.innerHTML = '<i class="fa fa-search"></i> SORGULA';

    if (!data || !data.type || !data.geometry) {
        alert('Parsel bulunamadı. Lütfen bilgileri kontrol ediniz.');
        return;
    }
    showParcelResult(data);
});

// Parsel sonucunu haritada ve panelde göster
function showParcelResult(feature) {
    const p = feature.properties || {};
    const label = `${p.adaNo || adaInp.value}/${p.parselNo || parInp.value}`;

    currentParcelLayer = L.geoJSON(feature, {
        style: { color: '#fbbf24', weight: 4, fillColor: '#3b82f6', fillOpacity: 0.4 }
    }).addTo(drawnItems);
    
    // Parsel üzerine tıklayınca bilgilerini tabloya getir
    currentParcelLayer.on('click', () => {
        showParcelTable(feature);
    });

    map.fitBounds(currentParcelLayer.getBounds(), { padding: [60, 60] });

    // Geçmişe ekle (aynı parsel yoksa)
    addToHistory(feature, label);
    showParcelTable(feature);
}

// Tabloyu dolduran ayrı fonksiyon
function showParcelTable(feature) {
    currentFeature = feature;
    const p = feature.properties || {};

    // API'den gelen gerçek alan adları (doğrulanmış):
    // ilAd, ilceAd, mahalleAd, adaNo, parselNo, alan, nitelik, mevkii, pafta, zeminKmdurum
    document.getElementById('res-il').textContent     = p.ilAd      || provSel.options[provSel.selectedIndex]?.text || '-';
    document.getElementById('res-ilce').textContent   = p.ilceAd    || distSel.options[distSel.selectedIndex]?.text || '-';
    document.getElementById('res-mah').textContent    = p.mahalleAd || mahSel.options[mahSel.selectedIndex]?.text   || '-';
    document.getElementById('res-ada').textContent    = p.adaNo     || adaInp.value;
    document.getElementById('res-parsel').textContent = p.parselNo  || parInp.value;
    document.getElementById('res-area').textContent   = p.alan      ? p.alan + ' m²' : '-';
    document.getElementById('res-type').textContent   = p.nitelik   || '-';
    document.getElementById('res-loc').textContent    = p.pafta     ? 'Pafta: ' + p.pafta : (p.mevkii || '-');
    const zemEl = document.getElementById('res-zemin');
    if (zemEl) zemEl.textContent = p.zeminKmdurum || 'Ana Taşınmaz';

    // Geometrik alan hesabı (Shoelace)
    try {
        const ring = feature.geometry.type === 'MultiPolygon'
            ? feature.geometry.coordinates[0][0]
            : feature.geometry.coordinates[0];
        const geomArea = Math.abs(ring.reduce((s, c, i, a) => {
            const n = a[(i + 1) % a.length];
            return s + (c[0] * n[1]) - (n[0] * c[1]);
        }, 0)) / 2 * 111319.9 * 111319.9 * Math.cos(ring[0][1] * Math.PI / 180);
        document.getElementById('res-geom-area').textContent = geomArea.toFixed(2) + ' m²';
    } catch {
        document.getElementById('res-geom-area').textContent = '-';
    }

    document.getElementById('results-panel').classList.remove('hidden');
}

// Geçmiş yönetimi için depo
const historyLayers = {};

function addToHistory(feature, label) {
    const id = 'hist_' + (feature.properties?.id || Date.now());
    if (historyLayers[id]) return; // Zaten varsa ekleme

    historyLayers[id] = { feature: feature, label: label };
    
    const histList = document.getElementById('history-list');
    if (histList.querySelector('.text-muted')) histList.innerHTML = ''; // "Henüz sorgu yok" yazısını sil

    const item = document.createElement('div');
    item.className = 'layer-item';
    item.innerHTML = `
        <span class="layer-item-name" style="cursor:pointer;">${label}</span>
        <div class="layer-item-actions">
            <button class="btn-zoom" title="Git"><i class="fa fa-search-plus"></i></button>
            <button class="btn-del" title="Sil"><i class="fa fa-trash"></i></button>
        </div>`;

    item.querySelector('.layer-item-name').onclick = () => showParcelTable(feature);
    item.querySelector('.btn-zoom').onclick = () => {
        const tempLayer = L.geoJSON(feature);
        map.fitBounds(tempLayer.getBounds(), { padding: [60, 60] });
        showParcelTable(feature);
    };
    item.querySelector('.btn-del').onclick = () => {
        // Haritadaki katmanı bulup silmek için biraz zahmetli ama tüm katmanları tarayalım
        drawnItems.eachLayer(layer => {
            if (layer.toGeoJSON && JSON.stringify(layer.toGeoJSON()) === JSON.stringify(feature)) {
                drawnItems.removeLayer(layer);
            }
        });
        delete historyLayers[id];
        item.remove();
        if (Object.keys(historyLayers).length === 0) {
            histList.innerHTML = '<div class="text-center py-4 text-muted" style="font-size:0.8rem;"><i class="fa fa-info-circle mb-2"></i><br>Henüz bir sorgulama yapmadınız.</div>';
        }
    };
    histList.appendChild(item);
}

// Temizle
clrBtn.addEventListener('click', () => {
    drawnItems.clearLayers();
    labelLayer.clearLayers();
    currentParcelLayer = null;
    currentFeature = null;
    document.getElementById('results-panel').classList.add('hidden');
    provSel.value = '';
    distSel.innerHTML = '<option value="">-- Önce İl Seçiniz --</option>';
    distSel.disabled  = true;
    mahSel.innerHTML  = '<option value="">-- Önce İlçe Seçiniz --</option>';
    mahSel.disabled   = true;
    adaInp.value = '';
    parInp.value  = '';
});

// ── COĞRAFİ SORGU ────────────────────────────────────────────────────────────
document.getElementById('coord-search-btn')?.addEventListener('click', async () => {
    const lat = parseFloat(document.getElementById('lat-input').value);
    const lon = parseFloat(document.getElementById('lon-input').value);
    if (isNaN(lat) || isNaN(lon)) { alert('Geçerli koordinat giriniz.'); return; }
    alert('Koordinat sorgusu şu an TKGM API kısıtlaması nedeniyle çalışmıyor. Lütfen İdari Sorgu kullanınız.');
});

// Haritaya tıklayınca koordinatları otomatik doldur
map.on('click', (e) => {
    const latEl = document.getElementById('lat-input');
    const lonEl = document.getElementById('lon-input');
    if (latEl) latEl.value = e.latlng.lat.toFixed(6);
    if (lonEl) lonEl.value = e.latlng.lng.toFixed(6);
});

// ── HARİTA ARAÇLARI ──────────────────────────────────────────────────────────
document.getElementById('tool-zoom-in')?.addEventListener('click',  () => map.zoomIn());
document.getElementById('tool-zoom-out')?.addEventListener('click', () => map.zoomOut());
document.getElementById('tool-home')?.addEventListener('click',     () => map.setView([39.0, 35.0], 6));

document.getElementById('tool-google')?.addEventListener('click', () => {
    map.removeLayer(currentBase); currentBase = googleSat; googleSat.addTo(map);
});
document.getElementById('tool-sat')?.addEventListener('click', () => {
    map.removeLayer(currentBase); currentBase = esriSat; esriSat.addTo(map);
});
document.getElementById('tool-street')?.addEventListener('click', () => {
    map.removeLayer(currentBase); currentBase = streetMap; streetMap.addTo(map);
});
document.getElementById('tool-blank')?.addEventListener('click', () => {
    map.removeLayer(currentBase); 
    // Boş bir katman oluştur (Beyaz)
    currentBase = L.tileLayer(''); 
    // Veya sadece boş bırakmak istersen hiç ekleme ama stil bozulmasın diye arkaplanı elle de boyayabiliriz
});
document.getElementById('tool-labels')?.addEventListener('click', () => {
    labelsVisible = !labelsVisible;
    labelsVisible ? labelLayer.addTo(map) : map.removeLayer(labelLayer);
});

map.on('mousemove', (e) => {
    const bar = document.getElementById('coord-bar');
    if (bar) bar.textContent = `Lat: ${e.latlng.lat.toFixed(6)} | Lon: ${e.latlng.lng.toFixed(6)}`;
});

// ── SONUÇ PANELİ KONTROLLERI ─────────────────────────────────────────────────
document.getElementById('minimize-results')?.addEventListener('click', () => {
    document.getElementById('results-panel').classList.toggle('minimized');
});
document.getElementById('close-results')?.addEventListener('click', () => {
    document.getElementById('results-panel').classList.add('hidden');
});
document.getElementById('btn-zoom')?.addEventListener('click', () => {
    if (currentParcelLayer) map.fitBounds(currentParcelLayer.getBounds(), { padding: [60, 60] });
});
document.getElementById('btn-coords')?.addEventListener('click', () => {
    if (!currentFeature) return;
    showCoordsModal(currentFeature);
});

// ── KOORDİNAT MODALİ ─────────────────────────────────────────────────────────
proj4.defs([
    ['EPSG:5254', '+proj=tmerc +lat_0=0 +lon_0=30 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs'],
    ['EPSG:5255', '+proj=tmerc +lat_0=0 +lon_0=33 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs'],
    ['EPSG:5256', '+proj=tmerc +lat_0=0 +lon_0=36 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs'],
    ['EPSG:5257', '+proj=tmerc +lat_0=0 +lon_0=39 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs'],
    ['EPSG:5258', '+proj=tmerc +lat_0=0 +lon_0=42 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs'],
    ['EPSG:5259', '+proj=tmerc +lat_0=0 +lon_0=45 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs'],
]);

function detectZone(lon) {
    if (lon < 31.5) return 'EPSG:5254';
    if (lon < 34.5) return 'EPSG:5255';
    if (lon < 37.5) return 'EPSG:5256';
    if (lon < 40.5) return 'EPSG:5257';
    if (lon < 43.5) return 'EPSG:5258';
    return 'EPSG:5259';
}

function showCoordsModal(feature) {
    const tbody = document.getElementById('coords-tbody');
    if (!tbody) return;
    const ring = feature.geometry.type === 'MultiPolygon'
        ? feature.geometry.coordinates[0][0]
        : feature.geometry.coordinates[0];
    const zone = detectZone(ring[0][0]);
    tbody.innerHTML = '';
    const rows = [];
    ring.forEach((coord, i) => {
        const [Y, X] = proj4('EPSG:4326', zone, [coord[0], coord[1]]);
        rows.push({ i: i + 1, Y: Y.toFixed(3), X: X.toFixed(3) });
        tbody.innerHTML += `<tr><td class="ps-3">${i + 1}</td><td>${Y.toFixed(3)}</td><td>${X.toFixed(3)}</td></tr>`;
    });
    // Bootstrap modal aç
    const modal = new bootstrap.Modal(document.getElementById('coordsModal'));
    modal.show();

    document.getElementById('copy-all-coords').onclick = () => {
        const text = rows.map(r => `${r.i}\t${r.Y}\t${r.X}`).join('\n');
        navigator.clipboard.writeText(text).then(() => alert('Koordinatlar kopyalandı!'));
    };
}

// ── KML YÜKLEYİCİ ────────────────────────────────────────────────────────────
const kmlLayers = {};
const kmlDrop   = document.getElementById('kml-drop');
const kmlInput  = document.getElementById('kml-input');
const kmlList   = document.getElementById('kml-list');

if (kmlDrop && kmlInput) {
    kmlDrop.addEventListener('click', () => kmlInput.click());
    kmlDrop.addEventListener('dragover',  (e) => { e.preventDefault(); kmlDrop.classList.add('dragover'); });
    kmlDrop.addEventListener('dragleave', () => kmlDrop.classList.remove('dragover'));
    kmlDrop.addEventListener('drop', (e) => { e.preventDefault(); kmlDrop.classList.remove('dragover'); handleKmlFiles(e.dataTransfer.files); });
    kmlInput.addEventListener('change', (e) => handleKmlFiles(e.target.files));
}

function handleKmlFiles(files) {
    Array.from(files).forEach(file => {
        const url = URL.createObjectURL(file);
        omnivore.kml(url).on('ready', function () {
            map.fitBounds(this.getBounds());
            const id = 'kml_' + Date.now();
            kmlLayers[id] = { layer: this, visible: true, name: file.name };
            addLayerItem(kmlList, id, file.name, 'KML', kmlLayers);
        }).addTo(map);
    });
}

// ── DXF YÜKLEYİCİ ────────────────────────────────────────────────────────────
const dxfLayers = {};
const dxfDrop   = document.getElementById('dxf-drop');
const dxfInput  = document.getElementById('dxf-input');
const dxfList   = document.getElementById('dxf-list');
const dxfProj   = document.getElementById('dxf-proj');

if (dxfDrop && dxfInput) {
    dxfDrop.addEventListener('click', () => dxfInput.click());
    dxfDrop.addEventListener('dragover',  (e) => { e.preventDefault(); dxfDrop.classList.add('dragover'); });
    dxfDrop.addEventListener('dragleave', () => dxfDrop.classList.remove('dragover'));
    dxfDrop.addEventListener('drop', (e) => { e.preventDefault(); dxfDrop.classList.remove('dragover'); handleDxfFiles(e.dataTransfer.files); });
    dxfInput.addEventListener('change', (e) => handleDxfFiles(e.target.files));
}

dxfProj?.addEventListener('change', () => {
    document.getElementById('custom-proj-div')?.classList.toggle('d-none', dxfProj.value !== 'CUSTOM');
});

function handleDxfFiles(files) {
    const projCode = dxfProj?.value || 'EPSG:5257';
    const fromProj = projCode === 'CUSTOM'
        ? document.getElementById('custom-proj-input').value.trim()
        : projCode;
    if (projCode === 'CUSTOM' && !fromProj) { alert('Proj4 tanımını giriniz.'); return; }
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const dxf = new DxfParser().parseSync(e.target.result);
                processDxf(dxf, file.name, fromProj);
            } catch { alert('DXF okunamadı: ' + file.name); }
        };
        reader.readAsText(file);
    });
}

function processDxf(dxf, name, fromProj) {
    const group = L.featureGroup();
    const tr = (x, y) => { const p = proj4(fromProj, 'EPSG:4326', [x, y]); return [p[1], p[0]]; };
    (dxf.entities || []).forEach(ent => {
        try {
            if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
                const coords = ent.vertices.map(v => tr(v.x, v.y));
                const closed = ent.shape || ent.closed;
                (closed ? L.polygon(coords, { color: '#e11d48', weight: 2 }) : L.polyline(coords, { color: '#3388ff' })).addTo(group);
            } else if (ent.type === 'LINE') {
                L.polyline([tr(ent.vertices[0].x, ent.vertices[0].y), tr(ent.vertices[1].x, ent.vertices[1].y)], { color: '#3388ff' }).addTo(group);
            } else if (ent.type === 'CIRCLE' || ent.type === 'ARC') {
                L.circleMarker(tr(ent.center.x, ent.center.y), { radius: 4, color: '#f59e0b' }).addTo(group);
            } else if ((ent.type === 'TEXT' || ent.type === 'MTEXT') && ent.text) {
                const pt = ent.startPoint || ent.position;
                if (pt) L.marker(tr(pt.x, pt.y), {
                    icon: L.divIcon({ className: '', html: `<div style="font-size:10px;color:#fff;text-shadow:1px 1px #000;white-space:nowrap">${ent.text}</div>`, iconSize: [0, 0] }),
                    interactive: false
                }).addTo(group);
            }
        } catch { /* skip malformed */ }
    });
    if (group.getLayers().length > 0) {
        group.addTo(map);
        map.fitBounds(group.getBounds(), { padding: [30, 30] });
        const id = 'dxf_' + Date.now();
        dxfLayers[id] = { layer: group, visible: true, name };
        addLayerItem(dxfList, id, name, 'DXF', dxfLayers);
    } else {
        alert('DXF içinde desteklenen geometri bulunamadı.');
    }
}

// ── WMS ───────────────────────────────────────────────────────────────────────
const wmsLayers = {};
const wmsList   = document.getElementById('wms-list');

document.getElementById('add-wms-btn')?.addEventListener('click', () => {
    const url  = document.getElementById('wms-url').value.trim();
    const lyrs = document.getElementById('wms-layers').value.trim();
    const ttl  = document.getElementById('wms-title').value.trim() || lyrs;
    if (!url || !lyrs) { alert('URL ve katman adını giriniz.'); return; }
    addWmsLayer(url, lyrs, ttl);
});

function addWmsLayer(url, layers, title) {
    const layer = L.tileLayer.wms(url, { layers, format: 'image/png', transparent: true, version: '1.1.1' }).addTo(map);
    const id = 'wms_' + Date.now();
    wmsLayers[id] = { layer, visible: true, name: title };
    if (wmsList) addLayerItem(wmsList, id, title, 'WMS', wmsLayers);
}

// ── LAYER LİST YARDIMCISI ─────────────────────────────────────────────────────
function addLayerItem(listEl, id, name, type, store) {
    if (!listEl) return;
    const item = document.createElement('div');
    item.className = 'layer-item';
    item.id = 'li_' + id;
    item.innerHTML = `
        <span class="layer-item-name" title="${name}">${name}</span>
        <span class="layer-item-type">${type}</span>
        <div class="layer-item-actions">
            <button class="btn-vis" title="Göster/Gizle"><i class="fa fa-eye"></i></button>
            <button class="btn-del" title="Sil"><i class="fa fa-trash"></i></button>
        </div>`;
    item.querySelector('.btn-vis').addEventListener('click', () => {
        const e = store[id];
        if (e.visible) map.removeLayer(e.layer); else e.layer.addTo(map);
        e.visible = !e.visible;
        item.querySelector('.btn-vis i').className = e.visible ? 'fa fa-eye' : 'fa fa-eye-slash';
    });
    item.querySelector('.btn-del').addEventListener('click', () => {
        map.removeLayer(store[id].layer);
        delete store[id];
        item.remove();
    });
    listEl.appendChild(item);
}

// ── İMAR PLANI ────────────────────────────────────────────────────────────────
// Yardımcı: SVG'yi fetch edip L.svgOverlay olarak yükle (zoom'da keskin kalır)
async function loadSvgOverlay(svgUrl, bounds, opacity = 0.85) {
    const response = await fetch(svgUrl);
    if (!response.ok) throw new Error('SVG dosyası yüklenemedi: ' + svgUrl);
    const svgText = await response.text();
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = document.importNode(svgDoc.documentElement, true);
    return L.svgOverlay(svgEl, bounds, { opacity, zIndex: 1000 });
}

let golyaziPlan = null;
const toggleGolyaziSvg = document.getElementById('toggleGolyaziSvg');
if (toggleGolyaziSvg) {
    toggleGolyaziSvg.addEventListener('change', async (e) => {
        if (e.target.checked) {
            if (!golyaziPlan) {
                try {
                    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                    const svgUrl = isLocal ? 'http://localhost:3002/GOLYAZI_geo.svg' : 'GOLYAZI_geo.svg';
                    const bounds = [[38.541545, 33.181597], [38.575704, 33.207398]];
                    golyaziPlan = await loadSvgOverlay(svgUrl, bounds);
                } catch (err) {
                    alert('Gölyazı SVG yüklenemedi: ' + err.message);
                    e.target.checked = false;
                    return;
                }
            }
            golyaziPlan.addTo(map);
            map.fitBounds(golyaziPlan.getBounds());
        } else {
            if (golyaziPlan && map.hasLayer(golyaziPlan)) map.removeLayer(golyaziPlan);
        }
    });
}

const toggleGolyaziDxf = document.getElementById('toggleGolyaziDxf');
let golyaziDxfLayer = null;

if (toggleGolyaziDxf) {
    toggleGolyaziDxf.addEventListener('change', async (e) => {
        if (e.target.checked) {
            if (!golyaziDxfLayer) {
                try {
                    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                    const dataUrl = isLocal ? 'http://localhost:3002/GOLYAZI_DATA.txt' : 'GOLYAZI_DATA.txt';
                    
                    const response = await fetch(dataUrl);
                    if (!response.ok) throw new Error('Veri dosyası sunucuda bulunamadı.');
                    const leanData = await response.json();
                    
                    const group = L.featureGroup();
                    const fromProj = 'EPSG:5255'; 
                    const tr = (x, y) => { 
                        const p = proj4(fromProj, 'EPSG:4326', [x, y]); 
                        return [p[1], p[0]]; 
                    };

                    leanData.entities.forEach(ent => {
                        try {
                            const coords = ent.vertices.map(v => tr(v.x, v.y));
                            if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
                                L.polygon(coords, { color: '#e11d48', weight: 1.5, fill: false, interactive: false }).addTo(group);
                            } else if (ent.type === 'LINE') {
                                L.polyline(coords, { color: '#e11d48', weight: 1, interactive: false }).addTo(group);
                            }
                        } catch(err) {}
                    });

                    if (group.getLayers().length > 0) {
                        golyaziDxfLayer = group;
                    } else {
                        throw new Error('DXF içinde okunabilir çizgi bulunamadı.');
                    }
                } catch (err) {
                    alert('Hata: ' + err.message);
                    e.target.checked = false;
                    return;
                }
            }
            golyaziDxfLayer.addTo(map);
            map.fitBounds(golyaziDxfLayer.getBounds());
        } else {
            if (golyaziDxfLayer && map.hasLayer(golyaziDxfLayer)) map.removeLayer(golyaziDxfLayer);
        }
    });
}

// ── CİHANBEYLİ İMAR PLANI ────────────────────────────────────────────────────
let cihanbeylPlan = null;
const toggleCihanbeylSvg = document.getElementById('toggleCihanbeylSvg');
if (toggleCihanbeylSvg) {
    toggleCihanbeylSvg.addEventListener('change', async (e) => {
        if (e.target.checked) {
            if (!cihanbeylPlan) {
                try {
                    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                    const svgUrl = isLocal ? 'http://localhost:3002/CIHANBEYLIIMAR_geo.svg' : 'CIHANBEYLIIMAR_geo.svg';
                    // EPSG:5255 (TM33) → WGS84 dönüşümü ile hesaplanmış sınırlar (CIRCLE+ARC dahil)
                    const bounds = [[38.591216, 32.881177], [38.689964, 32.949937]];
                    cihanbeylPlan = await loadSvgOverlay(svgUrl, bounds);
                } catch (err) {
                    alert('Cihanbeyli SVG yüklenemedi: ' + err.message);
                    e.target.checked = false;
                    return;
                }
            }
            cihanbeylPlan.addTo(map);
            map.fitBounds(cihanbeylPlan.getBounds());
        } else {
            if (cihanbeylPlan && map.hasLayer(cihanbeylPlan)) map.removeLayer(cihanbeylPlan);
        }
    });
}

const toggleCihanbeylDxf = document.getElementById('toggleCihanbeylDxf');
let cihanbeylDxfLayer = null;

// Katman adına göre renk döndür
function cihanbeylLayerColor(layer) {
    const l = (layer || '').toUpperCase();
    if (l.includes('ADAKENARI') || l.includes('ADA')) return '#cc0000';
    if (l.includes('PARSEL'))      return '#990000';
    if (l.includes('YOL'))         return '#555555';
    if (l.includes('YESIL') || l.includes('PARK')) return '#228b22';
    if (l.includes('KONUT'))       return '#8b4513';
    if (l.includes('TICARET'))     return '#8b0000';
    if (l.includes('CEKME') || l.includes('YAPIYAKLASMA')) return '#0055ff';
    if (l.includes('SOSYAL') || l.includes('EGITIM')) return '#007acc';
    if (l.includes('SAGLIK'))      return '#cc0077';
    if (l.includes('DIN') || l.includes('CAMI')) return '#663399';
    if (l.includes('SANAYI'))      return '#6b7280';
    return '#1e3a8a'; // varsayılan koyu mavi
}

if (toggleCihanbeylDxf) {
    toggleCihanbeylDxf.addEventListener('change', async (e) => {
        if (e.target.checked) {
            if (!cihanbeylDxfLayer) {
                try {
                    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                    const dataUrl = isLocal ? 'http://localhost:3002/CIHANBEYLIIMAR_DATA.txt' : 'CIHANBEYLIIMAR_DATA.txt';

                    const response = await fetch(dataUrl);
                    if (!response.ok) throw new Error('Cihanbeyli veri dosyası bulunamadı.');
                    const data = await response.json();

                    const group = L.featureGroup();

                    data.entities.forEach(ent => {
                        try {
                            const color = cihanbeylLayerColor(ent.layer);

                            if (ent.t === 'L') {
                                // LINE — koordinatlar zaten WGS84 [lat, lon]
                                const pts = ent.v.map(p => [p.lat, p.lon]);
                                L.polyline(pts, { color, weight: 1, interactive: false }).addTo(group);

                            } else if (ent.t === 'P') {
                                // Kapalı POLYLINE (polygon)
                                const pts = ent.v.map(p => [p.lat, p.lon]);
                                L.polygon(pts, { color, weight: 1.5, fill: false, interactive: false }).addTo(group);

                            } else if (ent.t === 'PL') {
                                // Açık POLYLINE
                                const pts = ent.v.map(p => [p.lat, p.lon]);
                                L.polyline(pts, { color, weight: 1.5, interactive: false }).addTo(group);

                            } else if (ent.t === 'C') {
                                // CIRCLE — center WGS84, r metre
                                L.circle([ent.center.lat, ent.center.lon], {
                                    radius: ent.r,
                                    color,
                                    weight: 1.5,
                                    fill: false,
                                    interactive: false
                                }).addTo(group);

                            } else if (ent.t === 'A') {
                                // ARC — polyline olarak yaklaşık
                                const pts = ent.v.map(p => [p.lat, p.lon]);
                                L.polyline(pts, { color, weight: 1.2, interactive: false }).addTo(group);
                            }
                        } catch (err) {}
                    });

                    if (group.getLayers().length > 0) {
                        cihanbeylDxfLayer = group;
                    } else {
                        throw new Error('Veri dosyasında okunabilir geometri bulunamadı.');
                    }
                } catch (err) {
                    alert('Hata: ' + err.message);
                    e.target.checked = false;
                    return;
                }
            }
            cihanbeylDxfLayer.addTo(map);
            map.fitBounds(cihanbeylDxfLayer.getBounds());
        } else {
            if (cihanbeylDxfLayer && map.hasLayer(cihanbeylDxfLayer)) map.removeLayer(cihanbeylDxfLayer);
        }
    });
}

// ── TECVİZ ────────────────────────────────────────────────────────────────────
const tecvizMethod = document.getElementById('tecviz-method');
const legacyOpts   = document.getElementById('legacy-options');

tecvizMethod?.addEventListener('change', () => {
    legacyOpts?.classList.toggle('d-none', tecvizMethod.value !== 'legacy');
});

document.getElementById('tecviz-mp-type')?.addEventListener('change', function () {
    document.getElementById('custom-mp-div')?.classList.toggle('d-none', this.value !== 'custom');
});

document.getElementById('calc-tecviz-btn')?.addEventListener('click', () => {
    const F = parseFloat(document.getElementById('tecviz-area-tapu').value);
    const f = parseFloat(document.getElementById('tecviz-area-hesap').value);
    if (isNaN(F) || isNaN(f)) { alert('Alan değerlerini giriniz.'); return; }

    let dy;
    if (tecvizMethod?.value === 'legacy') {
        const mpSel = document.getElementById('tecviz-mp-type');
        const mp = mpSel.value === 'custom'
            ? parseFloat(document.getElementById('custom-mp-input').value)
            : parseFloat(mpSel.value);
        dy = 2.5 * mp * Math.sqrt(F);
    } else {
        dy = Math.max(0.2 * Math.sqrt(F), 3);
    }

    const diff = Math.abs(F - f);
    document.getElementById('t-value').textContent     = dy.toFixed(2) + ' m²';
    document.getElementById('t-diff').textContent      = diff.toFixed(2) + ' m²';
    document.getElementById('t-range-min').textContent = (F - dy).toFixed(2) + ' m²';
    document.getElementById('t-range-max').textContent = (F + dy).toFixed(2) + ' m²';

    const box = document.getElementById('t-status-box');
    if (diff <= dy) {
        box.style.background = '#dcfce7'; box.style.color = '#166534';
        box.textContent = '✅ TECVİZ İÇİNDE – Alan farkı kabul sınırları içindedir.';
    } else {
        box.style.background = '#fee2e2'; box.style.color = '#991b1b';
        box.textContent = '❌ TECVİZ DIŞINDA – Alan farkı kabul sınırlarını aşıyor!';
    }
    document.getElementById('tecviz-result-div').classList.remove('d-none');
});

// ── BAŞLAT ────────────────────────────────────────────────────────────────────
loadProvinces();

// ── MOBİL VE MASAÜSTÜ MENÜ KONTROLLERİ ──────────────────────────────────────
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const sidePanel = document.getElementById('sidePanel');
const mobileBackdrop = document.getElementById('mobileBackdrop');

function toggleMobileMenu() {
    if (window.innerWidth <= 768) {
        // Mobil davranış: Çekmece gibi soldan çıkar, arkayı karartır
        sidePanel.classList.toggle('mobile-open');
        mobileBackdrop.classList.toggle('show');
        
        // İkonu değiştir
        const icon = mobileMenuBtn.querySelector('i');
        if (sidePanel.classList.contains('mobile-open')) {
            icon.classList.remove('fa-bars');
            icon.classList.add('fa-times');
        } else {
            icon.classList.remove('fa-times');
            icon.classList.add('fa-bars');
        }
    } else {
        // Masaüstü davranış: Menüyü sola katla/aç
        sidePanel.classList.toggle('desktop-collapsed');
        
        // Masaüstünde haritanın boyutunu invalidate() ile güncelle
        setTimeout(() => { if (map) map.invalidateSize(); }, 350);
    }
}

if (mobileMenuBtn && sidePanel && mobileBackdrop) {
    mobileMenuBtn.addEventListener('click', toggleMobileMenu);
    mobileBackdrop.addEventListener('click', toggleMobileMenu);
}

// Mobilde bir butona tıklandıktan sonra otomatik kapat
document.getElementById('search-btn')?.addEventListener('click', () => {
    if (window.innerWidth <= 768 && sidePanel.classList.contains('mobile-open')) {
        toggleMobileMenu();
    }
});
