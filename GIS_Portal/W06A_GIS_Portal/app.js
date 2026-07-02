// ==========================================================================
// W06A GIS Portal v2 - 環保設施氣候風險套疊決策支援系統
// 升級：Layer Registry 多主題點位切換架構
// ==========================================================================

// ==========================================================================
// Application State & Initialization
// ==========================================================================
let map;
let baseTileLayer = null;
let labelTileLayer = null;
let townGeoJsonData = null;
let originalTownGeoJson = null;

let townLayer = null;
let pointLayer = null;   // 統一取代舊的 daycareLayer
let riskChart = null;

let activeTheme = 'flood';       // 'flood' or 'temp'
let activeScenario = 'current';
let activeFloodLayers = { ncdr: true, wra: false };
let activeWraScenario = 'gwl15';
let riskMapOpacity = 0.7;
let activeTempRiskMode = 'mean';
let selectedTown = null;

// 點位主題：'daycare' | 'env_hq' | 'env_rec' | 'env_all'
let activePointTheme = 'env_hq';

let wraGeoJson350 = null;
let wraGeoJson650 = null;
let wraLayer = null;
let pointIntersectResults = {}; // point name -> depth_type

// ==========================================================================
// Layer Registry - 點位主題設定表
// ==========================================================================
const POINT_REGISTRY = {
    daycare: {
        label: '日照機構',
        listTitle: '本區日照機構列表',
        statLabel: '日照/小規機特約單位',
        statIcon: 'fa-house-chimney-medical',
        highRiskLabel: '第 4-5 級警戒機構 (Lv.4-5)',
        file: 'daycare_points.json',
        data: null,
        filterCategory: null,   // null = all
        markerColorFn: (props) => {
            const map = { '混合型': '#60a5fa', '失智型': '#fb7185', '失能型': '#34d399' };
            return map[props.case_type] || '#94a3b8';
        },
        popupFn: renderDaycarePopup,
        listFn:  renderDaycareListItem,
        legendFn: renderDaycareLegend,
    },
    env_hq: {
        label: '清潔隊隊部',
        listTitle: '本區清潔隊部列表',
        statLabel: '清潔隊隊部',
        statIcon: 'fa-truck',
        highRiskLabel: '第 4-5 級警戒隊部',
        file: 'env_facilities.json',
        data: null,
        filterCategory: '清潔隊部',
        markerColorFn: () => '#f59e0b',   // Amber
        popupFn: renderEnvPopup,
        listFn:  renderEnvListItem,
        legendFn: renderEnvHQLegend,
    },
    env_rec: {
        label: '資源回收場',
        listTitle: '本區資源回收場列表',
        statLabel: '清潔隊資源回收場',
        statIcon: 'fa-recycle',
        highRiskLabel: '第 4-5 級警戒回收場',
        file: 'env_facilities.json',
        data: null,   // shared with env_hq
        filterCategory: '資源回收場',
        markerColorFn: () => '#10b981',   // Emerald
        popupFn: renderEnvPopup,
        listFn:  renderEnvListItem,
        legendFn: renderEnvRecLegend,
    },
    env_all: {
        label: '全部設施',
        listTitle: '本區環保設施列表',
        statLabel: '環保清潔設施（合計）',
        statIcon: 'fa-map-pin',
        highRiskLabel: '第 4-5 級警戒設施',
        file: 'env_facilities.json',
        data: null,
        filterCategory: null,
        markerColorFn: (props) => {
            return props.category === '清潔隊部' ? '#f59e0b' : '#10b981';
        },
        popupFn: renderEnvPopup,
        listFn:  renderEnvListItem,
        legendFn: renderEnvAllLegend,
    }
};

// ==========================================================================
// Helper state functions
// ==========================================================================
function isWraLayerEnabled() {
    return activeTheme === 'flood' && activeFloodLayers.wra;
}
function isNcdrLayerEnabled() {
    return activeTheme === 'temp' || (activeTheme === 'flood' && activeFloodLayers.ncdr);
}
function getActiveFloodLayerNames() {
    const names = [];
    if (activeFloodLayers.ncdr) names.push('NCDR 鄉鎮風險');
    if (activeFloodLayers.wra) names.push('水利署潛勢圖');
    return names;
}
function getActiveWraScenario() {
    return activeFloodLayers.wra && !activeFloodLayers.ncdr ? activeScenario : activeWraScenario;
}
function getWraScenarioName() {
    return getActiveWraScenario() === 'gwl20' ? '650mm / 24HR 極端降雨' : '350mm / 24HR 暴雨模擬';
}
function getTownRiskFillOpacity() { return riskMapOpacity; }
function getTownRiskHighlightOpacity() { return Math.min(riskMapOpacity + 0.1, 1); }

// Current registry entry
function getRegistry() { return POINT_REGISTRY[activePointTheme]; }

// Get filtered features from the registry
function getActivePointFeatures() {
    const reg = getRegistry();
    const data = reg.data;
    if (!data || !data.features) return [];
    if (reg.filterCategory) {
        return data.features.filter(f => f.properties.category === reg.filterCategory);
    }
    return data.features;
}

// ==========================================================================
// Base map tile themes
// ==========================================================================
const mapTileThemes = {
    dark: {
        base: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
        labels: 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png'
    },
    light: {
        base: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
        labels: 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png'
    },
};

