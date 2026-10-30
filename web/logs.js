/* Fold Drive: trip log, Salik statement import, parking with receipt photos, monthly export. */
(function () {
  'use strict';
  var FD = window.FD, X = FD.app, U = FD.util, ic = FD.ic;
  var fmt = U.fmt, esc = U.esc, pad = U.pad;

  FD.icons.receipt = '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>';
  FD.icons.list = '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>';
  FD.icons.camera = '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>';
  FD.icons.gate = '<path d="M4 21V5M20 21V5M4 9h16M8 9v4M12 9v4M16 9v4"/>';
  FD.icons.parking = '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V7h3a3 3 0 010 6h-3"/>';
  FD.icons.download = '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>';
  FD.icons.upload = '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>';
  FD.icons.trash = '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>';

  var A = window.Android;
  var S = X.S;
  if (!S.logMonth) S.logMonth = monthKey(new Date());

  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { FD.toast('Could not save. Phone storage may be full.'); } }
  function monthKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function monthLabel(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); }
  function hhmm(ms) { return U.hhmm(new Date(ms)); }
  function dayLong(ms) { return new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function dur(min) { min = Math.round(min); return min >= 60 ? Math.floor(min / 60) + ' h ' + pad(min % 60) + ' min' : min + ' min'; }

  /* ---------- trips: fuel, Salik and parking per trip ---------- */
  var salik = load('fd-salik', []);   // [{t, gate, amount, plate}]
  function trips() { return X.trips(); }
  /* km/L for a trip: the one you typed for it, else the one used when it was saved, else today's estimate */
  function kmlOf(tr) {
    if (parseFloat(tr.kmLManual) > 0) return parseFloat(tr.kmLManual);
    if (tr.litres > 0 && tr.km > 0) return tr.km / tr.litres;
    var F = FD.calcFuel(); return F.est || null;
  }
  function litresOf(tr) { var k = kmlOf(tr); return k ? tr.km / k : null; }
  function fuelCostOf(tr) {
    var l = litresOf(tr); return l != null ? l * (tr.price || FD.calcFuel().price) : null;
  }
  function kmlForm(tr) {
    var k = kmlOf(tr);
    return '<div class="row" style="flex-wrap:wrap"><label class="pin" for="kml-' + tr.id + '" style="flex:1;min-width:200px">Km/L for this trip' +
      '<input id="kml-' + tr.id + '" type="number" inputmode="decimal" step="0.1" placeholder="e.g. 11.5" value="' + (k ? (Math.round(k * 10) / 10) : '') + '"></label>' +
      '<button type="button" class="btn" data-a="setkml" data-id="' + tr.id + '">Update fuel</button></div>';
  }
  function salikOf(tr) {
    var a = tr.start - 3 * 60000, b = (tr.end || tr.start) + 3 * 60000;
    return salik.filter(function (c) { return c.t >= a && c.t <= b; });
  }
  function parkingOf(tr) { return tr.parking || []; }
  function sum(list, f) { return list.reduce(function (t, x) { return t + (f(x) || 0); }, 0); }
  function tripTotals(tr) {
    var sl = salikOf(tr), pk = parkingOf(tr), fc = fuelCostOf(tr) || 0;
    var sa = sum(sl, function (c) { return c.amount; }), pa = sum(pk, function (p) { return p.amount; });
    return { salik: sl, salikAed: sa, parking: pk, parkingAed: pa, fuelL: litresOf(tr), fuelAed: fc, total: fc + sa + pa };
  }

  /* ---------- addresses for start and end (phone geocoder, no key) ---------- */
  function addrFor(pos) {
    if (!pos || pos.lat == null) return '';
    if (A && A.revgeo) { try { return A.revgeo(pos.lat, pos.lng) || ''; } catch (e) { } }
    return pos.lat.toFixed(4) + ', ' + pos.lng.toFixed(4);
  }
  FD.logs = {};
  FD.logs.enrich = function (rec, t) {
    rec.id = rec.id || Date.now();
    rec.startPos = t.startPos || null;
    rec.endPos = t.pos || null;
    rec.routeKm = t.maps && t.maps.routeKm ? t.maps.routeKm : null;
    var F = FD.calcFuel();
    rec.kmL = F.avg || null; rec.price = F.price;
    setTimeout(function () {
      rec.startAddr = addrFor(rec.startPos); rec.endAddr = addrFor(rec.endPos);
      X.saveTrips(); if (S.modal === 'summary' || S.screen === 'logs') X.softRender();
    }, 50);
    return rec;
  };

  /* ---------- receipt photos (stored on the phone, in IndexedDB) ---------- */
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var r = indexedDB.open('fold-drive', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('receipts'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function putReceipt(id, dataUrl) {
    return db().then(function (d) { return new Promise(function (res, rej) { var tx = d.transaction('receipts', 'readwrite'); tx.objectStore('receipts').put(dataUrl, id); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); });
  }
  function getReceipt(id) {
    return db().then(function (d) { return new Promise(function (res) { var q = d.transaction('receipts').objectStore('receipts').get(id); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; }); });
  }
  function delReceipt(id) {
    return db().then(function (d) { d.transaction('receipts', 'readwrite').objectStore('receipts').delete(id); }).catch(function () { });
  }
  function shrink(file) {
    return new Promise(function (res, rej) {
      var rd = new FileReader();
      rd.onload = function () {
        var img = new Image();
        img.onload = function () {
          var m = 1400, w = img.width, h = img.height, k = Math.min(1, m / Math.max(w, h));
          var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', 0.78));
        };
        img.onerror = function () { rej(new Error('Not an image')); };
        img.src = rd.result;
      };
      rd.onerror = function () { rej(rd.error); };
      rd.readAsDataURL(file);
    });
  }
  function fillThumbs() {
    document.querySelectorAll('img[data-receipt]').forEach(function (im) {
      if (im.getAttribute('src')) return;
      getReceipt(im.getAttribute('data-receipt')).then(function (u) { if (u) im.src = u; else im.alt = 'Photo missing'; });
    });
  }

  /* ---------- parking form (after a trip, or later from the log) ---------- */
  function parkForm(tr) {
    var p = S.park || {};
    return '<div class="form" style="border-color:var(--amber)"><h3>' + FD.ic('parking', 20, '#F5A524') + ' Parking for this trip</h3>' +
      '<div class="fields">' +
      '<label for="pk-amt">Amount paid (AED)<input id="pk-amt" type="number" inputmode="decimal" step="any" data-pk="amount" placeholder="e.g. 10" value="' + esc(p.amount || '') + '"></label>' +
      '<label for="pk-loc">Location<input id="pk-loc" type="text" data-pk="location" placeholder="Where you parked" value="' + esc(p.location != null ? p.location : (tr.endAddr || '')) + '"></label></div>' +
      '<div class="row" style="flex-wrap:wrap"><label class="btn" for="pk-photo">' + FD.ic('camera', 18) + (p.receiptId ? 'Retake receipt photo' : 'Scan receipt') + '</label>' +
      '<input id="pk-photo" type="file" accept="image/*" capture="environment" data-pkphoto hidden>' +
      (p.thumb ? '<img src="' + p.thumb + '" alt="Receipt" style="height:56px;border-radius:8px">' : '<span class="s12 mute">Optional</span>') + '</div>' +
      '<div class="row"><button type="button" class="btn amber" data-a="pksave" data-id="' + tr.id + '" style="flex:1">Save parking</button>' +
      '<button type="button" class="btn" data-a="pkskip">' + (S.modal === 'summary' ? 'No parking' : 'Cancel') + '</button></div></div>';
  }

  /* ---------- summary shown when a trip ends ---------- */
  FD.logs.summary = function (t) {
    function cell(k, v) { return '<div class="mini"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }
    var tt = tripTotals(t);
    var parkedDone = S.parkDone === t.id;
    return '<div class="modal"><div class="mbox" role="dialog" aria-label="Trip saved"><h2>Trip saved</h2>' +
      '<div class="s13 mute">' + esc(t.startAddr || 'Start') + ' → ' + esc(t.endAddr || (t.dest ? t.dest.name : 'End')) + '</div>' +
      '<div class="sumgrid">' + cell('Km driven', fmt(t.km, 1) + ' km') + cell('Time taken', dur(t.min)) + cell('Average speed', fmt(t.avg) + ' km/h') +
      cell('Fuel used', tt.fuelL != null ? fmt(tt.fuelL, 1) + ' L' : '–') + cell('Fuel cost', tt.fuelL != null ? 'AED ' + fmt(tt.fuelAed, 2) : '–') + cell('Top speed', fmt(t.top) + ' km/h') + '</div>' +
      kmlForm(t) + '<div class="s12 mute">' + (parseFloat(t.kmLManual) > 0 ? 'Using the km/L you entered for this trip.' : (FD.calcFuel().avg ? 'Using your average from fill-ups. Change it for this trip if you know better.' : 'Enter your car\'s km/L to get fuel and cost for this trip.')) + '</div>' +
      (parkedDone ? '<div class="pv">Parking saved · AED ' + fmt(tt.parkingAed, 2) + '</div><button type="button" class="btn amber" data-a="close">Done</button>' : parkForm(t)) +
      '</div></div>';
  };

  /* ---------- the log screen ---------- */
  function monthTrips(k) { return trips().filter(function (t) { return monthKey(new Date(t.start)) === k; }); }
  function unmatched(k) {
    var all = trips();
    return salik.filter(function (c) {
      if (monthKey(new Date(c.t)) !== k) return false;
      return !all.some(function (tr) { return c.t >= tr.start - 180000 && c.t <= (tr.end || tr.start) + 180000; });
    });
  }
  function tripRow(tr) {
    var tt = tripTotals(tr);
    var chips = '';
    if (tt.salik.length) chips += '<span class="lchip">' + FD.ic('gate', 14) + 'Salik ×' + tt.salik.length + ' · AED ' + fmt(tt.salikAed) + '</span>';
    if (tt.parking.length) chips += '<span class="lchip">' + FD.ic('parking', 14) + 'Parking AED ' + fmt(tt.parkingAed, 2) + '</span>';
    return '<button type="button" class="lrow" data-a="logopen" data-id="' + tr.id + '">' +
      '<div class="sb"><b>' + dayLong(tr.start) + ' · ' + hhmm(tr.start) + '–' + hhmm(tr.end || tr.start) + '</b><span class="lamt">AED ' + fmt(tt.total, 2) + '</span></div>' +
      '<div class="s13 ell" style="color:var(--soft)">' + esc(tr.startAddr || 'Start') + ' → ' + esc(tr.endAddr || (tr.dest ? tr.dest.name : 'End')) + '</div>' +
      '<div class="s13 mute">' + fmt(tr.km, 1) + ' km · ' + dur(tr.min) + ' · ' + (tt.fuelL != null ? fmt(tt.fuelL, 1) + ' L · AED ' + fmt(tt.fuelAed, 2) + ' fuel' : 'fuel –') + '</div>' +
      (chips ? '<div class="row" style="flex-wrap:wrap;gap:6px">' + chips + '</div>' : '') + '</button>';
  }
  FD.logs.screen = function (L) {
    var k = S.logMonth, list = monthTrips(k);
    var T = list.map(tripTotals);
    var km = sum(list, function (t) { return t.km; }), min = sum(list, function (t) { return t.min; });
    var fl = sum(T, function (x) { return x.fuelL; }), fa = sum(T, function (x) { return x.fuelAed; });
    var sa = sum(T, function (x) { return x.salikAed; }), sc = sum(T, function (x) { return x.salik.length; });
    var pa = sum(T, function (x) { return x.parkingAed; });
    var un = unmatched(k);
    function tile(kk, v) { return '<div class="mini"><span class="k">' + kk + '</span><span class="v">' + v + '</span></div>'; }
    var summary =
      '<div class="sb"><button type="button" class="sq greybtn" data-a="logmonth" data-d="-1" aria-label="Previous month">' + FD.ic('back', 20) + '</button>' +
      '<b style="font:700 22px var(--display)">' + monthLabel(k) + '</b>' +
      '<button type="button" class="sq greybtn" data-a="logmonth" data-d="1" aria-label="Next month">' + FD.ic('chev', 20) + '</button></div>' +
      '<div class="hero" style="padding:12px 16px"><div><div class="lab" style="color:var(--ink)">Total driving cost</div><b style="font-size:44px">AED ' + fmt(fa + sa + pa) + '</b></div>' +
      '<div class="meta"><span>' + list.length + (list.length === 1 ? ' trip' : ' trips') + '</span><span>' + fmt(km, 1) + ' km</span><span>' + dur(min) + '</span></div></div>' +
      '<div class="g3">' + tile('Fuel', fmt(fl, 1) + ' L') + tile('Fuel cost', 'AED ' + fmt(fa)) + tile('Salik', sc + ' · AED ' + fmt(sa)) + '</div>' +
      '<div class="g3">' + tile('Parking', 'AED ' + fmt(pa)) + tile('Avg per trip', list.length ? fmt(km / list.length, 1) + ' km' : '–') + tile('Cost per km', km ? 'AED ' + fmt((fa + sa + pa) / km, 2) : '–') + '</div>' +
      '<div class="row" style="flex-wrap:wrap"><label class="btn amber" for="salikFile">' + FD.ic('upload', 18) + 'Import Salik statement</label>' +
      '<input id="salikFile" type="file" accept=".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-salik hidden>' +
      '<button type="button" class="btn" data-a="logexport">' + FD.ic('download', 18) + 'Export month (Excel)</button></div>' +
      '<p class="s12 mute" style="margin:0">Download your trips statement from the Salik website or app as Excel, then import it here. Each crossing is matched to the drive it happened on by its time.</p>' +
      (un.length ? '<div class="empty" style="font-size:13px"><b style="color:var(--fg)">' + un.length + ' Salik crossing' + (un.length > 1 ? 's' : '') + ' not matched to a logged trip</b><br>' +
        un.slice(0, 8).map(function (c) { return dayLong(c.t) + ' ' + hhmm(c.t) + ' · ' + esc(c.gate) + ' · AED ' + fmt(c.amount); }).join('<br>') + (un.length > 8 ? '<br>…' : '') + '</div>' : '');
    var rows = list.length ? list.map(tripRow).join('') : '<div class="empty">No trips logged in ' + monthLabel(k) + '. Trips are saved when you tap End.</div>';
    var head = '<div class="fhd"><button type="button" class="backbtn" data-a="back" aria-label="Back">' + FD.ic('back', 20, 'currentColor', 2.4) + '</button><h1>Trip log</h1>' + FD.ic('list', 24, '#F5A524') + '</div>';
    if (L === 'i') {
      return '<div class="fu i lg">' + head + '<div class="cols"><div class="colL">' + summary + '</div><div class="colR"><span class="lab">Trips · newest first</span><div class="hist">' + rows + '</div></div></div></div>';
    }
    return '<div class="fu c lg">' + head + '<div class="fbody">' + summary + '<span class="lab">Trips · newest first</span><div class="hist">' + rows + '</div></div></div>';
  };

  /* ---------- trip detail ---------- */
  FD.logs.modal = function () {
    if (S.modal === 'logtrip') {
      var tr = trips().filter(function (t) { return String(t.id) === String(S.logTrip); })[0];
      if (!tr) return '';
      var tt = tripTotals(tr);
      function r(k, v) { return '<div class="sb s15" style="padding:6px 0;border-bottom:1px solid var(--line)"><span class="mute">' + k + '</span><b style="text-align:right">' + v + '</b></div>'; }
      var body =
        r('From', esc(tr.startAddr || '–') + '<br><span class="s12 mute">' + dayLong(tr.start) + ' ' + hhmm(tr.start) + '</span>') +
        r('To', esc(tr.endAddr || (tr.dest ? tr.dest.name : '–')) + '<br><span class="s12 mute">' + hhmm(tr.end || tr.start) + '</span>') +
        (tr.dest ? r('Destination', esc(tr.dest.name)) : '') +
        r('Time taken', dur(tr.min)) + r('Distance driven', fmt(tr.km, 1) + ' km') +
        (tr.routeKm ? r('Google Maps route', fmt(tr.routeKm, 1) + ' km') : '') +
        r('Average speed', fmt(tr.avg) + ' km/h') + r('Top speed', fmt(tr.top) + ' km/h') +
        r('Fuel used (estimate)', tt.fuelL != null ? fmt(tt.fuelL, 2) + ' L<br><span class="s12 mute">at ' + fmt(kmlOf(tr), 1) + ' km/L' + (parseFloat(tr.kmLManual) > 0 ? ' (entered)' : '') + '</span>' : '–') +
        r('Fuel cost', tt.fuelL != null ? 'AED ' + fmt(tt.fuelAed, 2) + (tr.price ? '<br><span class="s12 mute">at AED ' + fmt(tr.price, 2) + '/L</span>' : '') : '–') +
        r('Salik', tt.salik.length ? tt.salik.map(function (c) { return hhmm(c.t) + ' ' + esc(c.gate) + ' · AED ' + fmt(c.amount); }).join('<br>') : 'None') +
        r('Parking', tt.parking.length ? tt.parking.map(function (p) { return 'AED ' + fmt(p.amount, 2) + (p.location ? ' · ' + esc(p.location) : ''); }).join('<br>') : 'None') +
        r('Trip total', 'AED ' + fmt(tt.total, 2));
      var photos = tt.parking.filter(function (p) { return p.receiptId; }).map(function (p) {
        return '<button type="button" data-a="logphoto" data-r="' + p.receiptId + '" style="padding:0"><img data-receipt="' + p.receiptId + '" alt="Parking receipt" style="height:84px;border-radius:10px;border:1px solid var(--line)"></button>' +
          '<button type="button" class="del" data-a="pkdel" data-id="' + tr.id + '" data-p="' + p.id + '" aria-label="Delete this parking">' + FD.ic('trash', 16) + '</button>';
      }).join('');
      return '<div class="modal" data-a="close"><div class="mbox" role="dialog" aria-label="Trip details"><h2>Trip details</h2>' + body +
        (photos ? '<div class="row" style="flex-wrap:wrap">' + photos + '</div>' : '') + kmlForm(tr) +
        (S.addPark ? parkForm(tr) : '<div class="row"><button type="button" class="btn amber" data-a="pkadd" style="flex:1">' + FD.ic('parking', 18) + 'Add parking</button>' +
          '<button type="button" class="btn" data-a="logdel" data-id="' + tr.id + '">' + FD.ic('trash', 18) + 'Delete</button><button type="button" class="btn" data-a="close">Close</button></div>') +
        '</div></div>';
    }
    if (S.modal === 'logphoto') {
      return '<div class="modal" data-a="logphotoclose"><div class="mbox" style="max-width:720px"><img data-receipt="' + esc(S.logPhoto) + '" alt="Parking receipt" style="width:100%;border-radius:12px">' +
        '<button type="button" class="btn" data-a="logphotoclose">Close</button></div></div>';
    }
    return '';
  };
  FD.logs.afterRender = fillThumbs;

  /* ---------- Salik statement import ---------- */
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'vendor/xlsx.full.min.js';
      s.onload = function () { res(); }; s.onerror = function () { rej(new Error('Could not load the Excel reader')); };
      document.head.appendChild(s);
    });
  }
  var MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function parseWhen(v, tv) {
    var d = null;
    if (typeof v === 'number' && v > 30000 && v < 80000) {
      var ms = Math.round((v - 25569) * 86400000), u = new Date(ms);
      d = new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
    } else if (v != null) {
      var s = String(v).trim(), m;
      if ((m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) d = new Date(+m[1], +m[2] - 1, +m[3]);
      else if ((m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) { var y = +m[3]; if (y < 100) y += 2000; d = new Date(y, +m[2] - 1, +m[1]); }
      else if ((m = s.match(/(\d{1,2})[\s\-]+([A-Za-z]{3})[a-z]*[\s\-,]+(\d{4})/))) d = new Date(+m[3], MON[m[2].toLowerCase()], +m[1]);
      if (d) {
        var t = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])?/);
        if (t) setTime(d, t);
      }
    }
    if (!d || isNaN(d)) return null;
    if (tv != null && tv !== '') {
      if (typeof tv === 'number' && tv < 1) { var secs = Math.round(tv * 86400); d.setHours(Math.floor(secs / 3600), Math.floor(secs / 60) % 60, secs % 60); }
      else { var tt = String(tv).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])?/); if (tt) setTime(d, tt); }
    }
    return d.getTime();
  }
  function setTime(d, t) {
    var h = +t[1], ap = (t[4] || '').toLowerCase();
    if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0;
    d.setHours(h, +t[2], +(t[3] || 0), 0);
  }
  function findCol(head, re, not) {
    for (var i = 0; i < head.length; i++) { var h = String(head[i] || ''); if (re.test(h) && !(not && not.test(h))) return i; }
    return -1;
  }
  function parseRows(rows) {
    var hi = -1;
    for (var r = 0; r < Math.min(rows.length, 30); r++) {
      var hits = (rows[r] || []).filter(function (c) { return /date|time|gate|amount|toll|plate|location|charge|fare/i.test(String(c || '')); }).length;
      if (hits >= 2) { hi = r; break; }
    }
    if (hi < 0) throw new Error('Could not find the column headings (date, gate, amount) in this file.');
    var head = rows[hi];
    var cDate = findCol(head, /date/i), cTime = findCol(head, /time/i, /date/i);
    if (cDate < 0) cDate = findCol(head, /time/i);
    var cGate = findCol(head, /gate|location|toll|description|point/i);
    var cAmt = findCol(head, /amount|charge|fare|aed|value|debit|fee/i);
    var cPlate = findCol(head, /plate|vehicle/i);
    if (cDate < 0) throw new Error('No date column found in this file.');
    var out = [];
    for (var i = hi + 1; i < rows.length; i++) {
      var row = rows[i] || [];
      var t = parseWhen(row[cDate], cTime >= 0 ? row[cTime] : null);
      if (!t) continue;
      var amt = cAmt >= 0 ? parseFloat(String(row[cAmt] == null ? '' : row[cAmt]).replace(/[^\d.\-]/g, '')) : NaN;
      out.push({ t: t, gate: cGate >= 0 ? String(row[cGate] || '').trim() : 'Salik gate', amount: isNaN(amt) ? 0 : Math.abs(amt), plate: cPlate >= 0 ? String(row[cPlate] || '') : '' });
    }
    return out;
  }
  FD.logs.parseSalikRows = parseRows;
  function importSalik(file) {
    FD.toast('Reading Salik statement…');
    loadXlsx().then(function () {
      return new Promise(function (res, rej) {
        var rd = new FileReader();
        rd.onload = function () { res(rd.result); }; rd.onerror = function () { rej(rd.error); };
        rd.readAsArrayBuffer(file);
      });
    }).then(function (buf) {
      var wb = XLSX.read(buf, { type: 'array', cellDates: false });
      var found = [];
      wb.SheetNames.forEach(function (n) {
        var rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
        try { found = found.concat(parseRows(rows)); } catch (e) { if (!found.length && n === wb.SheetNames[wb.SheetNames.length - 1]) throw e; }
      });
      if (!found.length) throw new Error('No Salik crossings found in this file.');
      var keys = {}; salik.forEach(function (c) { keys[c.t + '|' + c.gate] = 1; });
      var added = found.filter(function (c) { if (keys[c.t + '|' + c.gate]) return false; keys[c.t + '|' + c.gate] = 1; return true; });
      salik = salik.concat(added).sort(function (a, b) { return a.t - b.t; });
      save('fd-salik', salik);
      var all = trips();
      var matched = added.filter(function (c) { return all.some(function (tr) { return c.t >= tr.start - 180000 && c.t <= (tr.end || tr.start) + 180000; }); }).length;
      if (added.length) S.logMonth = monthKey(new Date(added[added.length - 1].t));
      X.render();
      FD.toast(added.length + ' crossings imported · ' + matched + ' matched to trips' + (found.length > added.length ? ' · ' + (found.length - added.length) + ' already imported' : ''));
    }).catch(function (e) { FD.toast(e.message || 'Could not read this file.'); });
  }

  /* ---------- export ---------- */
  function exportMonth() {
    var k = S.logMonth, list = monthTrips(k).slice().reverse();
    var cols = ['Date', 'Start time', 'End time', 'From', 'To', 'Destination', 'Distance (km)', 'Time taken (min)', 'Average speed (km/h)', 'Top speed (km/h)',
      'Km/L', 'Fuel used (L)', 'Fuel cost (AED)', 'Salik crossings', 'Salik (AED)', 'Parking (AED)', 'Parking location', 'Trip total (AED)'];
    function q(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var lines = [cols.join(',')];
    list.forEach(function (tr) {
      var tt = tripTotals(tr), d = new Date(tr.start);
      lines.push([d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), hhmm(tr.start), hhmm(tr.end || tr.start), tr.startAddr || '', tr.endAddr || '', tr.dest ? tr.dest.name : '',
        tr.km.toFixed(1), Math.round(tr.min), Math.round(tr.avg), Math.round(tr.top), kmlOf(tr) ? kmlOf(tr).toFixed(1) : '', tt.fuelL != null ? tt.fuelL.toFixed(2) : '', tt.fuelL != null ? tt.fuelAed.toFixed(2) : '',
        tt.salik.length, tt.salikAed.toFixed(2), tt.parkingAed.toFixed(2), tt.parking.map(function (p) { return p.location; }).join('; '), tt.total.toFixed(2)].map(q).join(','));
    });
    var name = 'fold-drive-trips-' + k + '.csv', text = '﻿' + lines.join('\r\n');
    if (A && A.saveText) { FD.toast(A.saveText(name, text, 'text/csv') ? 'Saved to Downloads · ' + name : 'Could not save the file'); return; }
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); FD.toast('Saved · ' + name);
  }

  /* ---------- events ---------- */
  function findTrip(id) { return trips().filter(function (t) { return String(t.id) === String(id); })[0]; }
  FD.logs.click = function (a, el) {
    switch (a) {
      case 'logmonth':
        var p = S.logMonth.split('-'), d = new Date(+p[0], +p[1] - 1 + (+el.getAttribute('data-d')), 1);
        S.logMonth = monthKey(d); X.render(); return true;
      case 'logopen': S.logTrip = el.getAttribute('data-id'); S.modal = 'logtrip'; S.addPark = false; S.park = {}; X.render(); return true;
      case 'logexport': exportMonth(); return true;
      case 'logphoto': S.logPhoto = el.getAttribute('data-r'); S.modal = 'logphoto'; X.render(); return true;
      case 'logphotoclose': S.modal = 'logtrip'; X.render(); return true;
      case 'logdel':
        if (el.getAttribute('data-confirm') !== '1') { el.setAttribute('data-confirm', '1'); el.innerHTML = 'Tap again to delete'; return true; }
        var tr = findTrip(el.getAttribute('data-id'));
        if (tr) (tr.parking || []).forEach(function (pp) { if (pp.receiptId) delReceipt(pp.receiptId); });
        X.setTrips(trips().filter(function (t) { return String(t.id) !== el.getAttribute('data-id'); }));
        S.modal = null; X.render(); FD.toast('Trip deleted'); return true;
      case 'setkml':
        var tk = findTrip(el.getAttribute('data-id')), inp = document.getElementById('kml-' + el.getAttribute('data-id'));
        var v = inp ? parseFloat(inp.value) : NaN;
        if (!tk) return true;
        if (!(v > 0 && v < 60)) { FD.toast('Enter km/L between 1 and 60.'); return true; }
        tk.kmLManual = v; tk.litres = tk.km / v; tk.price = tk.price || FD.calcFuel().price; tk.cost = tk.litres * tk.price;
        X.saveTrips(); if (S.summary && String(S.summary.id) === String(tk.id)) S.summary = tk;
        X.render(); FD.toast('Fuel updated · ' + fmt(tk.litres, 2) + ' L · AED ' + fmt(tk.cost, 2)); return true;
      case 'pkadd': S.addPark = true; S.park = {}; X.render(); return true;
      case 'pkskip':
        if (S.modal === 'summary') { S.modal = null; S.park = {}; } else S.addPark = false;
        X.render(); return true;
      case 'pksave':
        var t2 = findTrip(el.getAttribute('data-id')), pk = S.park || {};
        var amt = parseFloat(pk.amount);
        if (!t2) return true;
        if (!(amt >= 0) || pk.amount === '' || pk.amount == null) { FD.toast('Enter the amount you paid for parking.'); return true; }
        t2.parking = (t2.parking || []).concat([{ id: Date.now(), amount: amt, location: pk.location != null ? pk.location : (t2.endAddr || ''), receiptId: pk.receiptId || null, time: Date.now() }]);
        X.saveTrips();
        if (S.modal === 'summary') { S.parkDone = t2.id; S.summary = t2; } else S.addPark = false;
        S.park = {}; X.render(); FD.toast('Parking saved'); return true;
      case 'pkdel':
        var t3 = findTrip(el.getAttribute('data-id')), pid = el.getAttribute('data-p');
        if (t3) {
          (t3.parking || []).forEach(function (pp) { if (String(pp.id) === pid && pp.receiptId) delReceipt(pp.receiptId); });
          t3.parking = (t3.parking || []).filter(function (pp) { return String(pp.id) !== pid; }); X.saveTrips(); X.render();
        }
        return true;
    }
    return false;
  };
  FD.logs.input = function (tg) {
    var k = tg.getAttribute && tg.getAttribute('data-pk');
    if (k) { S.park = S.park || {}; S.park[k] = tg.value; return true; }
    return false;
  };
  FD.logs.change = function (tg) {
    if (tg.hasAttribute('data-salik') && tg.files && tg.files[0]) { importSalik(tg.files[0]); tg.value = ''; return true; }
    if (tg.hasAttribute('data-pkphoto') && tg.files && tg.files[0]) {
      var f = tg.files[0];
      shrink(f).then(function (url) {
        var id = 'r' + Date.now();
        return putReceipt(id, url).then(function () { S.park = S.park || {}; S.park.receiptId = id; S.park.thumb = url; X.render(); FD.toast('Receipt photo added'); });
      }).catch(function () { FD.toast('Could not read that photo.'); });
      return true;
    }
    return false;
  };
  FD.logs.monthStats = function () {
    var list = monthTrips(monthKey(new Date()));
    return { trips: list.length, km: sum(list, function (t) { return t.km; }), cost: sum(list.map(tripTotals), function (x) { return x.total; }) };
  };
})();
