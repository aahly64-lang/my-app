import { LEAFLET_CSS, LEAFLET_JS } from './leafletAssets';

export interface MapInit {
  lat: number;
  lon: number;
  radius: number;
  hasPoint: boolean;
  minRadius: number;
  maxRadius: number;
}

/**
 * Full-screen OpenStreetMap picker (Leaflet). Messages to React Native:
 *  { type: 'save', lat, lon, radius } | { type: 'close' } | { type: 'myLocation' }
 * Messages from React Native: window.setMyLocation(lat, lon)
 */
export function buildMapHtml(init: MapInit): string {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>${LEAFLET_CSS}</style>
<style>
  html, body { margin: 0; padding: 0; height: 100%; font-family: sans-serif; }
  #map { position: absolute; inset: 0; }
  .bar { position: absolute; left: 10px; right: 10px; z-index: 1000; }
  #top { top: 10px; display: flex; gap: 8px; }
  #search { flex: 1; font-size: 16px; padding: 12px; border-radius: 10px; border: 1px solid #94a3b8; box-shadow: 0 2px 6px rgba(0,0,0,.2); }
  .btn { border: 0; border-radius: 10px; font-size: 16px; font-weight: 700; padding: 12px 14px; box-shadow: 0 2px 6px rgba(0,0,0,.25); }
  #close { background: #fff; color: #0f172a; }
  #results { top: 62px; background: #fff; border-radius: 10px; max-height: 45%; overflow-y: auto; display: none; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
  .res { padding: 12px; border-bottom: 1px solid #e2e8f0; font-size: 15px; }
  #hint { top: 62px; background: rgba(15,23,42,.85); color: #fff; text-align: center; padding: 10px; border-radius: 10px; font-size: 15px; }
  #bottom { bottom: 14px; background: #fff; border-radius: 14px; padding: 12px; box-shadow: 0 2px 10px rgba(0,0,0,.3); }
  #radiusRow { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .round { width: 58px; height: 58px; border-radius: 29px; border: 0; font-size: 30px; font-weight: 800; background: #0f172a; color: #fff; }
  #radiusLabel { flex: 1; text-align: center; font-size: 22px; font-weight: 800; color: #0f172a; }
  #actions { display: flex; gap: 8px; margin-top: 10px; }
  #myloc { background: #e2e8f0; color: #0f172a; flex: 1; }
  #save { background: #15803d; color: #fff; flex: 2; }
  #save:disabled { background: #94a3b8; }
</style>
</head>
<body>
<div id="map"></div>
<div id="top" class="bar">
  <input id="search" type="search" placeholder="חיפוש כתובת או מקום..." enterkeyhint="search" />
  <button id="close" class="btn">✕</button>
</div>
<div id="results" class="bar"></div>
<div id="hint" class="bar">לחץ על המפה כדי לבחור את מרכז האזור</div>
<div id="bottom" class="bar">
  <div id="radiusRow">
    <button id="plus" class="round">+</button>
    <div id="radiusLabel"></div>
    <button id="minus" class="round">−</button>
  </div>
  <div id="actions">
    <button id="myloc" class="btn">📍 המיקום שלי</button>
    <button id="save" class="btn">שמור אזור</button>
  </div>
</div>
<script>${LEAFLET_JS}</script>
<script>
(function () {
  var INIT = ${JSON.stringify(init)};
  function post(msg) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }

  var map = L.map('map', { zoomControl: false, attributionControl: true }).setView([INIT.lat, INIT.lon], INIT.hasPoint ? 15 : 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  var radius = INIT.radius;
  var center = INIT.hasPoint ? L.latLng(INIT.lat, INIT.lon) : null;
  var circle = null, dot = null, meMarker = null;

  function step(r) { return r < 500 ? 50 : (r < 1000 ? 100 : 250); }
  function fmt(r) { return r >= 1000 ? (Math.round(r / 10) / 100) + ' ק"מ' : r + ' מטר'; }

  function draw() {
    document.getElementById('radiusLabel').textContent = 'רדיוס: ' + fmt(radius);
    document.getElementById('save').disabled = !center;
    document.getElementById('hint').style.display = center ? 'none' : 'block';
    if (!center) return;
    if (!circle) {
      circle = L.circle(center, { radius: radius, color: '#ca8a04', weight: 3, fillColor: '#facc15', fillOpacity: 0.3 }).addTo(map);
      dot = L.circleMarker(center, { radius: 7, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 }).addTo(map);
    } else {
      circle.setLatLng(center); circle.setRadius(radius); dot.setLatLng(center);
    }
  }

  function setCenter(latlng, fit) {
    center = latlng;
    draw();
    if (fit) map.fitBounds(circle.getBounds(), { padding: [40, 40] });
  }

  map.on('click', function (e) { hideResults(); setCenter(e.latlng, false); });

  document.getElementById('plus').onclick = function () {
    radius = Math.min(INIT.maxRadius, radius + step(radius)); draw();
    if (circle) map.fitBounds(circle.getBounds(), { padding: [40, 40] });
  };
  document.getElementById('minus').onclick = function () {
    var s = step(radius - 1);
    radius = Math.max(INIT.minRadius, radius - s); draw();
  };
  document.getElementById('save').onclick = function () {
    if (!center) return;
    post({ type: 'save', lat: center.lat, lon: center.lng, radius: radius });
  };
  document.getElementById('close').onclick = function () { post({ type: 'close' }); };
  document.getElementById('myloc').onclick = function () { post({ type: 'myLocation' }); };

  window.setMyLocation = function (lat, lon) {
    var ll = L.latLng(lat, lon);
    if (!meMarker) {
      meMarker = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(map);
    } else { meMarker.setLatLng(ll); }
    map.setView(ll, 16);
  };

  var resultsEl = document.getElementById('results');
  function hideResults() { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; }

  var searchEl = document.getElementById('search');
  function doSearch() {
    var q = searchEl.value.trim();
    if (!q) return;
    searchEl.blur();
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = '<div class="res">מחפש...</div>';
    var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=he&countrycodes=il&q=' + encodeURIComponent(q);
    fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (list) {
        resultsEl.innerHTML = '';
        if (!list || !list.length) { resultsEl.innerHTML = '<div class="res">לא נמצאו תוצאות</div>'; return; }
        list.forEach(function (item) {
          var div = document.createElement('div');
          div.className = 'res';
          div.textContent = item.display_name;
          div.onclick = function () {
            hideResults();
            setCenter(L.latLng(parseFloat(item.lat), parseFloat(item.lon)), true);
          };
          resultsEl.appendChild(div);
        });
      })
      .catch(function () { resultsEl.innerHTML = '<div class="res">אין חיבור לאינטרנט או שהחיפוש נכשל</div>'; });
  }
  searchEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
  searchEl.addEventListener('search', doSearch);

  draw();
  if (center) map.fitBounds(circle.getBounds(), { padding: [40, 40] });
})();
</script>
</body>
</html>`;
}