function getSavedColorTheme() {
    try {
        const theme = window.localStorage.getItem('cool-color-theme');
        return theme === 'light' || theme === 'dark' ? theme : 'dark';
    } catch { return 'dark'; }
}
function saveColorTheme(theme) {
    try { window.localStorage.setItem('cool-color-theme', theme); } catch {}
}
function getChartThemeColors() {
    const styles = getComputedStyle(document.documentElement);
    return {
        tick: styles.getPropertyValue('--text-secondary').trim() || '#94a3b8',
        grid: styles.getPropertyValue('--border-color').trim() || 'rgba(255,255,255,0.08)'
    };
}
function updateChartTheme() {
    if (!riskChart) return;
    const c = getChartThemeColors();
    riskChart.options.scales.x.ticks.color = c.tick;
    riskChart.options.scales.y.ticks.color = c.tick;
    riskChart.options.scales.y.grid.color  = c.grid;
    riskChart.update();
}
function applyColorTheme(theme) {
    const next = theme === 'light' || theme === 'dark' ? theme : 'dark';
    document.documentElement.dataset.colorTheme = next;
    saveColorTheme(next);
    const sel = document.getElementById('color-theme-select');
    if (sel) sel.value = next;
    applyMapTileTheme(next);
    updateChartTheme();
}
function applyMapTileTheme(theme) {
    if (!map) return;
    const t = mapTileThemes[theme] || mapTileThemes.dark;
    if (baseTileLayer) map.removeLayer(baseTileLayer);
    if (labelTileLayer) map.removeLayer(labelTileLayer);
    baseTileLayer = L.tileLayer(t.base, { maxZoom: 20, subdomains: 'abcd' }).addTo(map);
    labelTileLayer = L.tileLayer(t.labels, {
        maxZoom: 20, subdomains: 'abcd',
        pane: 'labels'
    }).addTo(map);
}

// ==========================================================================
// Risk Color Maps
// ==========================================================================
const riskColors = {
    1: '#10b981', 2: '#84cc16', 3: '#eab308', 4: '#f97316', 5: '#ef4444'
};
const wraColors  = {
    2: '#93c5fd', 3: '#3b82f6', 4: '#f97316', 5: '#ef4444', 6: '#a855f7'
};

// ==========================================================================
// Document Ready
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupUIControls();
    loadData();
});

// ==========================================================================
// Map Initialization
// ==========================================================================
function initMap() {
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([23.97, 120.46], 10.5);

    map.createPane('towns');
    map.getPane('towns').style.zIndex = 300;

    map.createPane('labels');
    map.getPane('labels').style.zIndex = 350;
    map.getPane('labels').style.pointerEvents = 'none';

    applyMapTileTheme(getSavedColorTheme());
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    addLegend();
}

// ==========================================================================
// Data Loading
// ==========================================================================
function loadData() {
    // Always load town polygons + daycare data (for daycare theme)
    // env_facilities.json is shared across env_hq / env_rec / env_all
    Promise.all([
        fetch(`changhua_towns.json?t=${Date.now()}`).then(r => r.json()),
        fetch(`daycare_points.json?t=${Date.now()}`).then(r => r.json()),
        fetch(`env_facilities.json?t=${Date.now()}`).then(r => r.json()),
    ]).then(([towns, daycares, envFacilities]) => {
        originalTownGeoJson = towns;

        // Store in registry
        POINT_REGISTRY.daycare.data  = daycares;
        POINT_REGISTRY.env_hq.data   = envFacilities;
        POINT_REGISTRY.env_rec.data  = envFacilities;
        POINT_REGISTRY.env_all.data  = envFacilities;

        applyCalibration();
        updateStatTotalCard();
    }).catch(err => console.error('Error loading GIS data:', err));
}

// ==========================================================================
// Coordinate Calibration
// ==========================================================================
let activeWraData = null;

function applyCalibration() {
    if (!originalTownGeoJson) return;

    const lonShift   = parseFloat(document.getElementById('slider-lon-shift').value);
    const latShift   = parseFloat(document.getElementById('slider-lat-shift').value);
    const scaleFactor = parseFloat(document.getElementById('slider-scale').value);

    document.getElementById('val-lon-shift').innerText = (lonShift >= 0 ? '+' : '') + lonShift.toFixed(5);
    document.getElementById('val-lat-shift').innerText = (latShift >= 0 ? '+' : '') + latShift.toFixed(5);
    document.getElementById('val-scale').innerText = scaleFactor.toFixed(5);

    townGeoJsonData = JSON.parse(JSON.stringify(originalTownGeoJson));

    const originLon = 120.45, originLat = 23.95;
    function transformCoords(coords, dx, dy, scale) {
        if (typeof coords[0] === 'number') {
            coords[0] = originLon + (coords[0] - originLon) * scale + dx;
            coords[1] = originLat + (coords[1] - originLat) * scale + dy;
        } else { coords.forEach(c => transformCoords(c, dx, dy, scale)); }
    }
    townGeoJsonData.features.forEach(f => {
        if (f.geometry && f.geometry.coordinates)
            transformCoords(f.geometry.coordinates, lonShift, latShift, scaleFactor);
    });

    activeWraData = null;
    if (isWraLayerEnabled()) {
        const originalWra = getActiveWraScenario() === 'gwl20' ? wraGeoJson650 : wraGeoJson350;
        if (originalWra) {
            activeWraData = JSON.parse(JSON.stringify(originalWra));
            activeWraData.features.forEach(f => {
                if (f.geometry && f.geometry.coordinates)
                    transformCoords(f.geometry.coordinates, lonShift, latShift, scaleFactor);
            });
        }
    }

    updateLayers();
    updateStatsAndChart();
    populatePointList();
}

// ==========================================================================
// Risk Field Helpers
// ==========================================================================
function getActiveRiskField() {
    if (activeTheme === 'flood') {
        return activeScenario === 'current' ? 'flood_risk_current' : 'flood_risk_future';
    } else {
        const mode = activeTempRiskMode === 'max' ? 'max' : 'mean';
        return `temp_risk_${mode}_${activeScenario}`;
    }
}
function getActiveHazardField() {
    if (activeTheme === 'flood') {
        return activeScenario === 'current' ? 'flood_hazard_current' : 'flood_hazard_future';
    } else {
        const m = { current: 'temp_hazard_current', gwl15: 'temp_hazard_gwl15', gwl20: 'temp_hazard_gwl20', gwl40: 'temp_hazard_gwl40' };
        return m[activeScenario] || 'temp_hazard_current';
    }
}
function getActiveVulnerabilityField() {
    return activeTheme === 'flood' ? 'flood_vulnerability' : 'temp_vulnerability';
}

