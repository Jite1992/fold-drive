/* Fold Drive: Google Maps loading, place search, routes, GPS trip tracking and voice guidance. */
(function () {
  'use strict';
  var FD = window.FD;
  var N = FD.nav = { trip: null, muted: false, follow: true };
  var loading = null, map = null, mapEl = null, routeLine = null, car = null, destMarker = null;
  var watchId = null, tickTimer = null, wakeLock = null, sessionToken = null, authFailed = false, lastErr = '';

  var DUBAI = { lat: 25.2048, lng: 55.2708 };
  var DARK = [
    { elementType: 'geometry', stylers: [{ color: '#111821' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8A96A6' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0D1117' }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2A3441' }] },
    { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#151E29' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#26303C' }] },
    { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#36445A' }] },
    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#B7C2D0' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0A2230' }] }
  ];

  /* ---------- helpers ---------- */
  function ll(p) {
    return { lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng };
  }
  function hav(a, b) {
    var R = 6371000, t = Math.PI / 180;
    var dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  function decode(str) {
    var i = 0, lat = 0, lng = 0, out = [];
    while (i < str.length) {
      var b, s = 0, r = 0;
      do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32);
      lat += (r & 1) ? ~(r >> 1) : (r >> 1);
      s = 0; r = 0;
      do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32);
      lng += (r & 1) ? ~(r >> 1) : (r >> 1);
      out.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return out;
  }
  N.hav = hav;
  N.mapsLoaded = function () { return !!(window.google && google.maps && google.maps.Map); };
  N.errorText = function (e) {
    var m = (e && (e.message || e.code || e)) + '';
    if (m === 'NO_KEY') return 'Add your Google Maps key in Settings first.';
    if (authFailed || /API key|REQUEST_DENIED|PERMISSION_DENIED|not authorized|ApiNotActivated|403/i.test(m)) return 'Google rejected the request. Check the key and that Maps JavaScript, Places (New) and Routes APIs are enabled.';
    if (/network|Failed to fetch|load/i.test(m)) return 'No internet connection. Try again in a moment.';
    if (/denied|permission/i.test(m)) return 'Location is blocked. Allow location for this app in Chrome site settings.';
    return m.length > 140 ? m.slice(0, 140) + '…' : m;
  };

  /* ---------- Google Maps loading ---------- */
  N.load = function () {
    if (N.mapsLoaded() && google.maps.importLibrary) return Promise.resolve();
    if (loading) return loading;
    var key = FD.settings.apiKey;
    if (!key) return Promise.reject(new Error('NO_KEY'));
    window.gm_authFailure = function () {
      authFailed = true; lastErr = 'Google rejected the API key.';
      FD.toast('Google rejected the Maps key. Check it in Settings.');
      FD.onTrip('update');
    };
    loading = new Promise(function (res, rej) {
      window.__fdMapsReady = function () { res(); };
      var s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&v=weekly&loading=async&libraries=places,routes&language=en&region=AE&callback=__fdMapsReady';
      s.async = true;
      s.onerror = function () { loading = null; rej(new Error('Could not load Google Maps (network).')); };
      document.head.appendChild(s);
    });
    return loading;
  };

  /* ---------- place search (Places API New) ---------- */
  N.suggest = function (text) {
    return N.load().then(function () { return google.maps.importLibrary('places'); }).then(function (lib) {
      if (!sessionToken) sessionToken = new lib.AutocompleteSessionToken();
      var req = { input: text, sessionToken: sessionToken, language: 'en', region: 'ae' };
      var near = (N.trip && N.trip.pos) || N.lastPos;
      if (near) req.locationBias = { center: near, radius: 50000 };
      else req.locationBias = { center: DUBAI, radius: 50000 };
      return lib.AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
    }).then(function (res) {
      return (res.suggestions || []).filter(function (s) { return s.placePrediction; }).slice(0, 6).map(function (s) {
        var p = s.placePrediction;
        var main = p.mainText ? p.mainText.text : (p.text ? p.text.text : '');
        var sec = p.secondaryText ? p.secondaryText.text : '';
        return { main: main, secondary: sec, prediction: p };
      });
    });
  };
  N.resolve = function (r) {
    var place = r.prediction.toPlace();
    return place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] }).then(function () {
      sessionToken = null;
      var loc = ll(place.location);
      return { name: place.displayName || r.main, address: place.formattedAddress || r.secondary, lat: loc.lat, lng: loc.lng };
    });
  };
  N.here = function () {
    return new Promise(function (res, rej) {
      if (!navigator.geolocation) { rej(new Error('Location is not available on this browser.')); return; }
      navigator.geolocation.getCurrentPosition(function (p) {
        var c = { lat: p.coords.latitude, lng: p.coords.longitude }; N.lastPos = c; res(c);
      }, function (e) { rej(new Error(e.code === 1 ? 'Location permission denied' : 'Could not get your location')); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 });
    });
  };

  /* ---------- routes ---------- */
  function build(steps, fallbackPath, dist, dur) {
    var path = [], meta = [];
    steps.forEach(function (s) {
      if (!s.path || !s.path.length) return;
      var start = path.length ? path.length - 1 : 0;
      s.path.forEach(function (p, k) {
        if (k === 0 && path.length && hav(path[path.length - 1], p) < 1) return;
        path.push(p);
      });
      meta.push({ instr: s.instr || '', man: s.man || '', start: start, end: path.length - 1 });
    });
    if (path.length < 2) {
      path = fallbackPath || [];
      meta = [{ instr: 'Head to your destination', man: 'STRAIGHT', start: 0, end: Math.max(0, path.length - 1) }];
    }
    if (path.length < 2) throw new Error('No driving route found to this place.');
    var cum = [0];
    for (var i = 1; i < path.length; i++) cum[i] = cum[i - 1] + hav(path[i - 1], path[i]);
    var total = cum[cum.length - 1];
    return { path: path, cum: cum, steps: meta, distance: total || dist, duration: dur > 0 ? dur : (total / 1000) / 70 * 3600 };
  }
  function viaJs(origin, dest) {
    return google.maps.importLibrary('routes').then(function (lib) {
      if (!lib.Route || !lib.Route.computeRoutes) throw new Error('Route class unavailable');
      return lib.Route.computeRoutes({
        origin: origin, destination: { lat: dest.lat, lng: dest.lng },
        travelMode: 'DRIVING', routingPreference: 'TRAFFIC_AWARE',
        fields: ['distanceMeters', 'durationMillis', 'path', 'legs']
      });
    }).then(function (res) {
      var r = res && res.routes && res.routes[0];
      if (!r) throw new Error('No driving route found to this place.');
      var steps = [];
      (r.legs || []).forEach(function (l) {
        (l.steps || []).forEach(function (s) {
          steps.push({ instr: s.instructions || '', man: s.maneuver || '', path: (s.path || []).map(ll) });
        });
      });
      return build(steps, (r.path || []).map(ll), r.distanceMeters, (r.durationMillis || 0) / 1000);
    });
  }
  function viaRest(origin, dest) {
    var body = {
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
      travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', languageCode: 'en-GB', units: 'METRIC'
    };
    return fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': FD.settings.apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.navigationInstruction,routes.legs.steps.polyline.encodedPolyline'
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok) throw new Error((j.error && j.error.message) || ('Routes API error ' + res.status));
        return j;
      });
    }).then(function (j) {
      var r = j.routes && j.routes[0];
      if (!r) throw new Error('No driving route found to this place.');
      var steps = [];
      (r.legs || []).forEach(function (l) {
        (l.steps || []).forEach(function (s) {
          var ni = s.navigationInstruction || {};
          steps.push({ instr: ni.instructions || '', man: ni.maneuver || '', path: s.polyline ? decode(s.polyline.encodedPolyline) : [] });
        });
      });
      return build(steps, r.polyline ? decode(r.polyline.encodedPolyline) : [], r.distanceMeters, parseFloat(r.duration) || 0);
    });
  }
  function computeRoute(origin, dest) {
    return N.load().then(function () {
      return viaJs(origin, dest).catch(function (e1) {
        if (/No driving route/.test(e1.message)) throw e1;
        return viaRest(origin, dest);
      });
    });
  }

  /* ---------- trip tracking ---------- */
  N.start = function (dest) {
    stopWatch();
    N.trip = {
      dest: dest, startedAt: Date.now(), distance: 0, speed: 0, top: 0, status: 'locating',
      route: null, idx: 0, along: 0, remaining: null, stepIdx: 0, arrived: false,
      off: 0, lastReroute: 0, said: {}, last: null, pos: null, heading: 0, prev: null
    };
    N.follow = true;
    keepAwake();
    if (dest) N.load().catch(function () { });
    if (!navigator.geolocation) { fail('This browser cannot read your location.'); return; }
    watchId = navigator.geolocation.watchPosition(onFix, onGeoErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
    tickTimer = setInterval(function () { FD.onTrip('tick'); }, 1000);
    if (destMarker) destMarker.setMap(null);
    if (routeLine) routeLine.setPath([]);
  };
  N.end = function () {
    var t = N.trip; if (!t) return null;
    stopWatch();
    t.endedAt = Date.now();
    N.trip = null;
    if (routeLine) routeLine.setPath([]);
    if (destMarker) destMarker.setMap(null);
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (wakeLock) { try { wakeLock.release(); } catch (e) { } wakeLock = null; }
    return t;
  };
  function stopWatch() {
    if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null; clearInterval(tickTimer); tickTimer = null;
  }
  function fail(msg) { if (N.trip) { N.trip.status = 'error'; N.trip.error = msg; } FD.onTrip('update'); }
  function onGeoErr(e) {
    if (e.code === 1) fail('Location is blocked. Allow location for Fold Drive in Chrome, then start again.');
    else FD.onTrip('update');
  }
  function onFix(p) {
    var t = N.trip; if (!t) return;
    var c = { lat: p.coords.latitude, lng: p.coords.longitude };
    var acc = p.coords.accuracy || 999, ts = p.timestamp || Date.now();
    N.lastPos = c;
    // distance: only from reasonably accurate fixes, ignoring GPS jumps
    if (acc <= 50) {
      if (t.last) {
        var d = hav(t.last.c, c), dt = (ts - t.last.ts) / 1000;
        if (dt > 0 && d / dt < 75) { if (d >= 3) { t.distance += d; t.last = { c: c, ts: ts }; } }
        else t.last = { c: c, ts: ts };
      } else t.last = { c: c, ts: ts };
    }
    var sp = p.coords.speed;
    if (sp == null || isNaN(sp)) sp = t.prev ? hav(t.prev.c, c) / Math.max(1, (ts - t.prev.ts) / 1000) : 0;
    t.prev = { c: c, ts: ts };
    t.speed = sp * 3.6 < 2 ? 0 : sp * 3.6;
    if (acc <= 30 && t.speed > t.top) t.top = t.speed;
    if (p.coords.heading != null && !isNaN(p.coords.heading) && t.speed > 5) t.heading = p.coords.heading;
    t.pos = c; t.acc = acc;
    if (!t.startPos && acc <= 80) t.startPos = c;
    if (t.status === 'locating') {
      if (t.dest) { t.status = 'routing'; plan(c); }
      else t.status = 'free';
    }
    if (t.route && !t.arrived) progress(c, acc);
    drawCar();
    FD.onTrip('update');
  }
  function plan(origin) {
    var t = N.trip;
    computeRoute(origin, t.dest).then(function (r) {
      if (N.trip !== t) return;
      t.route = r; t.idx = 0; t.stepIdx = 0; t.said = {}; t.status = 'navigating'; t.lastReroute = Date.now(); t.off = 0;
      t.remaining = r.distance;
      if (t.pos) progress(t.pos, 10);
      drawRoute();
      if (!t.greeted) { t.greeted = true; say('Starting route to ' + t.dest.name + '. ' + Math.round(r.duration / 60) + ' minutes.'); }
      FD.onTrip('update');
    }).catch(function (e) {
      if (N.trip !== t) return;
      if (t.route) { t.status = 'navigating'; FD.toast('Could not update the route. Keeping the current one.'); }
      else { t.status = 'error'; t.error = N.errorText(e); }
      FD.onTrip('update');
    });
  }
  function progress(c, acc) {
    var t = N.trip, r = t.route, P = r.path, n = P.length;
    var first = !t.projected;
    var lo = first ? 0 : Math.max(0, t.idx - 20), hi = first ? n - 2 : Math.min(n - 2, t.idx + 400);
    var kx = 111320 * Math.cos(c.lat * Math.PI / 180), ky = 110540;
    var best = { d: Infinity, i: t.idx, f: 0 };
    for (var i = lo; i <= hi; i++) {
      var a = P[i], b = P[i + 1];
      var ax = (a.lng - c.lng) * kx, ay = (a.lat - c.lat) * ky, bx = (b.lng - c.lng) * kx, by = (b.lat - c.lat) * ky;
      var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      var f = L > 0 ? -(ax * dx + ay * dy) / L : 0; f = Math.max(0, Math.min(1, f));
      var px = ax + f * dx, py = ay + f * dy, d = Math.sqrt(px * px + py * py);
      if (d < best.d) best = { d: d, i: i, f: f };
    }
    t.projected = true;
    t.idx = best.i;
    t.along = r.cum[best.i] + best.f * (r.cum[best.i + 1] - r.cum[best.i]);
    t.remaining = Math.max(0, r.distance - t.along);
    t.offDist = best.d;
    while (t.stepIdx < r.steps.length - 1 && t.idx >= r.steps[t.stepIdx].end) t.stepIdx++;
    if (hav(c, t.dest) < 40 || (t.remaining < 30 && best.d < 60)) { arrive(); return; }
    if (best.d > 70 && acc < 40) t.off++; else t.off = 0;
    if (t.off >= 3 && Date.now() - t.lastReroute > 20000) {
      t.off = 0; t.lastReroute = Date.now(); t.projected = false;
      FD.toast('Off route · finding a new route'); say('Recalculating');
      plan(c);
      return;
    }
    guidance();
  }
  function arrive() {
    var t = N.trip; if (t.arrived) return;
    t.arrived = true; t.status = 'arrived'; t.remaining = 0;
    say('You have arrived at ' + t.dest.name);
    FD.onTrip('arrived');
  }
  N.upcoming = function (ahead) {
    var t = N.trip; if (!t || !t.route) return null;
    var r = t.route, s = r.steps, k = t.stepIdx + (ahead || 0);
    var cur = s[k], nx = s[k + 1];
    if (!cur) return null;
    var endAlong = r.cum[cur.end];
    var dist = Math.max(0, endAlong - t.along);
    var arriveText = 'Arrive at ' + (t.dest ? t.dest.name : 'destination');
    if (!nx) return ahead ? null : { instr: arriveText, man: 'ARRIVE', dist: t.remaining };
    var after = s[k + 2];
    return { instr: nx.instr || 'Continue', man: nx.man, dist: dist, then: after ? (after.instr || 'Continue') : arriveText };
  };

  /* ---------- voice guidance ---------- */
  function say(text) {
    if (!FD.settings.voice || N.muted || !window.speechSynthesis || !text) return;
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-GB'; u.rate = 1.02;
      speechSynthesis.speak(u);
    } catch (e) { }
  }
  function spoken(m) { return m >= 1000 ? (Math.round(m / 100) / 10) + ' kilometres' : (Math.round(m / 50) * 50) + ' metres'; }
  function guidance() {
    var u = N.upcoming(); if (!u) return;
    var t = N.trip, key = t.stepIdx, d = u.dist;
    var instr = u.instr.charAt(0).toLowerCase() + u.instr.slice(1);
    function fire(tag, text) { var k = key + ':' + tag; if (t.said[k]) return; t.said[k] = 1; say(text); }
    if (d <= 70) fire('now', u.instr);
    else if (d <= 350) fire('near', 'In ' + spoken(d) + ', ' + instr);
    else if (d <= 1200 && d >= 700) fire('far', 'In ' + spoken(d) + ', ' + instr);
  }

  /* ---------- map ---------- */
  N.mapMessage = function () {
    if (!FD.settings.apiKey) return 'Add your Google Maps key in Settings to see the map and get directions.<br>Trip stats are still recorded.';
    if (authFailed) return 'Google rejected the Maps key.<br>Check it in Settings.';
    if (!N.mapsLoaded()) return 'Loading map…';
    return '';
  };
  N.attach = function (slot) {
    if (!slot) return;
    if (!mapEl) { mapEl = document.createElement('div'); mapEl.className = 'gmap'; }
    slot.insertBefore(mapEl, slot.firstChild);
    if (map || !FD.settings.apiKey) return;
    N.load().then(initMap).catch(function () { FD.onTrip('update'); });
  };
  function initMap() {
    if (map) return;
    var t = N.trip;
    map = new google.maps.Map(mapEl, {
      center: (t && t.pos) || N.lastPos || DUBAI, zoom: 16,
      disableDefaultUI: true, gestureHandling: 'greedy', clickableIcons: false, keyboardShortcuts: false,
      styles: DARK, backgroundColor: '#111821'
    });
    map.addListener('dragstart', function () { N.follow = false; });
    routeLine = new google.maps.Polyline({ map: map, strokeColor: '#34C3B5', strokeOpacity: 0.95, strokeWeight: 7, zIndex: 2 });
    car = new google.maps.Marker({ map: map, zIndex: 10, clickable: false });
    destMarker = new google.maps.Marker({ zIndex: 5, clickable: false });
    if (t && t.route) drawRoute();
    drawCar();
    FD.onTrip('update');
  }
  function drawRoute() {
    var t = N.trip; if (!map || !t || !t.route) return;
    routeLine.setPath(t.route.path);
    destMarker.setPosition({ lat: t.dest.lat, lng: t.dest.lng });
    destMarker.setMap(map);
    if (N.follow && t.pos) { map.panTo(t.pos); map.setZoom(16); }
  }
  function drawCar() {
    var t = N.trip; if (!map || !t || !t.pos) return;
    car.setPosition(t.pos);
    car.setIcon({
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 7, rotation: t.heading || 0,
      fillColor: '#F5A524', fillOpacity: 1, strokeColor: '#1A1305', strokeWeight: 2
    });
    if (N.follow) map.panTo(t.pos);
  }
  N.recenter = function () {
    N.follow = true;
    var t = N.trip;
    if (map && t && t.pos) { map.panTo(t.pos); map.setZoom(16); }
    else FD.toast('Waiting for GPS…');
  };

  /* ---------- keep the screen on while driving ---------- */
  function keepAwake() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () { });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && N.trip) keepAwake();
  });
})();
