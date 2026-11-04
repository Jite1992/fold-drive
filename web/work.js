/* Fold Drive: Work expenses. Tag each drive Work or Personal, collect work drives, Salik on work drives,
   parking slips and other expenses for the claim period (23rd to 22nd), and export the claim workbook. */
(function () {
  'use strict';
  var FD = window.FD, X = FD.app, U = FD.util, ic = FD.ic, A = window.Android;
  var fmt = U.fmt, esc = U.esc, pad = U.pad, S = X.S;

  FD.icons.brief = '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"/>';
  FD.icons.homeic = '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>';
  FD.icons.cog = '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>';
  FD.icons.share = '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>';

  function J(s) { try { return JSON.parse(s); } catch (e) { return null; } }
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { FD.toast('Could not save. Phone storage may be full.'); } }
  function trips() { return X.trips(); }
  function findTrip(id) { return trips().filter(function (t) { return String(t.id) === String(id); })[0]; }
  function r2(n) { return Math.round((+n || 0) * 100) / 100; }
  function day(ms) { return new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function dmy(ms) { return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function hm(ms) { return U.hhmm(new Date(ms)); }

  /* ---------- claim settings ---------- */
  var st = FD.settings;
  st.claim = Object.assign({ name: '', email: '', empId: '', vehicle: '', authorizedBy: '', rate: 0.57, startDay: 23, suggestCal: true, submitted: {}, advance: {} }, st.claim || {});
  var C = st.claim;
  function saveSettings() { save('fd-settings', st); }
  var other = load('fd-other', []);   // other expenses: {id, date, details, amount, vat, receiptId, kind}
  function saveOther() { save('fd-other', other); }

  /* ---------- claim period: 23rd to the 22nd of the next month ---------- */
  function periodOf(ms) {
    var d = new Date(ms), sd = +C.startDay || 23, y = d.getFullYear(), m = d.getMonth();
    if (d.getDate() < sd) m -= 1;
    var start = new Date(y, m, sd), end = new Date(y, m + 1, sd - 1, 23, 59, 59, 999);
    return { start: start.getTime(), end: end.getTime(), key: start.getFullYear() + '-' + pad(start.getMonth() + 1),
      label: start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' – ' + end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      mon: end.toLocaleDateString('en-GB', { month: 'short' }) + '-' + end.getFullYear() };
  }
  if (!S.workAt) S.workAt = Date.now();
  if (!S.workTab) S.workTab = 'drives';

  /* ---------- places, odometer ---------- */
  function near(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return false;
    var dy = (a.lat - b.lat) * 111000, dx = (a.lng - b.lng) * 111000 * Math.cos(a.lat * Math.PI / 180);
    return Math.sqrt(dx * dx + dy * dy) < 300;
  }
  function placeName(pos) {
    var p = (st.places || []).filter(function (x) { return near(pos, x); })[0];
    return p ? p.name : '';
  }
  function fromOf(tr) { return tr.from || placeName(tr.startPos) || shortAddr(tr.startAddr) || 'Start'; }
  function toOf(tr) { return tr.to || placeName(tr.endPos) || (tr.dest && tr.dest.name) || shortAddr(tr.endAddr) || 'End'; }
  function shortAddr(a) { return a ? String(a).split(',').slice(0, 2).join(',').trim() : ''; }
  function kmOf(tr) { return tr.odoStart != null && tr.odoEnd != null && tr.odoEnd >= tr.odoStart ? tr.odoEnd - tr.odoStart : Math.round(tr.km); }
  /* Odometer at the start of a drive: the last reading you gave (refill or claim settings) plus GPS km since. */
  function odoFor(tr) {
    var ref = st.odoRef; if (!ref || !(ref.odo > 0)) return null;
    var since = trips().filter(function (t) { return t !== tr && t.start >= ref.at && t.start < tr.start; });
    return Math.round(ref.odo + since.reduce(function (s, t) { return s + (t.km || 0); }, 0));
  }
  FD.work = {};
  FD.work.setOdo = function (odo) { if (odo > 0) { st.odoRef = { odo: odo, at: Date.now() }; saveSettings(); } };

  /* ---------- calendar: a meeting at the end of the drive suggests Work ---------- */
  function meetingFor(tr) {
    if (!C.suggestCal) return null;
    var end = tr.end || tr.start;
    return (FD.events || []).filter(function (e) { return !e.allDay && e.begin > end - 75 * 60000 && e.begin < end + 90 * 60000; })
      .sort(function (a, b) { return Math.abs(a.begin - end) - Math.abs(b.begin - end); })[0] || null;
  }

  /* ---------- tagging ---------- */
  function setType(tr, type) {
    tr.type = type;
    if (type === 'work') {
      if (!tr.from) tr.from = fromOf(tr);
      if (!tr.to) tr.to = toOf(tr);
      if (tr.notes == null) { var m = meetingFor(tr); tr.notes = m ? m.title : ''; }
      if (tr.odoStart == null) { var o = odoFor(tr); if (o != null) { tr.odoStart = o; tr.odoEnd = o + Math.round(tr.km); } }
    }
    X.saveTrips();
    if (A && A.setTag) try { A.setTag(String(tr.id), type); } catch (e) { }
  }
  FD.work.setType = setType;
  /* called when any trip is saved */
  FD.work.afterSave = function (tr) {
    if (tr.odoStart == null) { var o = odoFor(tr); if (o != null) { tr.odoStart = o; tr.odoEnd = o + Math.round(tr.km); } }
    if (st.odoRef && st.odoRef.odo > 0 && tr.odoEnd != null) { st.odoRef = { odo: tr.odoEnd, at: tr.end || tr.start }; saveSettings(); }
    var m = meetingFor(tr); if (m) tr.suggest = m.title;
    X.saveTrips();
    if (!tr.type && A && A.untagged && (!FD.status || FD.status.askTag !== false)) try { A.untagged(String(tr.id), tr.end || tr.start, day(tr.start) + ', ' + hm(tr.start) + ' · ' + fmt(tr.km, 1) + ' km'); } catch (e) { }
  };

  function field(id, label, key, val, type) {
    return '<label for="' + id + '">' + label + '<input id="' + id + '" ' + (type === 'number' ? 'type="number" inputmode="numeric"' : 'type="text"') + ' data-wk="' + key + '" value="' + esc(val == null ? '' : val) + '"></label>';
  }
  /* Work / Personal block, shown when a trip ends and in trip details */
  FD.work.tagBlock = function (tr) {
    var w = tr.type === 'work', p = tr.type === 'personal';
    var sug = !tr.type && (tr.suggest || (meetingFor(tr) || {}).title);
    var h = '<div class="form" style="border-color:' + (tr.type ? 'var(--line)' : 'var(--amber)') + '"><h3>Was this a work drive?</h3>' +
      '<div class="g2"><button type="button" class="tagbtn" data-a="wtag" data-t="work" data-id="' + tr.id + '" aria-pressed="' + w + '">' + ic('brief', 20) + 'Work</button>' +
      '<button type="button" class="tagbtn" data-a="wtag" data-t="personal" data-id="' + tr.id + '" aria-pressed="' + p + '">' + ic('homeic', 20) + 'Personal</button></div>' +
      (sug ? '<div class="s12" style="color:var(--teal)">' + ic('cal', 14, 'currentColor') + ' Suggested Work: matches your meeting "' + esc(sug) + '"</div>' : '');
    if (w) {
      var k = kmOf(tr), rate = +C.rate || 0;
      h += '<div class="fields">' + '<label for="wk-notes" style="grid-column:1/3">Description / notes<input id="wk-notes" type="text" data-wk="notes" data-id="' + tr.id + '" value="' + esc(tr.notes || '') + '" placeholder="e.g. client name, site visit"></label>' +
        fieldId(tr, 'from', 'Starting location', tr.from) + fieldId(tr, 'to', 'Destination', tr.to) +
        fieldId(tr, 'odoStart', 'Odometer start', tr.odoStart, 'number') + fieldId(tr, 'odoEnd', 'Odometer end', tr.odoEnd, 'number') + '</div>' +
        '<div class="s12 mute">' + (tr.odoStart != null ? 'Odometer worked out from your last reading plus GPS km. Just a reference: correct it if your dashboard differs.' : 'Enter the odometer once (or set it in Claim details) and later drives fill in on their own.') + '</div>' +
        '<div class="pv sb" data-wcalc="' + tr.id + '"><span>' + k + ' km × AED ' + fmt(rate, 2) + '</span><b>AED ' + fmt(k * rate, 2) + '</b></div>';
    }
    return h + '</div>';
  };
  function fieldId(tr, key, label, val, type) {
    var id = 'wk-' + key;
    return '<label for="' + id + '">' + label + '<input id="' + id + '" ' + (type === 'number' ? 'type="number" inputmode="numeric"' : 'type="text"') + ' data-wk="' + key + '" data-id="' + tr.id + '" value="' + esc(val == null ? '' : val) + '"></label>';
  }

  /* hook the tag block into the trip-ended summary and the trip details */
  var origSummary = FD.logs.summary, origModal = FD.logs.modal;
  FD.logs.summary = function (t) {
    var h = origSummary(t);
    return FD.settings.claim && (!FD.status || FD.status.askTag !== false || t.type) ? h.replace('</h2>', '</h2>' + FD.work.tagBlock(t)) : h;
  };
  FD.logs.modal = function () {
    var h = origModal();
    if (S.modal === 'logtrip') { var tr = findTrip(S.logTrip); if (tr) h = h.replace('<h2>Trip details</h2>', '<h2>Trip details</h2>' + FD.work.tagBlock(tr)); }
    return h;
  };

  /* ---------- Salik on work drives ---------- */
  function salikAll() { return FD.logs.salik(); }
  function tripAt(t) { return trips().filter(function (tr) { return t >= tr.start - 180000 && t <= (tr.end || tr.start) + 180000; })[0] || null; }
  function salikState(c) {
    var tr = tripAt(c.t);
    if (c.claim === true) return { on: true, tr: tr, why: tr ? (tr.type === 'work' ? 'Work' : 'Added by you') : 'Added by you' };
    if (c.claim === false) return { on: false, tr: tr, why: 'Left off by you' };
    if (!tr) return { on: false, tr: null, why: 'No tracked drive' };
    if (tr.type === 'work') return { on: true, tr: tr, why: 'Work' };
    return { on: false, tr: tr, why: tr.type === 'personal' ? 'Personal' : 'Drive not tagged yet' };
  }
  function rawOf(c) {
    if (c.raw) return c.raw;
    var d = new Date(c.t), tot = r2(c.amount), amt = r2(tot / 1.05);
    return { txid: '', date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      post: '', gate: c.gate, dir: '', tag: '', plate: c.plate || '', amt: amt, vat: r2(tot - amt), total: tot };
  }

  /* ---------- everything on the claim for a period ---------- */
  function claimFor(P) {
    var all = trips(), inP = function (ms) { return ms >= P.start && ms <= P.end; };
    var drives = all.filter(function (t) { return t.type === 'work' && inP(t.start); }).sort(function (a, b) { return a.start - b.start; });
    var km = drives.reduce(function (s, t) { return s + kmOf(t); }, 0), rate = +C.rate || 0;
    var sal = salikAll().filter(function (c) { return inP(c.t); }).sort(function (a, b) { return b.t - a.t; });
    var salOn = sal.filter(function (c) { return salikState(c).on; });
    var sNet = 0, sVat = 0;
    salOn.forEach(function (c) { var r = rawOf(c); sNet += +r.amt || 0; sVat += +r.vat || 0; });
    var parking = [];
    drives.forEach(function (t) { (t.parking || []).forEach(function (p) { parking.push({ tr: t, p: p, date: p.paidAt || p.time || t.end || t.start }); }); });
    var oth = other.filter(function (o) { return inP(o.date); }).sort(function (a, b) { return a.date - b.date; });
    oth.filter(function (o) { return o.kind === 'parking'; }).forEach(function (o) { parking.push({ tr: null, p: { id: o.id, amount: o.amount, vat: o.vat, location: o.details, receiptId: o.receiptId }, date: o.date, other: o }); });
    var othRest = oth.filter(function (o) { return o.kind !== 'parking'; });
    var pTot = parking.reduce(function (s, x) { return s + (+x.p.amount || 0); }, 0);
    var oTot = othRest.reduce(function (s, o) { return s + (+o.amount || 0); }, 0);
    var fuel = r2(km * rate), adv = +(C.advance || {})[P.key] || 0;
    return {
      P: P, drives: drives, km: km, rate: rate, fuel: fuel, salik: sal, salikOn: salOn, salikNet: r2(sNet), salikVat: r2(sVat), salikTot: r2(sNet + sVat),
      parking: parking, parkingTot: r2(pTot), other: othRest, otherTot: r2(oTot), advance: adv,
      total: r2(fuel + sNet + sVat + pTot + oTot - adv),
      noSlip: parking.filter(function (x) { return !x.p.receiptId; }).length,
      untagged: all.filter(function (t) { return !t.type && inP(t.start); }).length,
      noOdo: drives.filter(function (t) { return t.odoStart == null; }).length
    };
  }
  FD.work.claimFor = claimFor; FD.work.periodOf = periodOf;

  /* ---------- the Work expenses screen ---------- */
  function line(icon, color, title, sub, amt, extra) {
    return '<div class="wline">' + ic(icon, 22, color) + '<div class="grow"><b>' + title + '</b><div class="s12 mute">' + sub + '</div></div>' + (extra || '') + '<span class="wamt">' + amt + '</span></div>';
  }
  function driveRow(t) {
    var k = kmOf(t), chips = '', ss = FD.logs.salikOf(t);
    if ((t.parking || []).length) chips += '<span class="lchip">' + ic('parking', 14) + 'Parking AED ' + fmt((t.parking || []).reduce(function (s, p) { return s + (+p.amount || 0); }, 0), 2) + '</span>';
    if (ss.length) chips += '<span class="lchip">' + ic('gate', 14) + 'Salik ×' + ss.length + '</span>';
    if (!t.notes) chips += '<span class="lchip warn">Add description</span>';
    return '<button type="button" class="lrow" data-a="logopen" data-id="' + t.id + '"><div class="sb"><b>' + day(t.start) + ' · ' + esc(fromOf(t)) + ' → ' + esc(toOf(t)) + '</b><span class="lamt">AED ' + fmt(k * (+C.rate || 0), 2) + '</span></div>' +
      (t.notes ? '<div class="s13" style="color:var(--soft)">' + esc(t.notes) + '</div>' : '') +
      '<div class="s12 mute">' + (t.odoStart != null ? 'Odometer ' + fmt(t.odoStart) + ' → ' + fmt(t.odoEnd) + ' · ' : '') + k + ' km</div>' +
      (chips ? '<div class="row" style="flex-wrap:wrap;gap:6px">' + chips + '</div>' : '') + '</button>';
  }
  function salikRow(c) {
    var s = salikState(c), r = rawOf(c);
    return '<button type="button" class="lrow' + (s.on ? '' : ' dim') + '" data-a="wsalik" data-t="' + c.t + '|' + esc(c.gate) + '"><div class="sb"><b>' + day(c.t) + ' · ' + hm(c.t) + ' · ' + esc(c.gate) + '</b><span class="lamt">AED ' + fmt(r.total, 2) + '</span></div>' +
      '<div class="row" style="gap:6px;flex-wrap:wrap"><span class="lchip' + (s.on ? ' work' : '') + '">' + (s.on ? 'On the claim · ' : 'Not claimed · ') + esc(s.why) + '</span>' +
      (s.tr ? '<span class="s12 mute">' + esc(fromOf(s.tr)) + ' → ' + esc(toOf(s.tr)) + '</span>' : '') + '</div></button>';
  }
  function parkRow(x) {
    var p = x.p;
    return '<button type="button" class="lrow" data-a="' + (x.tr ? 'logopen' : 'wotheropen') + '" data-id="' + (x.tr ? x.tr.id : x.other.id) + '"><div class="sb"><b>' + dmy(x.date) + ' · ' + hm(x.date) + ' · ' + esc(p.location || 'Parking') + '</b><span class="lamt">AED ' + fmt(p.amount, 2) + '</span></div>' +
      '<div class="row" style="gap:6px">' + (p.receiptId ? '<span class="lchip work">' + ic('camera', 14) + 'Slip attached</span>' : '<span class="lchip warn">Slip photo missing</span>') +
      (p.vat ? '<span class="s12 mute">incl. VAT ' + fmt(p.vat, 2) + '</span>' : '') + '</div></button>';
  }
  function otherRow(o) {
    return '<button type="button" class="lrow" data-a="wotheropen" data-id="' + o.id + '"><div class="sb"><b>' + dmy(o.date) + ' · ' + esc(o.details) + '</b><span class="lamt">AED ' + fmt(o.amount, 2) + '</span></div>' +
      '<div class="row" style="gap:6px">' + (o.receiptId ? '<span class="lchip work">Receipt attached</span>' : '<span class="lchip">No receipt</span>') + (o.vat ? '<span class="s12 mute">incl. VAT ' + fmt(o.vat, 2) + '</span>' : '') + '</div></button>';
  }

  FD.work.screen = function (L) {
    var P = periodOf(S.workAt), c = claimFor(P), sub = (C.submitted || {})[P.key];
    var head = '<div class="fhd"><button type="button" class="backbtn" data-a="back" aria-label="Back">' + ic('back', 20, 'currentColor', 2.4) + '</button><h1>Work expenses</h1>' +
      '<button type="button" class="sq greybtn" data-a="wset" aria-label="Claim details">' + ic('cog', 20) + '</button></div>';
    var bar = '<div class="sb"><button type="button" class="sq greybtn" data-a="wper" data-d="-1" aria-label="Previous period">' + ic('back', 20) + '</button>' +
      '<div style="text-align:center"><b style="font:700 19px var(--display)">' + P.label + '</b><div class="s12 mute">Claim period</div></div>' +
      '<button type="button" class="sq greybtn" data-a="wper" data-d="1" aria-label="Next period">' + ic('chev', 20) + '</button></div>';
    var hero = '<div class="hero" style="padding:12px 16px"><div><div class="lab" style="color:var(--ink)">To reimburse</div><b style="font-size:44px">AED ' + fmt(c.total, 2) + '</b></div>' +
      '<div class="meta"><span>' + (sub ? 'Submitted ' + dmy(sub) : 'Not submitted') + '</span><span>' + c.drives.length + ' work drive' + (c.drives.length === 1 ? '' : 's') + '</span><span>' + fmt(c.km) + ' km</span></div></div>';
    var warns = [];
    if (!C.name) warns.push('<button type="button" class="setup" data-a="wset">' + ic('cog', 18) + '<span class="grow" style="text-align:left">Add your name, email, vehicle and rate per km for the claim form</span></button>');
    if (c.untagged) warns.push('<button type="button" class="setup" data-a="wuntagged">' + ic('list', 18) + '<span class="grow" style="text-align:left">' + c.untagged + ' drive' + (c.untagged > 1 ? 's' : '') + ' in this period not marked Work or Personal</span>' + ic('chev', 16) + '</button>');
    if (c.noSlip) warns.push('<div class="setup warnb">' + ic('camera', 18) + '<span class="grow">' + c.noSlip + ' parking without a slip photo. Add it, or the claim may be refused.</span></div>');
    var lines = '<div class="wbox">' +
      line('brief', '#F5A524', 'Fuel (work drives)', fmt(c.km) + ' km × AED ' + fmt(c.rate, 2) + ' per km', fmt(c.fuel, 2)) +
      line('gate', '#34C3B5', 'Salik', c.salikOn.length + ' crossing' + (c.salikOn.length === 1 ? '' : 's') + ' on work drives · ' + fmt(c.salikNet, 2) + ' + VAT ' + fmt(c.salikVat, 2), fmt(c.salikTot, 2)) +
      line('parking', '#6EA8FE', 'Parking', c.parking.length + ' slip' + (c.parking.length === 1 ? '' : 's'), fmt(c.parkingTot, 2)) +
      line('receipt', '#9AA6B4', 'Other expenses', c.other.length ? c.other.length + ' item' + (c.other.length === 1 ? '' : 's') : 'Subscriptions, tools…', fmt(c.otherTot, 2), '<button type="button" class="btn" style="height:34px" data-a="wotheradd">+ Add</button>') +
      '<div class="wline"><div class="grow"><b>Advance received</b></div><input class="inp" style="width:110px;height:38px;text-align:right" type="number" inputmode="decimal" data-wadv="' + P.key + '" value="' + (c.advance || '') + '" placeholder="0.00" aria-label="Advance received"></div></div>';
    var actions = '<div class="row"><button type="button" class="btn amber" style="flex:1" data-a="wexport">' + ic('download', 18) + 'Export claim (Excel)</button>' +
      '<button type="button" class="btn" data-a="wsubmit">' + (sub ? 'Unmark' : 'Mark submitted') + '</button></div>';
    var tabs = '<div class="chips">' + [['drives', 'Work drives · ' + c.drives.length], ['salik', 'Salik · ' + c.salikOn.length + '/' + c.salik.length], ['parking', 'Parking · ' + c.parking.length], ['other', 'Other · ' + c.other.length]]
      .map(function (t) { return '<button type="button" class="chip" data-a="wtab" data-t="' + t[0] + '" aria-pressed="' + (S.workTab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>';
    var list;
    if (S.workTab === 'salik') {
      list = '<div class="row" style="flex-wrap:wrap"><label class="btn amber" for="salikFile2">' + ic('upload', 18) + 'Import Salik statement</label>' +
        '<input id="salikFile2" type="file" accept=".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-salik hidden></div>' +
        '<p class="s12 mute" style="margin:0">Import the whole Excel from the Salik website. Only crossings made on work drives go on the claim. Tap a crossing to add or leave it off by hand.</p>' +
        (c.salik.length ? c.salik.map(salikRow).join('') : '<div class="empty">No Salik crossings in this period yet. Import your Salik statement.</div>');
    } else if (S.workTab === 'parking') {
      list = (c.parking.length ? c.parking.map(parkRow).join('') : '<div class="empty">No parking on work drives yet. Add a slip from a work drive (open it and tap Add parking), or add one here.</div>') +
        '<button type="button" class="btn dashb" data-a="wotheradd" data-k="parking">+ Add a parking slip</button>';
    } else if (S.workTab === 'other') {
      list = (c.other.length ? c.other.map(otherRow).join('') : '<div class="empty">Nothing else this period. Add subscriptions or other work purchases with their receipts.</div>') +
        '<button type="button" class="btn dashb" data-a="wotheradd">+ Add an expense</button>';
    } else {
      list = (c.drives.length ? c.drives.slice().reverse().map(driveRow).join('') : '<div class="empty">No work drives in this period. After each drive, choose Work or Personal, or tag older drives from the trip log.</div>') +
        '<button type="button" class="btn dashb" data-a="wadd">+ Add a work drive you did not track</button>';
    }
    var left = bar + hero + warns.join('') + lines + actions;
    var right = tabs + '<div class="hist">' + list + '</div>';
    if (L === 'i') return '<div class="fu i lg">' + head + '<div class="cols wcols"><div class="colL">' + left + '</div><div class="colR">' + right + '</div></div></div>';
    return '<div class="fu c lg">' + head + '<div class="fbody">' + left + right + '</div></div>';
  };

  /* ---------- modals: claim details, add drive, other expense, export ---------- */
  function toggle(label, sub, act, on, k) {
    return '<div class="toggle"><span class="grow">' + label + (sub ? '<span class="s12 mute" style="display:block">' + sub + '</span>' : '') + '</span><button type="button" data-a="' + act + '"' + (k ? ' data-k="' + k + '"' : '') + ' aria-pressed="' + !!on + '" aria-label="' + esc(label) + '"></button></div>';
  }
  FD.work.modal = function () {
    var s = FD.status || {};
    if (S.modal === 'wset') {
      var f = function (id, label, key, type, ph) {
        return '<label for="ws-' + id + '">' + label + '<input id="ws-' + id + '" type="' + (type || 'text') + '"' + (type === 'number' ? ' inputmode="decimal" step="any"' : '') + ' data-wset="' + key + '" value="' + esc(key === 'odo' ? '' : (C[key] == null ? '' : C[key])) + '" placeholder="' + esc(ph || '') + '"></label>';
      };
      return '<div class="modal"><div class="mbox" role="dialog" aria-label="Claim details"><h2>Claim details</h2>' +
        '<p class="s13 mute" style="margin:0">Printed on the expenses form and the kilometre log.</p>' +
        '<div class="fields">' + f('name', 'Employee name', 'name').replace('<label', '<label style="grid-column:1/3"') + f('email', 'Mail id', 'email', 'email').replace('<label', '<label style="grid-column:1/3"') +
        f('emp', 'Employee ID', 'empId') + f('veh', 'Vehicle', 'vehicle', 'text', 'e.g. BB 94415') + f('rate', 'Rate per km (AED)', 'rate', 'number') + f('auth', 'Authorized by', 'authorizedBy', 'text', 'Line manager') +
        f('odo', 'Odometer now (km)', 'odo', 'number', st.odoRef ? 'Last: ' + fmt(st.odoRef.odo) : 'e.g. 54000') + '</div>' +
        (FD.native ? toggle('Ask Work or Personal after every trip', 'On the trip summary and as a notification', 'wpref', s.askTag !== false, 'askTag') +
          toggle('Auto-track when Android Auto connects', 'Ends when the phone disconnects from Android Auto', 'wpref', s.autotrack !== false, 'autotrack') +
          (s.autotrack !== false && !s.bglocation ? '<button type="button" class="btn amber" data-a="perm" data-p="bglocation">Allow location "All the time" (needed for auto-tracking)</button>' : '') +
          toggle('Remind me after 24 h if a drive is unmarked', 'Repeats daily until you tag it', 'wpref', s.remind !== false, 'remind') : '') +
        toggle('Suggest Work from calendar meetings', 'Uses the meeting title as the description', 'wcal', C.suggestCal) +
        '<div class="row"><button type="button" class="btn amber" style="flex:1" data-a="wsetsave">Save</button><button type="button" class="btn" data-a="close">Cancel</button></div></div></div>';
    }
    if (S.modal === 'wadd') {
      var a = S.wadd || {};
      var g = function (id, label, key, type) { return '<label for="wa-' + id + '">' + label + '<input id="wa-' + id + '" type="' + (type || 'text') + '"' + (type === 'number' ? ' inputmode="numeric"' : '') + ' data-wadd="' + key + '" value="' + esc(a[key] || '') + '"></label>'; };
      return '<div class="modal"><div class="mbox" role="dialog" aria-label="Add a work drive"><h2>Add a work drive</h2><div class="fields">' +
        g('date', 'Date', 'date', 'date') + g('notes', 'Description / notes', 'notes') + g('from', 'Starting location', 'from') + g('to', 'Destination', 'to') +
        g('o1', 'Odometer start', 'o1', 'number') + g('o2', 'Odometer end', 'o2', 'number') + '</div>' +
        '<p class="s12 mute" style="margin:0">Or leave the odometer empty and enter the km driven:</p><div class="fields">' + g('km', 'Km driven', 'km', 'number') + '</div>' +
        '<div class="row"><button type="button" class="btn amber" style="flex:1" data-a="waddsave">Save work drive</button><button type="button" class="btn" data-a="close">Cancel</button></div></div></div>';
    }
    if (S.modal === 'wother') {
      var o = S.wother || {};
      var h2 = function (id, label, key, type) { return '<label for="wo-' + id + '">' + label + '<input id="wo-' + id + '" type="' + (type || 'text') + '"' + (type === 'number' ? ' inputmode="decimal" step="any"' : '') + ' data-wother="' + key + '" value="' + esc(o[key] == null ? '' : o[key]) + '"></label>'; };
      var park = o.kind === 'parking';
      return '<div class="modal"><div class="mbox" role="dialog" aria-label="Expense"><h2>' + (park ? 'Parking slip' : 'Other expense') + '</h2>' +
        '<div class="row" style="flex-wrap:wrap"><label class="btn amber" for="wo-photo">' + ic('camera', 18) + (o.receiptId ? 'Retake photo' : (park ? 'Scan the slip' : 'Add receipt photo')) + '</label>' +
        '<input id="wo-photo" type="file" accept="image/*" capture="environment" data-wophoto hidden>' + (o.thumb ? '<img src="' + o.thumb + '" alt="Receipt" style="height:56px;border-radius:8px">' : '') +
        (S.ocrBusy ? '<span class="s12" style="color:var(--teal)">Reading the slip…</span>' : '') + '</div>' +
        '<div class="fields">' + h2('date', park ? 'Date and time paid' : 'Date', 'date', park ? 'datetime-local' : 'date') + h2('details', park ? 'Location' : 'Expense details', 'details') +
        h2('amount', 'Total paid (AED)', 'amount', 'number') + h2('vat', 'VAT (if on the receipt)', 'vat', 'number') + '</div>' +
        (park ? '<p class="s12 mute" style="margin:0">The slip photo is needed for the claim. Date, time and amount are read from it: check them.</p>' : '') +
        '<div class="row"><button type="button" class="btn amber" style="flex:1" data-a="wothersave">Save</button>' + (o.id ? '<button type="button" class="btn" data-a="wotherdel">' + ic('trash', 18) + '</button>' : '') + '<button type="button" class="btn" data-a="close">Cancel</button></div></div></div>';
    }
    if (S.modal === 'wexport') {
      var P = periodOf(S.workAt), c = claimFor(P), opt = S.wexp || 'full';
      var r = function (k, t, sub) { return '<button type="button" class="mrow" data-a="wexpopt" data-k="' + k + '" aria-pressed="' + (opt === k) + '"><span class="radio"></span><span>' + t + '<small>' + sub + '</small></span></button>'; };
      return '<div class="modal"><div class="mbox" role="dialog" aria-label="Export claim"><h2>Export · ' + P.label + '</h2>' +
        r('full', 'Full claim workbook', 'Expenses form + kilometre log + Salik (work only) + parking slips · AED ' + fmt(c.total, 2)) +
        r('km', 'Kilometre log only', c.drives.length + ' work drives · ' + fmt(c.km) + ' km · AED ' + fmt(c.fuel, 2)) +
        r('salik', 'Salik only (Salik layout)', c.salikOn.length + ' work crossings · AED ' + fmt(c.salikTot, 2)) +
        r('slips', 'Parking slips only', c.parking.length + ' slip photos') +
        (c.noSlip ? '<div class="s12" style="color:var(--amber)">' + c.noSlip + ' parking without a slip photo.</div>' : '') +
        (c.noOdo ? '<div class="s12" style="color:var(--amber)">' + c.noOdo + ' work drive(s) have no odometer reading; their km are used instead.</div>' : '') +
        '<div class="row"><button type="button" class="btn amber" style="flex:1" data-a="wexpgo" data-how="save">' + ic('download', 18) + 'Save to Downloads</button>' +
        (A && A.shareBase64 ? '<button type="button" class="btn" style="flex:1" data-a="wexpgo" data-how="share">' + ic('share', 18) + 'Share</button>' : '') + '</div>' +
        '<button type="button" class="btn" data-a="close">Close</button></div></div>';
    }
    return '';
  };

  /* ---------- export ---------- */
  function loadScript(src, test) {
    if (test()) return Promise.resolve();
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = function () { res(); }; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); });
  }
  function imgSize(url) {
    return new Promise(function (res) { var im = new Image(); im.onload = function () { res({ w: im.naturalWidth, h: im.naturalHeight }); }; im.onerror = function () { res({ w: 800, h: 1000 }); }; im.src = url; });
  }
  function buildData(c, sheets) {
    var P = c.P, now = Date.now(), lineDate = Math.min(P.end, now);
    var summary = [];
    if (c.drives.length) summary.push({ date: lineDate, details: 'Fuel', net: c.fuel, remarks: fmt(c.km) + ' km × ' + fmt(c.rate, 2) + ' (KilometreLog)' });
    if (c.salikOn.length) summary.push({ date: lineDate, details: 'Salik', net: c.salikNet, vat: c.salikVat, remarks: c.salikOn.length + ' work trips (ViewTrips)' });
    c.parking.slice().sort(function (a, b) { return a.date - b.date; }).forEach(function (x) {
      var vat = +x.p.vat || 0, amt = +x.p.amount || 0;
      summary.push({ date: x.date, details: 'Parking' + (x.p.location ? ' - ' + shortAddr(x.p.location) : ''), net: vat ? r2(amt - vat) : amt, vat: vat || null, remarks: x.p.receiptId ? 'Slip attached' : '' });
    });
    c.other.forEach(function (o) { var vat = +o.vat || 0; summary.push({ date: o.date, details: o.details, net: vat ? r2(o.amount - vat) : +o.amount, vat: vat || null, remarks: o.receiptId ? 'Receipt attached' : '' }); });
    var meta = load('fd-salik-meta', {});
    var d = {
      person: { name: C.name, email: C.email, empId: C.empId, vehicle: C.vehicle, authorizedBy: C.authorizedBy }, rate: c.rate, date: now,
      purpose: 'Fuel, Salik, & Parking', summary: summary, advance: c.advance, sheets: sheets,
      drives: c.drives.map(function (t) {
        var o1 = t.odoStart, o2 = t.odoEnd;
        if (o1 == null || o2 == null) { o1 = 0; o2 = Math.round(t.km); }
        return { date: t.start, from: fromOf(t), to: toOf(t), notes: t.notes || '', odoStart: o1, odoEnd: o2 };
      }),
      salik: { account: meta.account || '', period: meta.period || ('Trip(s) From ' + dmy(P.start) + ' To ' + dmy(P.end)), type: meta.type || '',
        rows: c.salikOn.slice().sort(function (a, b) { return b.t - a.t; }).map(rawOf) },
      slips: []
    };
    var withSlip = sheets.indexOf('slips') >= 0 ? c.parking.filter(function (x) { return x.p.receiptId; }).concat(c.other.filter(function (o) { return o.receiptId; }).map(function (o) { return { p: { receiptId: o.receiptId, amount: o.amount, location: o.details }, date: o.date }; })) : [];
    return Promise.all(withSlip.map(function (x) {
      return FD.logs.db.get(x.p.receiptId).then(function (url) {
        if (!url) return null;
        return imgSize(url).then(function (sz) { return { title: dmy(x.date) + ' ' + hm(x.date) + ' · ' + (x.p.location || 'Parking') + ' · AED ' + fmt(x.p.amount, 2), base64: url.split(',')[1], w: sz.w, h: sz.h }; });
      });
    })).then(function (list) { d.slips = list.filter(Boolean); return d; });
  }
  function exportClaim(how) {
    var P = periodOf(S.workAt), c = claimFor(P), opt = S.wexp || 'full';
    var sheets = { full: ['summary', 'km', 'salik', 'slips'], km: ['km'], salik: ['salik'], slips: ['slips'] }[opt];
    var who = (C.name || 'Claim').trim().replace(/\s+/g, '_');
    var name = { full: 'Expense_Claim_' + who + '_' + P.mon, km: 'Kilometre_Log_' + who + '_' + P.mon, salik: 'Salik_Work_Trips_' + P.mon, slips: 'Parking_Slips_' + P.mon }[opt] + '.xlsx';
    var mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    FD.toast('Preparing ' + name + '…');
    Promise.all([loadScript('vendor/jszip.min.js', function () { return !!window.JSZip; }),
      fetch('templates/claim.xlsx').then(function (r) { if (!r.ok) throw new Error('Template missing'); return r.arrayBuffer(); })])
      .then(function (x) { return buildData(c, sheets).then(function (d) { return window.FDClaim.build(window.JSZip, x[1], d); }); })
      .then(function (b64) {
        if (A && how === 'share' && A.shareBase64) { A.shareBase64(name, b64, mime); return; }
        if (A && A.saveBase64) { FD.toast(A.saveBase64(name, b64, mime) ? 'Saved to Downloads · ' + name : 'Could not save the file'); return; }
        var bin = atob(b64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([u], { type: mime })); a.download = name;
        document.body.appendChild(a); a.click(); a.remove(); FD.toast('Saved · ' + name);
      }).catch(function (e) { FD.toast('Export failed: ' + (e.message || e)); });
  }

  /* ---------- reading a slip photo ---------- */
  FD.work.parseSlip = function (lines) {
    lines = (lines || []).map(function (l) { return { t: String(l.t || ''), cy: ((+l.y || 0) + (+l.b || 0)) / 2, h: Math.max(8, (+l.b || 0) - (+l.y || 0)), x: +l.x || 0 }; });
    // join each label with the value printed on the same row
    var rows = [];
    lines.slice().sort(function (a, b) { return a.cy - b.cy; }).forEach(function (l) {
      var r = rows.filter(function (r) { return Math.abs(r.cy - l.cy) < Math.max(r.h, l.h) * 0.6; })[0];
      if (r) r.parts.push(l); else rows.push({ cy: l.cy, h: l.h, parts: [l] });
    });
    var texts = rows.map(function (r) { return r.parts.sort(function (a, b) { return a.x - b.x; }).map(function (p) { return p.t; }).join(' '); });
    var all = texts.join('\n');
    var money = /(\d{1,4}[.,]\d{2})(?!\d)/;
    function noDates(t) { return t.replace(/\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{2,4}/g, ' ').replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' '); }
    function pick(re) { for (var i = 0; i < texts.length; i++) if (re.test(texts[i])) { var m = noDates(texts[i]).replace(re, ' ').match(money); if (m) return parseFloat(m[1].replace(',', '.')); } return null; }
    var total = pick(/\b(total|paid|amount\s*paid|amount|grand\s*total|fee)\b/i);
    var vat = pick(/\b(vat|tax)\b/i), net = pick(/\b(net|sub\s*total)\b/i);
    if (total == null) { var nums = (noDates(all).match(/\d{1,4}[.,]\d{2}(?=\s*(AED|DHS?))/gi) || []).map(function (v) { return parseFloat(v.replace(',', '.')); }); if (nums.length) total = Math.max.apply(null, nums); }
    if (vat != null && total != null && vat >= total) vat = null;
    if (vat == null && net != null && total != null && total > net) vat = r2(total - net);
    // date and time: prefer the "paid" / "out" line, else the last date on the slip
    var dates = [];
    texts.forEach(function (t) {
      var m = t.match(/(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})(?:\D+(\d{1,2}):(\d{2}))?/), mm;
      if (m) { var y = +m[3]; if (y < 100) y += 2000; dates.push({ d: new Date(y, +m[2] - 1, +m[1], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0).getTime(), paid: /paid|out|exit/i.test(t), time: !!m[4] }); }
      else if ((mm = t.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})(?:\D+(\d{1,2}):(\d{2}))?/))) {
        var mon = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(mm[2].toLowerCase()) / 3;
        if (mon >= 0) dates.push({ d: new Date(+mm[3], mon, +mm[1], mm[4] ? +mm[4] : 12, mm[5] ? +mm[5] : 0).getTime(), paid: /paid|out|exit/i.test(t), time: !!mm[4] });
      }
    });
    var now = Date.now();
    dates = dates.filter(function (x) { return x.d > now - 400 * 86400000 && x.d < now + 86400000; });
    var dt = dates.filter(function (x) { return x.paid && x.time; })[0] || dates.filter(function (x) { return x.time; }).pop() || dates.pop() || null;
    var place = texts.slice(0, 3).filter(function (t) { return /[A-Za-z]{4,}/.test(t) && !/receipt|trn|tax|invoice/i.test(t); })[0] || '';
    return { total: total, vat: vat, when: dt ? dt.d : null, place: place.trim(), text: all };
  };
  function toLocalInput(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  FD.work.toLocalInput = toLocalInput;
  /* results come back from the phone's text reader */
  FD.onOcr = function (res) {
    S.ocrBusy = false;
    var target = res && String(res.id || '').indexOf('wo:') === 0 ? (S.wother = S.wother || {}) : (S.park = S.park || {});
    if (!res || res.error || !res.lines || !res.lines.length) { FD.toast('Could not read the slip. Enter the amount and date.'); X.render(); return; }
    var p = FD.work.parseSlip(res.lines), got = [];
    var isOther = target === S.wother;
    if (p.total != null && !target.amount) { target.amount = p.total.toFixed(2); got.push('AED ' + p.total.toFixed(2)); }
    if (p.vat != null && !target.vat) { target.vat = p.vat.toFixed(2); got.push('VAT ' + p.vat.toFixed(2)); }
    if (p.when) { if (isOther) target.date = toLocalInput(p.when); else target.paidAt = toLocalInput(p.when); got.push(dmy(p.when) + ' ' + hm(p.when)); }
    if (isOther && p.place && !target.details) target.details = p.place;
    X.render();
    FD.toast(got.length ? 'Read from the slip: ' + got.join(' · ') + '. Please check.' : 'Could not find the amount on the slip. Enter it.');
  };
  FD.work.ocr = function (id, url) { if (A && A.ocr) { S.ocrBusy = true; A.ocr(id, url); } };

  /* ---------- background drives from the phone (Android Auto) ---------- */
  FD.work.sync = function () {
    if (!A || !A.pendingTrips) return;
    var pend = J(A.pendingTrips()) || [], tags = J(A.tagUpdates()) || {}, added = [], ackT = [];
    var F = FD.calcFuel();
    pend.forEach(function (p) {
      var id = Number(p.id) || p.start;
      if (!findTrip(id)) {
        var km = +p.km || 0, min = Math.max(0, (p.end - p.start) / 60000);
        var rec = { id: id, start: p.start, end: p.end, km: km, min: min, avg: min > 0.5 ? km / (min / 60) : 0, top: p.top || 0, dest: p.dest && p.dest.name ? p.dest : null,
          litres: F.est ? km / F.est : 0, cost: F.est ? km / F.est * F.price : 0, auto: !!p.auto, kmL: F.avg || null, price: F.price,
          startPos: p.startLat != null ? { lat: p.startLat, lng: p.startLng } : null, endPos: p.endLat != null ? { lat: p.endLat, lng: p.endLng } : null };
        try { if (rec.startPos) rec.startAddr = A.revgeo(rec.startPos.lat, rec.startPos.lng) || ''; if (rec.endPos) rec.endAddr = A.revgeo(rec.endPos.lat, rec.endPos.lng) || ''; } catch (e) { }
        trips().push(rec); added.push(rec);
        if (p.type) setType(rec, p.type);
        if (rec.odoStart == null) { var o = odoFor(rec); if (o != null) { rec.odoStart = o; rec.odoEnd = o + Math.round(km); } }
      }
    });
    Object.keys(tags).forEach(function (id) { var tr = findTrip(id); if (tr) { if (tr.type !== tags[id]) setType(tr, tags[id]); ackT.push(id); } });
    if (added.length) {
      X.setTrips(trips().sort(function (a, b) { return b.start - a.start; }));
      added.forEach(function (r) { if (st.odoRef && r.odoEnd != null && r.end > st.odoRef.at) { st.odoRef = { odo: r.odoEnd, at: r.end }; } });
      saveSettings();
    }
    if (pend.length) A.ackTrips(JSON.stringify(pend.map(function (p) { return String(p.id); })));
    if (ackT.length) A.ackTags(JSON.stringify(ackT));
    if (added.length || ackT.length) X.softRender();
    return added;
  };
  /* the phone ended the drive (Android Auto disconnected) while this screen is open */
  FD.work.nativeEnded = function () {
    if (FD.nav.trip && FD.nav.abandon) FD.nav.abandon();
    var added = FD.work.sync() || [];
    if (S.screen === 'nav') S.screen = 'home';
    if (added.length && document.visibilityState === 'visible' && !S.modal) { var r = added[added.length - 1]; S.summary = r; S.modal = 'summary'; S.parkDone = null; S.park = {}; }
    X.render();
  };
  FD.work.checkOpen = function () {
    if (!A || !A.takeOpen) return;
    var id = A.takeOpen(); if (!id) return;
    FD.work.sync();
    if (findTrip(id)) { S.logTrip = String(id); S.modal = 'logtrip'; S.addPark = false; S.park = {}; X.render(); }
  };
  var prevResume = FD.onResume;
  FD.onResume = function () { FD.work.sync(); if (prevResume) prevResume(); FD.work.checkOpen(); };

  /* ---------- home screen pieces ---------- */
  FD.work.homeRow = function () {
    var c = claimFor(periodOf(Date.now()));
    return '<button type="button" class="fuelrow" data-a="screen" data-s="work">' + ic('brief', 22, '#F5A524') + '<b>Work expenses</b><span>AED ' + fmt(c.total) + ' to claim</span>' + ic('chev', 16, '#9AA6B4', 2.4) + '</button>';
  };
  FD.work.banner = function () {
    var since = Date.now() - 45 * 86400000;
    var n = trips().filter(function (t) { return !t.type && t.start > since; }).length;
    if (!n || (FD.status && FD.status.askTag === false)) return '';
    return '<button type="button" class="setup" data-a="wuntagged">' + ic('brief', 18) + '<span class="grow" style="text-align:left">' + n + ' drive' + (n > 1 ? 's' : '') + ' to mark Work or Personal</span>' + ic('chev', 16) + '</button>';
  };

  /* ---------- events ---------- */
  FD.work.click = function (a, el) {
    var id = el.getAttribute('data-id');
    switch (a) {
      case 'wtag': {
        var tr = findTrip(id); if (!tr) return true;
        setType(tr, el.getAttribute('data-t'));
        if (S.summary && String(S.summary.id) === String(id)) S.summary = tr;
        X.render(); FD.toast(tr.type === 'work' ? 'Marked as a work drive' : 'Marked as personal'); return true;
      }
      case 'wper': {
        var P = periodOf(S.workAt), d = +el.getAttribute('data-d');
        S.workAt = d < 0 ? P.start - 86400000 : P.end + 86400000; X.render(); return true;
      }
      case 'wtab': S.workTab = el.getAttribute('data-t'); X.render(); return true;
      case 'wset': S.modal = 'wset'; S.wset = {}; X.render(); return true;
      case 'wsetsave': {
        var w = S.wset || {};
        Object.keys(w).forEach(function (k) { if (k === 'odo') { var o = parseFloat(w.odo); if (o > 0) FD.work.setOdo(o); } else if (k === 'rate') { var r = parseFloat(w.rate); if (r >= 0) C.rate = r; } else C[k] = w[k].trim(); });
        saveSettings(); S.modal = null; X.render(); FD.toast('Claim details saved'); return true;
      }
      case 'wpref': {
        var k = el.getAttribute('data-k'), on = el.getAttribute('aria-pressed') === 'true';
        if (A) { A.setPref(k, on ? '0' : '1'); FD.refreshNative(); }
        if (k === 'autotrack' && !on && FD.status && !FD.status.bglocation) A.request('bglocation');
        X.render(); return true;
      }
      case 'wcal': C.suggestCal = !C.suggestCal; saveSettings(); X.render(); return true;
      case 'wsubmit': {
        var key = periodOf(S.workAt).key; C.submitted = C.submitted || {};
        if (C.submitted[key]) delete C.submitted[key]; else C.submitted[key] = Date.now();
        saveSettings(); X.render(); return true;
      }
      case 'wuntagged': S.logFilter = 'untagged'; S.logMonth = null; FD.show('logs'); return true;
      case 'wsalik': {
        var key2 = el.getAttribute('data-t'), list = FD.logs.salik();
        var c = list.filter(function (x) { return x.t + '|' + x.gate === key2 || x.t + '|' + esc(x.gate) === key2; })[0];
        if (!c) return true;
        var on2 = salikState(c).on;
        var auto = (function () { var tr = tripAt(c.t); return !!(tr && tr.type === 'work'); })();
        c.claim = on2 ? (auto ? false : undefined) : (auto ? undefined : true);
        FD.logs.saveSalik(); X.render(); FD.toast(salikState(c).on ? 'Added to the claim' : 'Left off the claim'); return true;
      }
      case 'wadd': S.modal = 'wadd'; S.wadd = { date: new Date().toISOString().slice(0, 10) }; X.render(); return true;
      case 'waddsave': {
        var f = S.wadd || {}, o1 = parseFloat(f.o1), o2 = parseFloat(f.o2), km = parseFloat(f.km);
        if (!f.date) { FD.toast('Enter the date.'); return true; }
        if (o1 > 0 && o2 > o1) km = o2 - o1; else { o1 = null; o2 = null; }
        if (!(km > 0)) { FD.toast('Enter the odometer start and end, or the km driven.'); return true; }
        var at = new Date(f.date + 'T12:00:00').getTime();
        var rec = { id: Date.now(), start: at, end: at, km: km, min: 0, avg: 0, top: 0, dest: null, manual: true, type: 'work', from: f.from || '', to: f.to || '', notes: f.notes || '', odoStart: o1, odoEnd: o2 };
        X.setTrips(trips().concat([rec]).sort(function (a, b) { return b.start - a.start; }));
        S.modal = null; S.workAt = at; X.render(); FD.toast('Work drive added'); return true;
      }
      case 'wotheradd': {
        var park = el.getAttribute('data-k') === 'parking';
        S.wother = { kind: park ? 'parking' : 'other', date: park ? toLocalInput(Date.now()) : new Date().toISOString().slice(0, 10) };
        S.modal = 'wother'; X.render(); return true;
      }
      case 'wotheropen': {
        var ob = other.filter(function (x) { return String(x.id) === String(id); })[0]; if (!ob) return true;
        S.wother = { id: ob.id, kind: ob.kind, date: ob.kind === 'parking' ? toLocalInput(ob.date) : new Date(ob.date).toISOString().slice(0, 10), details: ob.details, amount: ob.amount, vat: ob.vat || '', receiptId: ob.receiptId };
        if (ob.receiptId) FD.logs.db.get(ob.receiptId).then(function (u) { if (u && S.wother && S.wother.id === ob.id) { S.wother.thumb = u; X.render(); } });
        S.modal = 'wother'; X.render(); return true;
      }
      case 'wothersave': {
        var e = S.wother || {}, amt = parseFloat(e.amount), vat = parseFloat(e.vat);
        if (!e.date || !(amt > 0)) { FD.toast('Enter the date and the amount.'); return true; }
        if (e.kind === 'parking' && !e.receiptId) { FD.toast('Add the slip photo: it is needed for the claim.'); return true; }
        var ms = new Date(e.kind === 'parking' ? e.date : e.date + 'T12:00:00').getTime();
        var item = { id: e.id || Date.now(), kind: e.kind || 'other', date: ms, details: (e.details || (e.kind === 'parking' ? 'Parking' : 'Expense')).trim(), amount: r2(amt), vat: vat > 0 ? r2(vat) : null, receiptId: e.receiptId || null };
        other = other.filter(function (x) { return x.id !== item.id; }).concat([item]); saveOther();
        S.modal = null; X.render(); FD.toast('Saved'); return true;
      }
      case 'wotherdel': {
        var e2 = S.wother || {};
        if (el.getAttribute('data-confirm') !== '1') { el.setAttribute('data-confirm', '1'); el.textContent = 'Tap again'; return true; }
        if (e2.receiptId) FD.logs.db.del(e2.receiptId);
        other = other.filter(function (x) { return x.id !== e2.id; }); saveOther(); S.modal = null; X.render(); return true;
      }
      case 'wexport': S.modal = 'wexport'; X.render(); return true;
      case 'wexpopt': S.wexp = el.getAttribute('data-k'); X.render(); return true;
      case 'wexpgo': exportClaim(el.getAttribute('data-how')); return true;
    }
    return false;
  };
  FD.work.input = function (tg) {
    var k = tg.getAttribute && tg.getAttribute('data-wk');
    if (k) {
      var tr = findTrip(tg.getAttribute('data-id')); if (!tr) return true;
      if (k === 'odoStart' || k === 'odoEnd') {
        var v = parseFloat(tg.value); tr[k] = v > 0 ? v : null;
        if (k === 'odoStart' && v > 0 && (tr.odoEnd == null || tr.odoEnd < v)) tr.odoEnd = v + Math.round(tr.km);
        if (tr.odoStart != null && tr.odoEnd != null && st.odoRef == null) FD.work.setOdo(tr.odoEnd);
        var calc = document.querySelector('[data-wcalc="' + tr.id + '"]');
        if (calc) { var kk = kmOf(tr); calc.innerHTML = '<span>' + kk + ' km × AED ' + fmt(C.rate, 2) + '</span><b>AED ' + fmt(kk * C.rate, 2) + '</b>'; }
      } else tr[k] = tg.value;
      X.saveTrips(); return true;
    }
    var s = tg.getAttribute && tg.getAttribute('data-wset');
    if (s) { S.wset = S.wset || {}; S.wset[s] = tg.value; return true; }
    var ad = tg.getAttribute && tg.getAttribute('data-wadd');
    if (ad) { S.wadd = S.wadd || {}; S.wadd[ad] = tg.value; return true; }
    var wo = tg.getAttribute && tg.getAttribute('data-wother');
    if (wo) { S.wother = S.wother || {}; S.wother[wo] = tg.value; return true; }
    var adv = tg.getAttribute && tg.getAttribute('data-wadv');
    if (adv) { C.advance = C.advance || {}; C.advance[adv] = parseFloat(tg.value) || 0; saveSettings(); return true; }
    return false;
  };
  FD.work.change = function (tg) {
    if (tg.hasAttribute && tg.hasAttribute('data-wophoto') && tg.files && tg.files[0]) {
      FD.logs.db.shrink(tg.files[0]).then(function (url) {
        var id = 'r' + Date.now();
        return FD.logs.db.put(id, url).then(function () {
          S.wother = S.wother || {}; S.wother.receiptId = id; S.wother.thumb = url; X.render();
          FD.work.ocr('wo:' + id, url);
        });
      }).catch(function () { FD.toast('Could not read that photo.'); });
      tg.value = ''; return true;
    }
    if (tg.hasAttribute && tg.hasAttribute('data-wadv')) { X.render(); return true; }
    return false;
  };

  // pick up drives recorded while the app was closed
  setTimeout(function () { FD.work.sync(); FD.work.checkOpen(); }, 300);
})();