// ==========================================================================
// Point-in-Polygon (WRA intersection)
// ==========================================================================
function isPointInMultiPolygon(x, y, coordinates) {
    for (let poly of coordinates) {
        let exterior = poly[0];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let pt of exterior) {
            if (pt[0] < minX) minX = pt[0]; if (pt[0] > maxX) maxX = pt[0];
            if (pt[1] < minY) minY = pt[1]; if (pt[1] > maxY) maxY = pt[1];
        }
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        let inside = false, n = exterior.length;
        let p1x = exterior[0][0], p1y = exterior[0][1];
        for (let i = 0; i <= n; i++) {
            let p2 = exterior[i % n], p2x = p2[0], p2y = p2[1];
            if (y > Math.min(p1y, p2y)) {
                if (y <= Math.max(p1y, p2y)) {
                    if (x <= Math.max(p1x, p2x)) {
                        if (p1y !== p2y) { var xi = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x; }
                        if (p1x === p2x || x <= xi) inside = !inside;
                    }
                }
            }
            p1x = p2x; p1y = p2y;
        }
        if (inside) return true;
    }
    return false;
}

function computeIntersections() {
    pointIntersectResults = {};
    if (activeTheme === 'flood' && activeFloodLayers.wra && activeWraData) {
        const features = getActivePointFeatures();
        features.forEach(pt => {
            const [x, y] = pt.geometry.coordinates;
            for (let feat of activeWraData.features) {
                if (isPointInMultiPolygon(x, y, feat.geometry.coordinates)) {
                    pointIntersectResults[pt.properties.name] = feat.properties.depth_type;
                    break;
                }
            }
        });
    }
}

// ==========================================================================
// Layer Rendering
// ==========================================================================
function updateLayers() {
    if (!townGeoJsonData) return;

    if (townLayer)  map.removeLayer(townLayer);
    if (pointLayer) map.removeLayer(pointLayer);
    if (wraLayer)   map.removeLayer(wraLayer);

    computeIntersections();

    // 1. WRA Flood Layer
    if (activeTheme === 'flood' && activeFloodLayers.wra && activeWraData) {
        wraLayer = L.geoJSON(activeWraData, {
            style: (feature) => ({
                fillColor: wraColors[feature.properties.grid_code || 2] || '#93c5fd',
                fillOpacity: 0.65,
                color: 'rgba(255,255,255,0.1)',
                weight: 0.8
            }),
            onEachFeature: (feature, layer) => {
                const depth = feature.properties.depth_type || '';
                layer.bindPopup(`<div class="popup-container" style="padding:4px"><h4 style="margin:0 0 4px;color:#60a5fa"><i class="fa-solid fa-water"></i> 水利署淹水潛勢</h4>淹水深度：<strong>${depth} 公尺</strong></div>`);
            }
        }).addTo(map);
    }

    // 2. Town Polygons
    const riskField = getActiveRiskField();
    const isNcdrVisible = isNcdrLayerEnabled();
    townLayer = L.geoJSON(townGeoJsonData, {
        pane: 'towns',
        style: (feature) => {
            if (!isNcdrVisible) {
                return { fillColor: 'transparent', fillOpacity: 0, color: 'rgba(255,255,255,0.3)', weight: 1.5, dashArray: '3,4', className: 'town-boundary' };
            }
            const riskVal = feature.properties[riskField] || 1;
            return { fillColor: riskColors[riskVal] || '#ccc', fillOpacity: getTownRiskFillOpacity(), color: 'rgba(255,255,255,0.15)', weight: 1.5, className: 'town-boundary' };
        },
        onEachFeature: onEachTownFeature
    }).addTo(map);

    // 3. Point Markers (dynamic by activePointTheme)
    const reg = getRegistry();
    const features = getActivePointFeatures();
    if (features.length > 0) {
        const fakeGeoJson = { type: 'FeatureCollection', features };
        pointLayer = L.geoJSON(fakeGeoJson, {
            pointToLayer: (feature, latlng) => {
                const props = feature.properties;
                const color = reg.markerColorFn(props);
                const isFlooded = pointIntersectResults[props.name];
                return L.circleMarker(latlng, {
                    radius: isFlooded ? 9 : 7,
                    fillColor: color,
                    fillOpacity: 0.92,
                    color: isFlooded ? '#ef4444' : '#ffffff',
                    weight: isFlooded ? 3 : 1.5,
                    className: isFlooded ? 'daycare-marker warning-pulse' : 'daycare-marker'
                });
            },
            onEachFeature: (feature, layer) => {
                layer.bindPopup(reg.popupFn(feature.properties), { maxWidth: 320 });
            }
        }).addTo(map);
    }
}

// ==========================================================================
// Popup Templates
// ==========================================================================
function renderDaycarePopup(props) {
    const warningDepth = pointIntersectResults[props.name];
    let warningHtml = '';
    if (activeTheme === 'flood' && activeFloodLayers.wra && warningDepth) {
        warningHtml = `<div class="popup-row" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:4px;padding:4px 8px;margin:4px 0 8px">
            <span class="popup-label" style="color:#ef4444;font-weight:bold"><i class="fa-solid fa-triangle-exclamation"></i> 淹水警戒</span>
            <span class="popup-val" style="color:#ef4444;font-weight:bold">${warningDepth} 公尺</span></div>`;
    }
    return `<div class="popup-container">
        <h3 class="popup-title"><i class="fa-solid fa-house-chimney-medical"></i> ${props.name}</h3>
        ${warningHtml}
        <div class="popup-row"><span class="popup-label">服務地區</span><span class="popup-val">${props.town || ''}</span></div>
        <div class="popup-row"><span class="popup-label">個案類型</span><span class="popup-val">${props.case_type || ''}</span></div>
        <div class="popup-row"><span class="popup-label">服務類型</span><span class="popup-val">${props.service_type || ''}</span></div>
        <div class="popup-row"><span class="popup-label">聯絡電話</span><span class="popup-val">${props.phone || '無'}</span></div>
        <div class="popup-row"><span class="popup-label">機構地址</span><span class="popup-val">${props.address || ''}</span></div>
    </div>`;
}

