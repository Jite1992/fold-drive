/* Fold Drive Android: Google Maps does the navigating; this reads its directions
   (via the Android app) and combines them with Fold Drive's own GPS trip stats. */
(function () {
  'use strict';
  if (!window.Android) return;
  var FD = window.FD, A = window.Android, U = FD.util, ic = FD.ic;
  FD.native = true;

  function J(s) { try { return JSON.parse(s); } catch (e) { return null; } }

  FD.status = {}; FD.counts = {}; FD.events = [];
  FD.refreshNative = function () {
    FD.status = J(A.status()) || {};
    FD.counts = J(A.counts()) || {};
    FD.events = FD.status.calendar ? (J(A.events()) || []) : [];
  };
  FD.refreshNative();
  FD.onResume = function () {
    FD.refreshNative();
    var a = document.activeElement;
    if (!(a && a.tagName === 'INPUT')) FD.render();
  };

  /* ---------- reading Google Maps' notification ---------- */
  function toMetres(v, unit) {
    v = parseFloat(String(v).replace(',', '.'));
    if (/km/i.test(unit)) return v * 1000;
    if (/mi/i.test(unit)) return v * 1609;
    if (/ft/i.test(unit)) return v * 0.3048;
    return v;
  }
  var DIST = /^\s*(?:in\s+)?(\d+(?:[.,]\d+)?)\s*(km|m|mi|ft)\b\s*[·•\-–,]?\s*(.*)$/i;
  function parseMaps(n) {
    if (!n || !n.active) return null;
    var head = n.title || n.titleBig || '';
    var ex = n.extras || {}, extraText = [];
    Object.keys(ex).forEach(function (k) {
      var v = ex[k];
      if (typeof v === 'string' && v.charAt(0) !== '<' && !/^android\.(title|text|subText|bigText|infoText|summaryText|template)$/.test(k)) extraText.push(v);
    });
    var fields = [n.title, n.titleBig, n.text, n.sub, n.info, n.summary, n.big].concat(n.lines || [], extraText).filter(Boolean)
      .filter(function (f, i, arr) { return arr.indexOf(f) === i; });
    var out = { raw: fields.join('  |  '), icon: n.icon || '', time: n.time, extras: ex };
    var m = head.match(DIST), t = n.text || '';
    var isSummary = function (s) { return /ETA|arriv|\b\d+\s*min\b|\b\d+\s*hr\b/i.test(s); };
    if (m) {
      out.turnM = toMetres(m[1], m[2]);
      out.instr = (m[3] || '').trim() || (isSummary(t) ? '' : t);
      if (m[3] && t && !isSummary(t)) out.then = t;
    } else {
      var mt = t.match(DIST);
      if (mt && !isSummary(t)) { out.turnM = toMetres(mt[1], mt[2]); out.instr = head || (mt[3] || '').trim(); }
      else { out.instr = head; if (t && !isSummary(t)) out.then = t; }
    }
    var summ = fields.filter(function (f) { return f !== head && isSummary(f); })[0] || '';
    out.summary = summ;
    var eta = summ.match(/(\d{1,2}:\d{2}\s*(?:[ap]\.?\s?m\.?)?)/i);
    if (eta) out.eta = eta[1].trim();
    var tm = summ.match(/(?:(\d+)\s*(?:hr|h|hours?)\s*)?(\d+)\s*min/i);
    if (tm) out.leftMin = parseInt(tm[1] || '0', 10) * 60 + parseInt(tm[2], 10);
    else { var th = summ.match(/(\d+)\s*(?:hr|h|hours?)\b/i); if (th) out.leftMin = parseInt(th[1], 10) * 60; }
    // no distance in the title: look for one in any other field (e.g. the status-bar chip text)
    if (out.turnM == null) {
      for (var fi = 0; fi < fields.length; fi++) {
        var fm = fields[fi] !== summ ? fields[fi].match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(km|m)\b/i) : null;
        if (fm && !isSummary(fields[fi])) { out.turnM = toMetres(fm[1], fm[2]); break; }
      }
    }
    // time left from the arrival time when Maps doesn't say it
    if (out.leftMin == null && out.eta) {
      var em = out.eta.match(/(\d{1,2}):(\d{2})\s*([ap])?/i);
      if (em) {
        var h = parseInt(em[1], 10), mi = parseInt(em[2], 10), ap = (em[3] || '').toLowerCase();
        if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0;
        var nowD = new Date(), at = new Date(nowD); at.setHours(h, mi, 0, 0);
        if (at - nowD < -5 * 60000) at.setDate(at.getDate() + 1);
        out.leftMin = Math.max(0, Math.round((at - nowD) / 60000));
        out.leftFromEta = true;
      }
    }
    var km = summ.match(/(\d+(?:[.,]\d+)?)\s*km\b/i);
    if (km) out.leftKm = parseFloat(km[1].replace(',', '.'));
    else { var mm = summ.match(/(\d+)\s*m\b/); if (mm) out.leftKm = parseInt(mm[1], 10) / 1000; }
    return out;
  }
  FD.parseMaps = parseMaps;
  FD.mapsDebug = function () { return parseMaps(J(A.nav())); };

  /* ---------- trip (replaces the web navigation) ---------- */
  var N = FD.nav = { trip: null, muted: false, native: true };
  var poll = null;

  N.start = function (dest) {
    if (dest && !dest.query && dest.lat == null) dest.query = dest.name;
    N.trip = { startedAt: Date.now(), distance: 0, speed: 0, top: 0, dest: dest, maps: null, waitingSince: Date.now() };
    A.startTrip(JSON.stringify(dest || {}), !!dest);
    if (!dest) A.keepOn(true);
    startPoll();
  };
  N.end = function () {
    var s = J(A.endTrip());
    stopPoll();
    var t = N.trip; N.trip = null;
    if (!t) return null;
    if (s) { t.distance = s.distance; t.top = s.top; t.startedAt = s.startedAt || t.startedAt; }
    t.endedAt = Date.now();
    return t;
  };
  function startPoll() { stopPoll(); poll = setInterval(pull, 1000); pull(); }
  function stopPoll() { if (poll) clearInterval(poll); poll = null; }
  function pull() {
    var t = N.trip; if (!t) return;
    var s = J(A.trip());
    if (s && s.active) {
      t.distance = s.distance; t.speed = s.speed; t.top = s.top; t.startedAt = s.startedAt;
      t.hasPos = s.hasPos; t.straight = s.straight; t.gps = s.gps;
    }
    var n = J(A.nav());
    t.maps = (n && n.active && n.time >= t.startedAt - 120000) ? parseMaps(n) : null;
    if (n && !n.active && n.endedAt && n.endedAt > t.startedAt && t.dest) t.mapsEnded = true;
    FD.onTrip('update');
  }
  N.attach = function () { };
  N.recenter = function () { A.openMaps(JSON.stringify(N.trip && N.trip.dest || {})); };
  N.upcoming = function () { return null; };
  N.mapMessage = function () { return ''; };
  N.load = function () { return Promise.resolve(); };
  N.mapsLoaded = function () { return true; };
  N.errorText = function (e) { return (e && e.message) || String(e); };
  N.suggest = function (q) { return Promise.resolve([{ main: q, secondary: 'Search in Google Maps', native: true }]); };
  N.resolve = function (r) { return Promise.resolve({ name: r.main, query: r.main, address: r.main }); };
  N.here = function () {
    return new Promise(function (res, rej) {
      FD.onLocation = function (loc) { if (loc && loc.lat != null) res(loc); else rej(new Error((loc && loc.error) || 'Could not get your location')); };
      A.locate();
    });
  };

  /* ---------- navigation screen ---------- */
  function stat(k, key, unit, cls, unitKey) {
    return '<div class="stat' + (cls ? ' ' + cls : '') + '"><span class="k">' + k + '</span><span class="v"><span data-b="' + key + '">–</span><small' + (unitKey ? ' data-b="' + unitKey + '"' : '') + '> ' + unit + '</small></span></div>';
  }
  N.renderScreen = function (L) {
    var i = L === 'i';
    var stats =
      stat('Drive time', 'drive', 'h:min') + stat(i ? 'Average speed' : 'Avg speed', 'avg', 'km/h') +
      stat(i ? 'Time to destination' : 'Time left', 'left', 'min') + stat(i ? 'Total trip time' : 'Total trip', 'total', 'min', '', 'totalU') +
      stat(i ? 'Km driven' : 'Driven', 'driven', 'km') + stat(i ? 'Km to destination' : 'To go', 'rem', 'km', 'teal') +
      '<button type="button" class="stat fuel" data-a="screen" data-s="fuel"><span class="k"><span>' + (i ? 'Fuel efficiency' : 'Fuel eff.') + '</span><span>›</span></span><span class="v"><span data-b="kml">–</span><small> km/L</small></span></button>' +
      stat(i ? 'Trip fuel used' : 'Trip fuel', 'tripL', 'L', '', 'tripU');
    var acts = '<div class="acts"><button type="button" class="end" data-a="end">' + (i ? 'End trip' : 'End') + '</button>' +
      '<button type="button" data-a="openmaps" aria-label="Show Google Maps" style="color:#34C3B5">' + ic('nav', 22) + '</button>' +
      '<button type="button" data-a="calls" aria-label="Calls" style="color:#6EA8FE">' + ic('phone', 22) + '</button>' +
      '<button type="button" data-a="open" data-app="whatsapp" aria-label="WhatsApp" style="color:#4ADE80">' + ic('wa', 22) + '</button>' +
      '<button type="button" data-a="open" data-app="business" aria-label="WhatsApp Business" style="color:#34C3B5">' + ic('wab', 22) + '</button></div>';
    return '<div class="nv nat ' + L + '"><div class="natTop">' +
      '<div class="turn wait" data-b="turn"></div>' +
      '<div class="natMid"><div class="dial big"><b data-b="speed">0</b><span>KM/H</span></div>' +
      '<div class="grow"><div class="lab">Arrival</div><div class="bigeta" data-b="eta">--:--</div>' +
      '<div class="ell" style="font-weight:600;font-size:15px" data-b="dest"></div><div class="s13 mute ell" data-b="sub"></div></div></div>' +
      '<div class="prog"><i data-b="prog"></i></div><div class="hint" data-b="hint"></div></div>' +
      '<div class="natBottom"><div class="' + (i ? 'st2' : 'st4') + '">' + stats + '</div>' + acts + '</div></div>';
  };
  function distLabel(m) { return m >= 1000 ? U.fmt(m / 1000, 1) + ' km' : Math.max(10, Math.round(m / 10) * 10) + ' m'; }
  function vm() {
    var t = N.trip, F = FD.calcFuel(), fmt = U.fmt, pad = U.pad;
    var el = Math.max(0, (Date.now() - t.startedAt) / 1000), km = t.distance / 1000, mp = t.maps;
    var v = {
      speed: Math.round(t.speed || 0),
      drive: Math.floor(el / 3600) + ':' + pad(Math.floor(el / 60) % 60),
      avg: el > 30 ? fmt(km / (el / 3600)) : '0',
      driven: fmt(km, 1),
      kml: F.avg ? fmt(F.avg, 1) : '–',
      tripL: F.avg ? fmt(km / F.avg, 1) : '–',
      tripU: F.avg ? ' L · AED ' + fmt(km / F.avg * F.price) : ' L',
      dest: t.dest ? t.dest.name : 'Free drive'
    };
    var left = mp && mp.leftMin != null ? mp.leftMin : null;
    var remKm = mp && mp.leftKm != null ? mp.leftKm : (t.straight != null ? t.straight / 1000 * 1.3 : null);
    v.left = left != null ? String(left) : '–';
    var total = Math.round(el / 60) + (left || 0);
    v.total = total >= 60 ? Math.floor(total / 60) + ':' + pad(total % 60) : String(total);
    v.totalU = total >= 60 ? ' h:min' : ' min';
    v.rem = remKm != null ? ((mp && mp.leftKm != null) ? '' : '≈') + fmt(remKm, 1) : '–';
    v.eta = mp && mp.eta ? mp.eta : (left != null ? U.hhmm(new Date(Date.now() + left * 60000)) : '--:--');
    v.prog = remKm != null && km + remKm > 0 ? Math.round(100 * km / (km + remKm)) : 0;
    v.sub = mp ? (mp.summary || 'Following Google Maps') : (t.dest ? 'Waiting for Google Maps' : 'Recording your drive');

    var big = '', line = '', small = '', cls = 'turn', iconHTML;
    if (mp && (mp.instr || mp.turnM != null)) {
      big = mp.turnM != null ? distLabel(mp.turnM) : '';
      line = mp.instr || 'Follow Google Maps';
      small = mp.then || '';
      iconHTML = mp.icon ? '<img src="' + mp.icon + '" alt="" width="52" height="52" style="flex-shrink:0;filter:brightness(0) invert(1)">' : ic('up', 48, 'currentColor', 2.6);
    } else if (t.mapsEnded) {
      cls += ' wait'; iconHTML = ic('flag', 44, 'currentColor', 2.6); big = 'Arrived?'; line = 'Google Maps finished navigating'; small = 'Tap End to save the trip';
    } else if (t.dest) {
      cls += ' wait'; iconHTML = ic('nav', 44, 'currentColor', 2.4); big = 'Google Maps';
      if (!FD.status.notif) { line = 'Directions can\'t be read yet'; small = 'Allow Notification access below'; }
      else { line = 'Waiting for directions…'; small = 'Start navigation in Google Maps'; }
    } else {
      cls += ' wait'; iconHTML = ic('wheel', 44, 'currentColor', 2.4); big = 'Free drive'; line = 'Recording distance, time and speed'; small = 'Tap End to save the trip';
    }
    if (!FD.status.location) { cls = 'turn err'; iconHTML = ic('target', 44, 'currentColor', 2.4); big = 'No GPS'; line = 'Allow location for Fold Drive'; small = 'Trip stats need it'; }
    v.turnCls = cls;
    v.turn = iconHTML + '<div class="grow"><b>' + U.esc(big) + '</b><div class="t ell">' + U.esc(line) + '</div>' + (small ? '<div class="s ell">' + U.esc(small) + '</div>' : '') + '</div>';
    var hint = '';
    if (!FD.status.location) hint = '<button type="button" class="btn amber" data-a="perm" data-p="location">Allow location</button>';
    else if (t.dest && !FD.status.notif) hint = '<button type="button" class="btn amber" data-a="perm" data-p="notif">Allow Notification access</button><span class="s12 mute">Lets Fold Drive read turns, time and km left from Google Maps.</span>';
    else if (!t.hasPos) hint = '<span class="s13 mute">Waiting for GPS…</span>';
    v.hint = hint;
    return v;
  }
  N.updateScreen = function () {
    if (!N.trip) return;
    var v = vm();
    document.querySelectorAll('[data-b]').forEach(function (el) {
      var k = el.getAttribute('data-b');
      if (k === 'turn') { el.className = v.turnCls; el.innerHTML = v.turn; }
      else if (k === 'hint') { if (el.getAttribute('data-h') !== v.hint) { el.innerHTML = v.hint; el.setAttribute('data-h', v.hint); } }
      else if (k === 'prog') el.style.width = v.prog + '%';
      else if (v[k] != null) el.textContent = v[k];
    });
  };

  /* ---------- settings: permissions and Google Maps link ---------- */
  FD.nativeSettings = function () {
    var s = FD.status;
    function row(ok, title, desc, p) {
      return '<div class="prow"><span class="dot' + (ok ? '' : ' off') + '"></span><div class="grow"><b style="font-size:15px">' + title + '</b><div class="s12 mute">' + desc + '</div></div>' +
        (ok ? '<span class="s13" style="color:var(--green);font-weight:600">On</span>' : '<button type="button" class="btn amber" data-a="perm" data-p="' + p + '">Allow</button>') + '</div>';
    }
    var d = FD.mapsDebug();
    return '<section class="sec"><h2>Permissions</h2><p>Fold Drive needs these to work while Google Maps navigates.</p>' +
      row(s.location, 'Location', 'Speed, km driven and trip time', 'location') +
      row(s.notif, 'Notification access', 'Reads turns, time and km left from Google Maps, and unread WhatsApp counts', 'notif') +
      row(s.overlay, 'Display over other apps', 'Floating stats bubble on top of Google Maps', 'overlay') +
      row(s.calendar, 'Calendar', 'Shows your upcoming meetings with one-tap navigation', 'calendar') +
      row(s.phone, 'Phone calls', 'One-tap calls to quick-dial contacts', 'phone') +
      row(s.notifications, 'Notifications', 'Shows that a trip is being recorded', 'notifications') +
      '<button type="button" class="btn" data-a="perm" data-p="battery">Allow running in background (battery)</button></section>' +
      '<section class="sec"><h2>Google Maps</h2>' +
      '<div class="toggle">Open Google Maps side by side on the inner screen<button type="button" data-a="pref" data-k="split" aria-pressed="' + !!s.splitOn + '"></button></div>' +
      '<div class="toggle">Floating stats bubble over Google Maps<button type="button" data-a="pref" data-k="overlay" aria-pressed="' + !!s.overlayOn + '"></button></div>' +
      '<p>Last directions read from Google Maps:</p><div class="empty" style="font-size:13px;word-break:break-word">' +
      (d ? U.esc(d.raw) + '<br><br>Turn: ' + (d.turnM != null ? Math.round(d.turnM) + ' m' : '–') + ' · ' + U.esc(d.instr || '–') +
        '<br>Time left: ' + (d.leftMin != null ? d.leftMin + ' min' + (d.leftFromEta ? ' (from arrival time)' : '') : '–') + ' · Km left: ' + (d.leftKm != null ? d.leftKm : '–') + ' · ETA: ' + U.esc(d.eta || '–') +
        '<br><br><b>All fields:</b><br>' + Object.keys(d.extras || {}).map(function (k) { return U.esc(k.replace(/^android\./, '')) + ' = ' + U.esc(JSON.stringify(d.extras[k])); }).join('<br>')
        : 'Nothing yet. Start navigation in Google Maps, then come back here.') +
      '</div><p>If these numbers look wrong, send a screenshot of this box to Claude so the reading can be adjusted.</p></section>';
  };
  FD.prefToggle = function (k) {
    var cur = k === 'split' ? FD.status.splitOn : FD.status.overlayOn;
    A.setPref(k, cur ? '0' : '1');
    FD.refreshNative(); FD.render();
  };

  // ask for location on first launch
  if (!FD.status.location) setTimeout(function () { A.request('location'); }, 800);
})();
