/* Google Maps view — dark styled base map, one coloured pin per programme,
   info windows with a one-line funding summary and a link to the page,
   plus a filterable side list. Reads window.MARKERS and window.GMAPS_KEY. */
(function () {
  var KEY = window.GMAPS_KEY || "";
  var M = window.MARKERS || [];
  var COLOR = {
    ok: { fill: "#34d399", label: "Funded" },
    warn: { fill: "#fbbf24", label: "Partial / conditional" },
    bad: { fill: "#f87171", label: "Blocked" }
  };

  function pin(colour) {
    return {
      path: "M12 0C5.4 0 0 5.4 0 12c0 8.5 12 22 12 22s12-13.5 12-22C24 5.4 18.6 0 12 0z",
      fillColor: colour,
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 1.5,
      scale: 1.15,
      anchor: new google.maps.Point(12, 32)
    };
  }

  function boot() {
    var el = document.getElementById("map");
    var missing = !KEY || KEY.indexOf("REPLACE") === 0;
    if (missing) {
      el.innerHTML =
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'background:#0b1220;color:#e8f4ff;font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;padding:30px;text-align:center">' +
        '<div><strong style="font-size:17px">Google Maps needs an API key.</strong><br><br>' +
        'Paste it into <code style="background:#16233a;padding:2px 6px;border-radius:4px">web/funding/assets/config.js</code>' +
        ' and redeploy — or send it to me and I\'ll wire it in.<br><br>' +
        '<span style="color:#7c93ad;font-size:13px">console.cloud.google.com → enable "Maps JavaScript API" → create a key → ' +
        'restrict it to https://pranavhere01.github.io/*</span></div></div>';
      return;
    }

    var center = { lat: 20, lng: 10 };
    var map = new google.maps.Map(el, {
      center: center,
      zoom: 2,
      mapId: undefined,
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      styles: DARK_STYLE
    });

    var markers = [];
    var bySlug = {};
    M.forEach(function (m) {
      var col = COLOR[m.verdict] || COLOR.warn;
      var mk = new google.maps.Marker({
        position: { lat: m.lat, lng: m.lon },
        map: map,
        icon: pin(col.fill),
        title: m.uni
      });
      var iw = new google.maps.InfoWindow({
        content:
          '<div style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111">' +
          '<strong style="font-size:14px">' + esc(m.uni) + '</strong><br>' +
          '<span style="color:#555">' + esc(m.country) + ' · ' + esc(m.level) + '</span><br>' +
          '<span style="color:#065f46">' + esc(m.amount) + '</span><br>' +
          '<a href="programs/' + m.slug + '.html" style="color:#1d4ed8;font-weight:600">Open programme page →</a>' +
          '</div>'
      });
      mk.addListener("click", function () {
        iw.open(map, mk);
        map.panTo(mk.getPosition());
      });
      markers.push(mk);
      bySlug[m.slug] = { mk: mk, iw: iw, m: m };
    });

    buildList(bySlug, map);
  }

  function buildList(bySlug, map) {
    var list = document.getElementById("list");
    var enabled = { ok: true, warn: true, bad: true };
    var items = [];
    var rows = M.slice().sort(function (a, b) {
      return a.verdict === b.verdict ? a.country.localeCompare(b.country)
        : ["ok", "warn", "bad"].indexOf(a.verdict) - ["ok", "warn", "bad"].indexOf(b.verdict);
    }).map(function (m) {
      var li = document.createElement("li");
      li.dataset.verdict = m.verdict;
      li.innerHTML =
        '<a href="#">' + esc(m.uni) + '</a>' +
        '<small>' + esc(m.country) + ' · ' + esc(m.level) + ' · ' + esc(COLOR[m.verdict].label) + '</small>';
      li.querySelector("a").addEventListener("click", function (e) {
        e.preventDefault();
        var t = bySlug[m.slug];
        t.iw.open(map, t.mk);
        map.panTo(t.mk.getPosition());
        map.setZoom(Math.max(map.getZoom(), 5));
      });
      list.appendChild(li);
      items.push(li);
      return li;
    });

    function apply() {
      M.forEach(function (m) {
        bySlug[m.slug].mk.setVisible(enabled[m.verdict]);
      });
      items.forEach(function (li) {
        li.style.display = enabled[li.dataset.verdict] ? "" : "none";
      });
      var n = document.getElementById("shown");
      if (n) n.textContent = M.filter(function (m) { return enabled[m.verdict]; }).length;
    }
    var legend = document.getElementById("legend");
    if (legend) {
      legend.addEventListener("click", function (e) {
        var b = e.target.closest("[data-v]");
        if (!b) return;
        enabled[b.dataset.v] = !enabled[b.dataset.v];
        b.classList.toggle("off", !enabled[b.dataset.v]);
        apply();
      });
    }
    apply();
  }

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var DARK_STYLE = [
    { elementType: "geometry", stylers: [{ color: "#0e1626" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#6f8099" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#0e1626" }] },
    { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#2b3b52" }] },
    { featureType: "administrative.province", elementType: "geometry.stroke", stylers: [{ color: "#1c2a3f" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#081019" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3f5570" }] },
    { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#16233a" }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#5a6b82" }] },
    { featureType: "poi", elementType: "geometry", stylers: [{ color: "#122036" }] },
    { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] }
  ];

  if (typeof google !== "undefined") {
    boot();
  } else {
    window.initMap = boot;
  }
})();