function renderEnvPopup(props) {
    const warningDepth = pointIntersectResults[props.name];
    let warningHtml = '';
    if (activeTheme === 'flood' && activeFloodLayers.wra && warningDepth) {
        warningHtml = `<div class="popup-row" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:4px;padding:4px 8px;margin:4px 0 8px">
            <span class="popup-label" style="color:#ef4444;font-weight:bold"><i class="fa-solid fa-triangle-exclamation"></i> 淹水警戒</span>
            <span class="popup-val" style="color:#ef4444;font-weight:bold">${warningDepth} 公尺</span></div>`;
    }
    const catColor = props.category === '清潔隊部' ? '#f59e0b' : '#10b981';
    const catIcon  = props.category === '清潔隊部' ? 'fa-truck' : 'fa-recycle';
    let shadeHtml = '';
    if (props.shade_info) {
        shadeHtml = `<div class="popup-row"><span class="popup-label"><i class="fa-solid fa-umbrella"></i> 防熱遮蔽</span><span class="popup-val">${props.shade_info}</span></div>`;
    }
    return `<div class="popup-container">
        <h3 class="popup-title" style="color:${catColor}"><i class="fa-solid ${catIcon}"></i> ${props.name}</h3>
        <div class="popup-row"><span class="popup-label">設施類型</span><span class="popup-val" style="color:${catColor};font-weight:600">${props.category}</span></div>
        ${warningHtml}
        <div class="popup-row"><span class="popup-label">所在鄉鎮</span><span class="popup-val">${props.town || ''}</span></div>
        <div class="popup-row"><span class="popup-label">設施地址</span><span class="popup-val">${props.address || ''}</span></div>
        ${shadeHtml}
        <div class="popup-row"><span class="popup-label">聯絡電話</span><span class="popup-val">${props.phone || '無'}</span></div>
    </div>`;
}

// ==========================================================================
// List Item Templates
// ==========================================================================
function renderDaycareListItem(feat) {
    const props = feat.properties;
    const isFlooded = pointIntersectResults[props.name];
    let warningTag = '';
    if (activeTheme === 'flood' && activeFloodLayers.wra && isFlooded) {
        warningTag = `<span class="item-tag tag-warning"><i class="fa-solid fa-triangle-exclamation"></i> 淹水警戒: ${isFlooded}m</span>`;
    }
    return `<div class="daycare-item-title">${props.name}</div>
        <div class="daycare-item-tags">
            <span class="item-tag tag-case">${props.case_type || ''}</span>
            <span class="item-tag tag-service">${props.service_type || ''}</span>
            ${warningTag}
        </div>
        <div class="daycare-item-detail"><i class="fa-solid fa-phone"></i> <span>${props.phone || '無'}</span></div>
        <div class="daycare-item-detail"><i class="fa-solid fa-map-location-dot"></i> <span>${props.address || ''}</span></div>`;
}

function renderEnvListItem(feat) {
    const props = feat.properties;
    const isFlooded = pointIntersectResults[props.name];
    const catColor = props.category === '清潔隊部' ? '#f59e0b' : '#10b981';
    let warningTag = '';
    if (activeTheme === 'flood' && activeFloodLayers.wra && isFlooded) {
        warningTag = `<span class="item-tag tag-warning"><i class="fa-solid fa-triangle-exclamation"></i> 淹水: ${isFlooded}m</span>`;
    }
    let shadeTag = '';
    if (props.shade_info) {
        shadeTag = `<span class="item-tag" style="background:rgba(99,102,241,0.15);color:#818cf8;border:1px solid rgba(99,102,241,0.25)" title="${props.shade_info}"><i class="fa-solid fa-umbrella"></i> 遮蔽</span>`;
    }
    return `<div class="daycare-item-title">${props.name}</div>
        <div class="daycare-item-tags">
            <span class="item-tag" style="background:rgba(${props.category === '清潔隊部' ? '245,158,11' : '16,185,129'},0.15);color:${catColor};border:1px solid ${catColor}40">${props.category}</span>
            ${shadeTag}
            ${warningTag}
        </div>
        <div class="daycare-item-detail"><i class="fa-solid fa-map-location-dot"></i> <span>${props.address || ''}</span></div>`;
}

// ==========================================================================
// Legend Templates
// ==========================================================================
function renderDaycareLegend() {
    return `<div class="legend-title" style="margin-top:10px;border-top:1px dashed rgba(255,255,255,0.1);padding-top:8px">日照機構類型</div>
        <div class="legend-scale">
            <div class="legend-item"><span class="legend-color-box" style="background:#60a5fa;border-radius:50%"></span> <span>混合型機構</span></div>
            <div class="legend-item"><span class="legend-color-box" style="background:#fb7185;border-radius:50%"></span> <span>失智型特約機構</span></div>
            <div class="legend-item"><span class="legend-color-box" style="background:#34d399;border-radius:50%"></span> <span>失能型特約機構</span></div>
        </div>`;
}
function renderEnvHQLegend() {
    return `<div class="legend-title" style="margin-top:10px;border-top:1px dashed rgba(255,255,255,0.1);padding-top:8px">環保設施：清潔隊部</div>
        <div class="legend-scale">
            <div class="legend-item"><span class="legend-color-box" style="background:#f59e0b;border-radius:50%"></span> <span>清潔隊隊部（26 處）</span></div>
        </div>`;
}
function renderEnvRecLegend() {
    return `<div class="legend-title" style="margin-top:10px;border-top:1px dashed rgba(255,255,255,0.1);padding-top:8px">環保設施：資源回收場</div>
        <div class="legend-scale">
            <div class="legend-item"><span class="legend-color-box" style="background:#10b981;border-radius:50%"></span> <span>清潔隊資源回收場（26 處）</span></div>
        </div>`;
}
function renderEnvAllLegend() {
    return `<div class="legend-title" style="margin-top:10px;border-top:1px dashed rgba(255,255,255,0.1);padding-top:8px">環保設施類型</div>
        <div class="legend-scale">
            <div class="legend-item"><span class="legend-color-box" style="background:#f59e0b;border-radius:50%"></span> <span>清潔隊隊部</span></div>
            <div class="legend-item"><span class="legend-color-box" style="background:#10b981;border-radius:50%"></span> <span>資源回收場</span></div>
        </div>`;
}

// ==========================================================================
// Stats & Chart
// ==========================================================================
function updateStatTotalCard() {
    const reg = getRegistry();
    const features = getActivePointFeatures();

    // Update icons and labels
    const iconEl  = document.getElementById('stat-icon-total');
    const labelEl = document.getElementById('stat-label-total');
    const valEl   = document.getElementById('val-total-centers');
    if (iconEl)  iconEl.className = `fa-solid ${reg.statIcon}`;
    if (labelEl) labelEl.innerText = reg.statLabel;
    if (valEl)   valEl.innerText = features.length;

    const hrLabel = document.getElementById('stat-label-highrisk');
    if (hrLabel) hrLabel.innerText = reg.highRiskLabel;

    const listTitle = document.getElementById('list-section-title');
    if (listTitle) listTitle.innerText = reg.listTitle;
}

function updateHighRiskCard(total, label) {
    const card  = document.querySelector('.high-risk-centers');
    const lbl   = card.querySelector('.stat-label');
    const val   = card.querySelector('.stat-value');
    lbl.innerText = label;
    val.innerText  = total;
    if (total > 0) {
        card.classList.add('warning-active');
        val.style.color = '#ef4444';
    } else {
        card.classList.remove('warning-active');
        val.style.color = '';
    }
}

function getRiskDistribution() {
    const riskField = getActiveRiskField();
    const townRisks = {};
    if (!townGeoJsonData) return { totalHighRisk: 0, riskDistribution: {1:0,2:0,3:0,4:0,5:0} };
    townGeoJsonData.features.forEach(f => {
        townRisks[f.properties.town_name] = f.properties[riskField] || 1;
    });
    let totalHighRisk = 0;
    const dist = {1:0,2:0,3:0,4:0,5:0};
    getActivePointFeatures().forEach(feat => {
        const town = feat.properties.town;
        const rv   = townRisks[town] || 1;
        dist[rv]++;
        if (rv >= 4) totalHighRisk++;
    });
    return { totalHighRisk, riskDistribution: dist };
}

function getWraDepthDistribution() {
    let totalFlooded = 0;
    const dist = {2:0,3:0,4:0,5:0,6:0};
    getActivePointFeatures().forEach(feat => {
        const depth = pointIntersectResults[feat.properties.name];
        if (depth) {
            totalFlooded++;
            let code = 2;
            if (depth === '0.3-0.5') code = 2;
            else if (depth === '0.5-1') code = 3;
            else if (depth === '1-2') code = 4;
            else if (depth === '2-3') code = 5;
            else if (depth === '>3') code = 6;
            dist[code]++;
        }
    });
    return { totalFlooded, depthDistribution: dist };
}

function updateStatsAndChart() {
    if (!townGeoJsonData) return;
    updateLegendUI();
    updateStatTotalCard();
    const reg = getRegistry();
    if (isNcdrLayerEnabled()) {
        const { totalHighRisk, riskDistribution } = getRiskDistribution();
        updateHighRiskCard(totalHighRisk, reg.highRiskLabel);
        renderChart(riskDistribution);
    } else if (isWraLayerEnabled()) {
        const { totalFlooded, depthDistribution } = getWraDepthDistribution();
        updateHighRiskCard(totalFlooded, `淹水警戒${reg.label}`);
        renderChartWRA(depthDistribution);
    }
}

function renderChart(dist) {
    const ctx = document.getElementById('riskChart').getContext('2d');
    const labels = ['第 1 級', '第 2 級', '第 3 級', '第 4 級', '第 5 級'];
    const data   = [dist[1], dist[2], dist[3], dist[4], dist[5]];
    const bgColors = [riskColors[1], riskColors[2], riskColors[3], riskColors[4], riskColors[5]];
    if (riskChart) {
        riskChart.data.labels = labels;
        riskChart.data.datasets[0].label = '設施數量';
        riskChart.data.datasets[0].data = data;
        riskChart.data.datasets[0].backgroundColor = bgColors;
        riskChart.update();
    } else {
        riskChart = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets: [{ label: '設施數量', data, backgroundColor: bgColors, borderRadius: 4, borderWidth: 0 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: getChartThemeColors().tick, font: { size: 9 } } },
                    y: { grid: { color: getChartThemeColors().grid }, ticks: { color: getChartThemeColors().tick, font: { size: 9 }, stepSize: 5 } }
                }
            }
        });
    }
}

function renderChartWRA(dist) {
    const labels = ['0.3-0.5m', '0.5-1m', '1-2m', '2-3m', '>3m'];
    const data   = [dist[2], dist[3], dist[4], dist[5], dist[6]];
    if (riskChart) {
        riskChart.data.labels = labels;
        riskChart.data.datasets[0].label = '警戒設施';
        riskChart.data.datasets[0].data  = data;
        riskChart.data.datasets[0].backgroundColor = [wraColors[2], wraColors[3], wraColors[4], wraColors[5], wraColors[6]];
        updateChartTheme();
    }
}

// ==========================================================================
// Info Widget (hover)
// ==========================================================================
function updateInfoWidget(props) {
    const infoDiv = document.getElementById('info-content');
    const reg = getRegistry();

    // Count points in this town
    const townPoints = getActivePointFeatures().filter(f => f.properties.town === props.town_name);
    const pointCount = townPoints.length;

    if (isWraLayerEnabled()) {
        const floodedCount = townPoints.filter(f => pointIntersectResults[f.properties.name]).length;
        infoDiv.innerHTML = `
            <div class="hover-town-title">${props.town_name}</div>
            <div class="hover-stat-row">
                <span class="hover-stat-label">轄區內${reg.label}數</span>
                <span class="hover-stat-val" style="color:var(--secondary);font-weight:700">${pointCount} 處</span>
            </div>
            <div class="hover-stat-row" style="margin-top:8px;border-top:1px dashed rgba(239,68,68,0.3);padding-top:8px">
                <span class="hover-stat-label" style="color:#ef4444;font-weight:bold">淹水警戒設施數</span>
                <span class="hover-stat-val risk-badge badge-5">${floodedCount} 處</span>
            </div>`;
    } else {
        const riskVal = props[getActiveRiskField()] || 1;
        const vulVal  = props[getActiveVulnerabilityField()] || 1;
        if (activeTheme === 'temp') {
            const hazTempVal = props[`temp_hazard_temp_${activeScenario}`] || 1;
            const hazDurVal  = props[`temp_hazard_dur_${activeScenario}`]  || 1;
            infoDiv.innerHTML = `
                <div class="hover-town-title">${props.town_name}</div>
                <div class="hover-stat-row"><span class="hover-stat-label">強度危害度</span><span class="hover-stat-val risk-badge badge-${hazTempVal}">第 ${hazTempVal} 級</span></div>
                <div class="hover-stat-row"><span class="hover-stat-label">持續危害度</span><span class="hover-stat-val risk-badge badge-${hazDurVal}">第 ${hazDurVal} 級</span></div>
                <div class="hover-stat-row"><span class="hover-stat-label">脆弱度等級</span><span class="hover-stat-val risk-badge badge-${vulVal}">第 ${vulVal} 級</span></div>
                <div class="hover-stat-row"><span class="hover-stat-label">綜合風險等級</span><span class="hover-stat-val risk-badge badge-${riskVal}">第 ${riskVal} 級</span></div>
                <div class="hover-stat-row" style="margin-top:8px;border-top:1px dashed rgba(255,255,255,0.1);padding-top:8px">
                    <span class="hover-stat-label">轄區${reg.label}數</span>
                    <span class="hover-stat-val" style="color:var(--secondary);font-weight:700">${pointCount} 處</span>
                </div>`;
        } else {
            const hazVal = props[getActiveHazardField()] || 1;
            infoDiv.innerHTML = `
                <div class="hover-town-title">${props.town_name}</div>
                <div class="hover-stat-row"><span class="hover-stat-label">危害度等級</span><span class="hover-stat-val risk-badge badge-${hazVal}">第 ${hazVal} 級</span></div>
                <div class="hover-stat-row"><span class="hover-stat-label">脆弱度等級</span><span class="hover-stat-val risk-badge badge-${vulVal}">第 ${vulVal} 級</span></div>
                <div class="hover-stat-row"><span class="hover-stat-label">綜合風險等級</span><span class="hover-stat-val risk-badge badge-${riskVal}">第 ${riskVal} 級</span></div>
                <div class="hover-stat-row" style="margin-top:8px;border-top:1px dashed rgba(255,255,255,0.1);padding-top:8px">
                    <span class="hover-stat-label">轄區${reg.label}數</span>
                    <span class="hover-stat-val" style="color:var(--secondary);font-weight:700">${pointCount} 處</span>
                </div>`;
        }
    }
}

function clearInfoWidget() {
    document.getElementById('info-content').innerHTML = `<p class="placeholder">懸停於行政區上以載入氣候風險指標...</p>`;
}

// ==========================================================================
// Point List (sidebar)
// ==========================================================================
function populatePointList() {
    const container = document.getElementById('daycare-list-container');
    container.innerHTML = '';
    const reg      = getRegistry();
    let features   = getActivePointFeatures();
    if (selectedTown) {
        features = features.filter(f => f.properties.town === selectedTown);
    }
    if (features.length === 0) {
        container.innerHTML = `<p class="list-placeholder">本區尚無設置${reg.label}</p>`;
        return;
    }
    features.forEach(feat => {
        const card = document.createElement('div');
        card.className = 'daycare-item-card';
        card.innerHTML = reg.listFn(feat);
        card.addEventListener('click', () => {
            const [lng, lat] = feat.geometry.coordinates;
            map.setView([lat, lng], 14);
            if (pointLayer) {
                pointLayer.eachLayer(layer => {
                    if (layer.feature && layer.feature.properties.id === feat.properties.id) {
                        layer.openPopup();
                    }
                });
            }
        });
        container.appendChild(card);
    });
}

// ==========================================================================
// Town Feature Handlers
// ==========================================================================
function onEachTownFeature(feature, layer) {
    layer.on({ mouseover: highlightFeature, mouseout: resetHighlight, click: selectTownFeature });
}
function highlightFeature(e) {
    const layer = e.target;
    layer.setStyle({ weight: 3, color: '#ffffff', fillOpacity: isNcdrLayerEnabled() ? getTownRiskHighlightOpacity() : 0.05 });
    updateInfoWidget(layer.feature.properties);
}
function resetHighlight(e) { townLayer.resetStyle(e.target); clearInfoWidget(); }
function selectTownFeature(e) {
    const townName = e.target.feature.properties.town_name;
    selectedTown = (selectedTown === townName) ? null : townName;
    document.getElementById('town-selected-name').innerText = selectedTown ? `(${selectedTown})` : '(全縣)';
    map.panTo(e.latlng);
    populatePointList();
    const container = document.querySelector('.app-container');
    const toggleIcon = document.getElementById('mobile-toggle-icon');
    if (window.innerWidth <= 768 && container && container.classList.contains('sidebar-collapsed')) {
        container.classList.remove('sidebar-collapsed');
        if (toggleIcon) toggleIcon.className = 'fa-solid fa-chevron-down';
    }
}

// ==========================================================================
// WRA Lazy Loader
// ==========================================================================
function loadWraData(scenarioId, callback) {
    const file = scenarioId === 'gwl20' ? 'wra_flood_650mm_24h.json' : 'wra_flood_350mm_24h.json';
    if (scenarioId === 'gwl20' && wraGeoJson650) { callback(wraGeoJson650); return; }
    if (scenarioId !== 'gwl20' && wraGeoJson350) { callback(wraGeoJson350); return; }
    const indicator = document.getElementById('active-scenario-indicator');
    const orig = indicator.innerText;
    indicator.innerText = '載入水利署精細潛勢圖中...請稍候...';
    fetch(`${file}?t=${Date.now()}`).then(r => r.json()).then(geojson => {
        if (scenarioId === 'gwl20') wraGeoJson650 = geojson; else wraGeoJson350 = geojson;
        indicator.innerText = orig;
        callback(geojson);
    }).catch(err => { console.error(err); indicator.innerText = '載入圖資失敗'; });
}

// ==========================================================================
// Timeline UI
// ==========================================================================
function renderTimelineUI() {
    const sel = document.getElementById('scenario-selector');
    if (!sel) return;
    let html = '<div class="timeline-track"></div>';
    if (activeTheme === 'flood') {
        if (activeFloodLayers.wra && !activeFloodLayers.ncdr) {
            [{ id: 'gwl15', label: '350mm / 24HR 暴雨', left: '0%' }, { id: 'gwl20', label: '650mm / 24HR 極端降雨', left: '100%' }].forEach(s => {
                html += `<div class="timeline-step ${getActiveWraScenario() === s.id ? 'active' : ''}" data-scenario="${s.id}" style="left:${s.left}"><span class="step-dot"></span><span class="step-label">${s.label}</span></div>`;
            });
        } else {
            [{ id: 'current', label: '現況基準', left: '0%' }, { id: 'gwl15', label: '升溫 1.5°C', left: '100%' }].forEach(s => {
                html += `<div class="timeline-step ${activeScenario === s.id ? 'active' : ''}" data-scenario="${s.id}" style="left:${s.left}"><span class="step-dot"></span><span class="step-label">${s.label}</span></div>`;
            });
        }
    } else {
        [{ id: 'current', label: '現況基準', left: '0%' }, { id: 'gwl15', label: '升溫 1.5°C', left: '33.33%' }, { id: 'gwl20', label: '升溫 2.0°C', left: '66.67%' }, { id: 'gwl40', label: '升溫 4.0°C', left: '100%' }].forEach(s => {
            html += `<div class="timeline-step ${activeScenario === s.id ? 'active' : ''}" data-scenario="${s.id}" style="left:${s.left}"><span class="step-dot"></span><span class="step-label">${s.label}</span></div>`;
        });
    }
    sel.innerHTML = html;
}

function updateRiskOpacityControl() {
    const grp = document.getElementById('risk-opacity-group');
    const lbl = document.getElementById('risk-opacity-label');
    const val = document.getElementById('val-risk-opacity');
    if (grp) grp.style.display = isNcdrLayerEnabled() ? 'flex' : 'none';
    if (lbl) lbl.innerText = activeTheme === 'temp' ? '高溫風險圖透明度' : 'NCDR 風險圖透明度';
    if (val) val.innerText = `${Math.round(riskMapOpacity * 100)}%`;
}

// ==========================================================================
// Header Indicator
// ==========================================================================
function updateHeaderIndicator() {
    const reg = getRegistry();
    const indicator = document.getElementById('active-scenario-indicator');
    const themeName = activeTheme === 'flood' ? getActiveFloodLayerNames().join(' + ') : '高溫風險等級';
    let scenarioName = '現況基準';
    if (isWraLayerEnabled() && !activeFloodLayers.ncdr) {
        scenarioName = getWraScenarioName();
    } else {
        const names = { gwl15: '升溫 1.5°C', gwl20: '升溫 2.0°C', gwl40: '升溫 4.0°C', future: '升溫 1.5°C' };
        scenarioName = names[activeScenario] || '現況基準';
        if (isWraLayerEnabled()) scenarioName += `；水利署 ${getWraScenarioName()}`;
    }
    indicator.innerText = `${reg.label} × ${themeName}套疊 — ${scenarioName}`;
}

// ==========================================================================
// Legend
// ==========================================================================
function updateLegendUI() {
    const div = document.getElementById('map-legend-widget');
    if (!div) return;
    const reg = getRegistry();

    const riskLegend = isNcdrLayerEnabled() ? `
        <div class="legend-title">綜合風險指標等級</div>
        <div class="legend-scale">
            ${[1,2,3,4,5].map(v => `<div class="legend-item"><span class="legend-color-box" style="background:${riskColors[v]}"></span> <span>第 ${v} 級 (Level ${v})</span></div>`).join('')}
        </div>` : '';

    const wraLegend = isWraLayerEnabled() ? `
        <div class="legend-title" style="margin-top:${isNcdrLayerEnabled()?'10px':'0'};${isNcdrLayerEnabled()?'border-top:1px dashed rgba(255,255,255,0.1);padding-top:8px':''}">水利署預估淹水深度</div>
        <div class="legend-scale">
            <div class="legend-item"><span class="legend-color-box" style="background:${wraColors[2]}"></span> <span>0.3 - 0.5 公尺</span></div>
            <div class="legend-item"><span class="legend-color-box" style="background:${wraColors[3]}"></span> <span>0.5 - 1.0 公尺</span></div>
            <div class="legend-item"><span class="legend-color-box" style="background:${wraColors[4]}"></span> <span>1.0 - 2.0 公尺</span></div>
            <div class="legend-item"><span class="legend-color-box" style="background:${wraColors[5]}"></span> <span>2.0 - 3.0 公尺</span></div>
            <div class="legend-item"><span class="legend-color-box" style="background:${wraColors[6]}"></span> <span>大於 3.0 公尺</span></div>
        </div>` : '';

    div.innerHTML = riskLegend + wraLegend + reg.legendFn();
}

function addLegend() {
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'map-legend');
        div.id = 'map-legend-widget';
        return div;
    };
    legend.addTo(map);
}

// ==========================================================================
// UI Event Setup
// ==========================================================================
function setupColorThemeControl() {
    const select = document.getElementById('color-theme-select');
    applyColorTheme(getSavedColorTheme());
    if (select) select.addEventListener('change', e => applyColorTheme(e.target.value));
}

function setupUIControls() {
    setupColorThemeControl();
    renderTimelineUI();

    // ── Point Theme Switcher ──────────────────────────────────────────────
    const ptButtons = document.querySelectorAll('#point-theme-selector .toggle-btn');
    ptButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            ptButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activePointTheme = btn.dataset.pointTheme;
            selectedTown = null;
            document.getElementById('town-selected-name').innerText = '(全縣)';
            updateStatTotalCard();
            updateLayers();
            updateStatsAndChart();
            populatePointList();
            updateHeaderIndicator();
        });
    });
    // Set initial active button
    ptButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.pointTheme === activePointTheme);
    });

    // ── Climate Theme Switcher ────────────────────────────────────────────
    const themeButtons = document.querySelectorAll('#theme-selector .toggle-btn');
    themeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            themeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeTheme = btn.dataset.theme;
            document.getElementById('flood-mode-group').style.display = activeTheme === 'flood' ? 'block' : 'none';
            document.getElementById('temp-mode-group').style.display  = activeTheme === 'temp'  ? 'block' : 'none';
            updateRiskOpacityControl();
            if (activeTheme === 'flood') {
                if (activeFloodLayers.wra && !activeFloodLayers.ncdr) {
                    if (activeScenario !== 'gwl15' && activeScenario !== 'gwl20') activeScenario = 'gwl15';
                } else if (activeScenario !== 'current' && activeScenario !== 'gwl15') activeScenario = 'current';
            }
            if (isWraLayerEnabled()) {
                loadWraData(getActiveWraScenario(), () => { renderTimelineUI(); updateHeaderIndicator(); applyCalibration(); });
            } else { renderTimelineUI(); updateHeaderIndicator(); applyCalibration(); }
        });
    });

    // ── Flood Layer Multi-select ─────────────────────────────────────────
    const modeButtons = document.querySelectorAll('#flood-mode-selector .toggle-btn');
    const syncFloodBtns = () => modeButtons.forEach(b => {
        b.classList.toggle('active', Boolean(activeFloodLayers[b.dataset.mode]));
        b.setAttribute('aria-pressed', String(Boolean(activeFloodLayers[b.dataset.mode])));
    });
    syncFloodBtns(); updateRiskOpacityControl();
    modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            const enabledCount = Object.values(activeFloodLayers).filter(Boolean).length;
            if (activeFloodLayers[mode] && enabledCount === 1) return;
            activeFloodLayers[mode] = !activeFloodLayers[mode];
            syncFloodBtns(); updateRiskOpacityControl();
            if (activeFloodLayers.wra && !activeFloodLayers.ncdr) {
                if (activeScenario !== 'gwl15' && activeScenario !== 'gwl20') activeScenario = 'gwl15';
            } else if (activeScenario !== 'current' && activeScenario !== 'gwl15') activeScenario = 'current';
            if (isWraLayerEnabled()) {
                loadWraData(getActiveWraScenario(), () => { renderTimelineUI(); updateHeaderIndicator(); applyCalibration(); });
            } else { renderTimelineUI(); updateHeaderIndicator(); applyCalibration(); }
        });
    });

    // ── Temp Risk Mode ───────────────────────────────────────────────────
    const tempModeButtons = document.querySelectorAll('#temp-mode-selector .toggle-btn');
    tempModeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tempModeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeTempRiskMode = btn.dataset.mode;
            applyCalibration();
        });
    });

    // ── Timeline Step ────────────────────────────────────────────────────
    document.getElementById('scenario-selector').addEventListener('click', e => {
        const step = e.target.closest('.timeline-step');
        if (step) {
            activeScenario = step.dataset.scenario;
            if (activeTheme === 'flood' && activeFloodLayers.wra && !activeFloodLayers.ncdr) activeWraScenario = activeScenario;
            if (isWraLayerEnabled()) {
                loadWraData(getActiveWraScenario(), () => { renderTimelineUI(); updateHeaderIndicator(); applyCalibration(); });
            } else { renderTimelineUI(); updateHeaderIndicator(); applyCalibration(); }
        }
    });

    // ── Opacity Slider ───────────────────────────────────────────────────
    document.getElementById('slider-risk-opacity').addEventListener('input', e => {
        riskMapOpacity = parseFloat(e.target.value);
        updateRiskOpacityControl();
        updateLayers();
    });

    // ── Calibration Sliders ──────────────────────────────────────────────
    ['slider-lon-shift', 'slider-lat-shift', 'slider-scale'].forEach(id => {
        document.getElementById(id).addEventListener('input', applyCalibration);
    });

    // ── Mobile Drawer ────────────────────────────────────────────────────
    const brand = document.querySelector('.brand');
    const container = document.querySelector('.app-container');
    if (brand && container) {
        brand.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                container.classList.toggle('sidebar-collapsed');
                const icon = document.getElementById('mobile-toggle-icon');
                if (icon) icon.className = container.classList.contains('sidebar-collapsed') ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down';
            }
        });
    }
}
