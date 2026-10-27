/* Fold Drive: app shell, home, fuel tracker, settings. Navigation lives in nav.js. */
(function () {
  'use strict';
  var FD = window.FD = {};
  var VERSION = '1.0.0';

  /* ---------- helpers ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(n, d) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function isoDay(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayLabel(iso) { return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  function load(k, def) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (e) { return def; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Could not save on this phone. Storage may be full.'); } }
  FD.util = { fmt: fmt, esc: esc, pad: pad, hhmm: hhmm };

  /* ---------- icons ---------- */
  var P = {
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/>',
    wa: '<path d="M4 20l1.3-3.9A8 8 0 1112 20a8 8 0 01-4-1z"/>',
    wab: '<path d="M4 20l1.3-3.9A8 8 0 1112 20a8 8 0 01-4-1z"/><rect x="8.5" y="10" width="7" height="5" rx="1"/><path d="M10.5 10V9h3v1"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    nav: '<path d="M3 11l18-8-8 18-2-8-8-2z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
    home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
    office: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    fuel: '<path d="M4 21V5a2 2 0 012-2h6a2 2 0 012 2v16M3 21h12M4 10h10M14 8h2a2 2 0 012 2v6a1.5 1.5 0 003 0V9l-3-3"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    right: '<path d="M7 21V12a4 4 0 014-4h8M15 4l4 4-4 4"/>',
    left: '<path d="M17 21v-9a4 4 0 00-4-4H5M9 4L5 8l4 4"/>',
    up: '<path d="M12 21V4M6 10l6-6 6 6"/>',
    uturn: '<path d="M8 21V9a5 5 0 0110 0v3M14 9l4 4 4-4"/>',
    round: '<circle cx="12" cy="10" r="4"/><path d="M12 14v7M8.5 7.5L5 4"/>',
    flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
    target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 010 7"/>',
    mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
    wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 14.5V21M9.6 11.2L3.4 9.5M14.4 11.2l6.2-1.7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  function ic(n, s, c, w) {
    return '<svg width="' + (s || 22) + '" height="' + (s || 22) + '" viewBox="0 0 24 24" fill="none" stroke="' + (c || 'currentColor') + '" stroke-width="' + (w || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + P[n] + '</svg>';
  }
  FD.ic = ic;

  /* ---------- stored data ---------- */
  var DEFAULT_PRICES = {
    updated: '2026-10-01', month: 'October 2026',
    grades: { 'Super 98': 4.40, 'Special 95': 4.28, 'E-Plus 91': 4.21, 'Diesel': 4.80 },
    previous: { 'Super 98': 3.80, 'Special 95': 3.69, 'E-Plus 91': 3.61, 'Diesel': 4.30 }
  };
  var GRADES = ['Super 98', 'Special 95', 'E-Plus 91', 'Diesel'];
  var settings = Object.assign({
    apiKey: '', voice: true, grade: 'Special 95', auto: true, price: '',
    places: [
      { id: 'home', name: 'Home', icon: 'home' },
      { id: 'office', name: 'Office', icon: 'office' },
      { id: 'p3', name: 'Showroom', icon: 'pin' }
    ],
    contacts: [{ name: '', number: '' }, { name: '', number: '' }, { name: '', number: '' }, { name: '', number: '' }]
  }, load('fd-settings', {}));
  FD.settings = settings;
  var fuel = load('fd-fuel', { entries: [] });
  var prices = load('fd-prices', DEFAULT_PRICES);
  var trips = load('fd-trips', []);
  if (load('fd-price-seen', null) == null) save('fd-price-seen', prices.updated);

  function saveSettings() { save('fd-settings', settings); }
  function saveFuel() { save('fd-fuel', fuel); }

  /* ---------- UI state ---------- */
  var S = {
    screen: 'home', prev: 'home', layout: layoutNow(),
    showForm: false, form: { date: isoDay(), odo: '', litres: '', amount: '', rate: '' }, err: '', chatApp: null, traffic: {},
    search: { nav: { q: '', list: [], msg: '' }, pick: { q: '', list: [], msg: '' } },
    modal: null, picker: null, summary: null
  };
  function layoutNow() { return window.innerWidth >= 600 ? 'i' : 'c'; }

  /* ---------- apps ---------- */
  var LINKS = {
    wa: 'intent://send/#Intent;scheme=whatsapp;package=com.whatsapp;S.browser_fallback_url=https%3A%2F%2Fwww.whatsapp.com%2F;end',
    wab: 'intent://send/#Intent;scheme=whatsapp;package=com.whatsapp.w4b;S.browser_fallback_url=https%3A%2F%2Fwww.whatsapp.com%2Fbusiness%2F;end',
    cal: 'https://calendar.google.com/calendar/r'
  };
  function badge(n) { return n ? '<span class="badge">' + n + '</span>' : ''; }
  function shownEvents() {
    var hidden = settings.hiddenCals || [];
    return (FD.events || []).filter(function (e) { return hidden.indexOf(String(e.cal)) < 0; });
  }
  function nextEvent() {
    var now = Date.now();
    return shownEvents().filter(function (e) { return !e.allDay && e.begin > now - 15 * 60000; })[0] || null;
  }
  function appTiles(L) {
    var i = L === 'i';
    if (FD.native) {
      var c = FD.counts || {}, ev = nextEvent();
      var tile = function (app, act, icon, bg, fg, name, sub, n) {
        return '<button type="button" class="app" data-a="' + act + '" data-app="' + app + '"><span class="ico" style="background:' + bg + ';color:' + fg + '">' + ic(icon, i ? 24 : 20) + '</span>' + badge(n) + '<span><b>' + name + '</b><small>' + sub + '</small></span></button>';
      };
      return '<div class="apps">' +
        tile('', 'calls', 'phone', '#162338', '#6EA8FE', 'Calls', c.missed ? c.missed + ' missed' : (contactsSet() ? 'Quick dial' : 'Dialer'), c.missed) +
        tile('whatsapp', 'chats', 'wa', '#13291E', '#4ADE80', 'WhatsApp', c.whatsapp ? c.whatsapp + ' unread' : 'Open chats', c.whatsapp) +
        tile('business', 'chats', 'wab', '#10292A', '#34C3B5', i ? 'WA Business' : 'Business', c.business ? c.business + (i ? ' client chats' : ' unread') : (i ? 'Client chats' : 'Clients'), c.business) +
        tile('calendar', 'open', 'cal', '#2B2414', '#F5A524', 'Calendar', ev ? 'Next ' + hhmm(new Date(ev.begin)) : 'Today', 0) +
        '</div>';
    }
    return '<div class="apps">' +
      '<button type="button" class="app" data-a="calls"><span class="ico" style="background:#162338;color:#6EA8FE">' + ic('phone', i ? 24 : 20) + '</span><span><b>Calls</b><small>' + (contactsSet() ? 'Quick dial' : 'Dialer') + '</small></span></button>' +
      '<a class="app" href="' + LINKS.wa + '"><span class="ico" style="background:#13291E;color:#4ADE80">' + ic('wa', i ? 24 : 20) + '</span><span><b>WhatsApp</b><small>Open chats</small></span></a>' +
      '<a class="app" href="' + LINKS.wab + '"><span class="ico" style="background:#10292A;color:#34C3B5">' + ic('wab', i ? 24 : 20) + '</span><span><b>' + (i ? 'WA Business' : 'Business') + '</b><small>' + (i ? 'Client chats' : 'Clients') + '</small></span></a>' +
      '<a class="app" href="' + LINKS.cal + '"><span class="ico" style="background:#2B2414;color:#F5A524">' + ic('cal', i ? 24 : 20) + '</span><span><b>Calendar</b><small>' + (i ? 'Google Calendar' : 'Today') + '</small></span></a>' +
      '</div>';
  }
  function contactsSet() { return settings.contacts.some(function (c) { return c.name && c.number; }); }

  /* ---------- fuel maths ---------- */
  function sortE(list) { return list.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.odo - b.odo; }); }
  function currentPrice() {
    if (!settings.auto && parseFloat(settings.price) > 0) return parseFloat(settings.price);
    return prices.grades[settings.grade] || prices.grades['Special 95'];
  }
  function calcFuel() {
    var E = sortE(fuel.entries);
    var rows = E.map(function (e, i) {
      var km = i > 0 ? e.odo - E[i - 1].odo : null;
      return { e: e, km: km, eff: km !== null && e.litres > 0 ? km / e.litres : null };
    });
    var totL = 0, totKm = 0, spent = 0, measured = 0;
    rows.forEach(function (r) {
      spent += r.e.paid || r.e.litres * r.e.rate;
      if (r.km !== null) { totL += r.e.litres; totKm += r.km; measured++; }
    });
    var avg = totL > 0 ? totKm / totL : 0;
    var price = currentPrice();
    var perDay = 0;
    if (E.length > 1) {
      var days = (new Date(E[E.length - 1].date) - new Date(E[0].date)) / 86400000;
      if (days > 0) perDay = (E[E.length - 1].odo - E[0].odo) / days;
    }
    var proj = [['week', 7], ['month', 30.4], ['year', 365]].map(function (r) {
      var k = perDay * r[1], l = avg > 0 ? k / avg : 0;
      return { label: r[0], aed: perDay > 0 && avg > 0 ? 'AED ' + fmt(l * price) : '–', km: fmt(k) + ' km', l: fmt(l, 1) + ' L' };
    });
    return { E: E, rows: rows, measured: measured, totL: totL, totKm: totKm, spent: spent, avg: avg, price: price, perDay: perDay, proj: proj };
  }
  FD.calcFuel = calcFuel;
  function neighbours(date) {
    var E = sortE(fuel.entries), prev = null, next = null;
    E.forEach(function (e) { if (e.date <= date) prev = e; else if (!next) next = e; });
    return { prev: prev, next: next };
  }
  /* Price per litre on a given date: this month's official price, or last month's for older dates. */
  function priceFor(date) {
    if (!date || !prices.updated || date >= prices.updated) return currentPrice();
    var prev = prices.previous && prices.previous[settings.grade];
    return prev || currentPrice();
  }
  function byAmount() { return settings.fuelInput === 'amount'; }
  /* Litres and cost for what's typed in the form, whichever way it was entered. */
  function formFill() {
    var fm = S.form, rate = priceFor(fm.date || isoDay());
    var litres, amount;
    if (byAmount()) { amount = parseFloat(fm.amount); litres = amount > 0 && rate > 0 ? amount / rate : NaN; }
    else { litres = parseFloat(fm.litres); amount = litres > 0 ? litres * rate : NaN; }
    return { rate: rate, litres: litres, amount: amount };
  }
  function previewText() {
    var fm = S.form, nb = neighbours(fm.date || isoDay()), f = formFill();
    var odo = parseFloat(fm.odo);
    var fill = f.litres > 0 ? fmt(f.litres, 1) + ' L · AED ' + fmt(f.amount, 2) + ' at AED ' + fmt(f.rate, 2) + '/L' : 'Price: AED ' + fmt(f.rate, 2) + '/L (' + settings.grade + ')';
    if (!nb.prev) return 'Starting odometer reading · ' + fill;
    if (!(odo > 0)) return 'Last reading: ' + fmt(nb.prev.odo) + ' km on ' + dayLabel(nb.prev.date) + ' · ' + fill;
    var km = odo - nb.prev.odo;
    if (km <= 0) return 'Enter more than ' + fmt(nb.prev.odo) + ' km, the reading on ' + dayLabel(nb.prev.date) + '.';
    var s = fmt(km) + ' km since last fill';
    if (f.litres > 0) s += ' · ' + fmt(km / f.litres, 1) + ' km/L';
    return s + ' · ' + fill;
  }

  /* ---------- fuel prices (auto-update) ---------- */
  function noticeOn() { return settings.auto && load('fd-price-seen', '') !== prices.updated; }
  function fetchPrices(manual) {
    var url = FD.native ? 'https://raw.githubusercontent.com/Jite1992/fold-drive/main/web/prices.json' : 'prices.json';
    return fetch(url + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        if (!j || !j.grades || !j.updated) throw new Error('bad file');
        var changed = j.updated !== prices.updated;
        prices = j; save('fd-prices', prices); save('fd-prices-checked', Date.now());
        if (manual) toast(changed ? 'New fuel prices for ' + (j.month || j.updated) : 'No new prices · ' + (j.month || 'up to date'));
        if (changed || manual) render();
      })
      .catch(function () { if (manual) toast('Could not check prices. Showing the last known prices.'); });
  }
  function statusText(short) {
    if (!settings.auto) return short ? 'Manual price' : 'Manual price · auto-update is off';
    var m = prices.month || prices.updated;
    return short ? 'UAE prices · ' + m : 'UAE official price · ' + m + ' · updated ' + dayLabel(prices.updated);
  }

  /* ---------- trips ---------- */
  FD.saveTrip = function (t) {
    trips.unshift(t);
    trips = trips.slice(0, 100);
    save('fd-trips', trips);
  };
  function weekKm() {
    var since = Date.now() - 7 * 86400000, km = 0;
    trips.forEach(function (t) { if (t.start >= since) km += t.km; });
    return km;
  }

  /* ---------- toast ---------- */
  var toastEl = document.getElementById('toast'), toastT;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.hidden = true; }, 3000);
  }
  FD.toast = toast;

  /* ---------- home ---------- */
  function now() {
    var d = new Date();
    return {
      time: hhmm(d),
      dShort: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      day: d.toLocaleDateString('en-GB', { weekday: 'long' }),
      date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    };
  }
  function setupBanner() {
    var needs = [];
    if (FD.native) {
      var st = FD.status || {};
      if (!st.location) needs.push('Location');
      if (!st.notif) needs.push('Notification access');
      if (!needs.length) return '';
      return '<button type="button" class="setup" data-a="screen" data-s="settings">' + ic('sliders', 20) + '<span class="grow" style="text-align:left">Finish setup: allow ' + needs.join(' and ') + '</span>' + ic('chev', 16) + '</button>';
    }
    if (!settings.apiKey) needs.push('Google Maps key');
    if (!settings.places[0].lat && !settings.places[0].query) needs.push('Home address');
    if (!needs.length) return '';
    return '<button type="button" class="setup" data-a="screen" data-s="settings">' + ic('sliders', 20) + '<span class="grow" style="text-align:left">Finish setup: add your ' + needs.join(' and ') + '</span>' + ic('chev', 16) + '</button>';
  }
  function searchBox(L, ph) {
    return '<form class="srch" data-f="search" data-t="nav" role="search">' + ic('search', 18, 'currentColor', 2.2) +
      '<input id="dest-' + L + '" data-search="nav" placeholder="' + ph + '" autocomplete="off" enterkeyhint="go" aria-label="Search for a destination" value="' + esc(S.search.nav.q) + '">' +
      '<button type="button" class="mic" data-a="listen" aria-label="Voice command">' + ic('mic', 18, 'currentColor', 2.2) + '</button></form>' +
      '<div class="results" data-results="nav">' + resultsHTML('nav') + '</div>';
  }
  function resultsHTML(t) {
    var s = S.search[t];
    if (!s.q) return '';
    if (s.msg) return '<div class="msg">' + esc(s.msg) + '</div>';
    return s.list.map(function (r, i) {
      return '<button type="button" data-a="pickres" data-t="' + t + '" data-i="' + i + '"><b class="ell">' + esc(r.main) + '</b><span class="ell">' + esc(r.secondary) + '</span></button>';
    }).join('');
  }
  function placeBtn(p, i, style) {
    var isSet = p.lat || p.query;
    var label = isSet ? p.name : 'Set ' + p.name;
    var tr = isSet ? trafficFor(i) : '';
    if (style === 'qp') return '<button type="button" data-a="place" data-i="' + i + '">' + ic(p.icon, 16, 'currentColor', 2.2) + esc(label) + (tr ? ' · ' + tr.split(' · ')[0] : '') + '</button>';
    return '<button type="button" data-a="place" data-i="' + i + '">' + ic(p.icon, 20, 'currentColor', 2.2) + '<span class="ell">' + esc(label) + '</span>' +
      (isSet ? (tr ? '<small class="s13" style="font-weight:700">' + tr + '</small>' : ic('nav', 18, 'currentColor', 2.2)) : '<small class="s13" style="font-weight:600">Add address</small>') + '</button>';
  }
  function fuelChip() {
    var F = calcFuel();
    return F.avg ? fmt(F.avg, 1) + ' km/L · ' + F.proj[1].aed + ' / month' : 'Log a fill-up';
  }
  function voiceBar(L) {
    var right = L === 'i'
      ? '<button type="button" class="chipbtn" data-a="screen" data-s="fuel">' + ic('fuel', 18, '#F5A524') + 'Fuel · ' + fuelChip() + '</button>'
      : '<button type="button" class="round greybtn" data-a="free" aria-label="Track a drive without a destination">' + ic('wheel', 22) + '</button>';
    return '<div class="voice"><button type="button" class="round amberbtn" data-a="listen" aria-label="Voice command">' + ic('mic', 22, 'currentColor', 2.2) + '</button>' +
      '<div class="grow"><b>Tap to speak</b><div class="s12 mute ell">"Navigate to office" · "Call Ahmed" · "Open WhatsApp"</div></div>' + right + '</div>';
  }
  function tripBanner() {
    if (!FD.nav.trip) return '';
    return '<button type="button" class="setup" style="background:var(--amberbg);border-color:var(--amber);color:var(--amber)" data-a="screen" data-s="nav">' + ic('nav', 18, 'currentColor', 2.2) + '<span class="grow" style="text-align:left">Trip in progress · back to navigation</span>' + ic('chev', 16) + '</button>';
  }
  function nextCard() {
    var ev = nextEvent(); if (!ev) return '';
    var d = new Date(ev.begin), today = new Date().toDateString() === d.toDateString();
    return '<div class="card" style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:18px">' +
      '<span class="ico" style="background:var(--amberbg);color:var(--amber)">' + ic('cal') + '</span>' +
      '<div class="grow"><div class="lab">Next · ' + (today ? 'Today' : 'Tomorrow') + ' ' + hhmm(d) + '</div><div class="ell" style="font-weight:600;font-size:16px">' + esc(ev.title) + '</div></div>' +
      (ev.location ? '<button type="button" class="sq amberbtn" data-a="evnav" data-i="' + FD.events.indexOf(ev) + '" aria-label="Navigate to this meeting">' + ic('nav', 20, 'currentColor', 2.4) + '</button>' : '') + '</div>';
  }
  function agendaCard() {
    var now = Date.now();
    var list = shownEvents().filter(function (e) { return e.end > now; }).slice(0, 4);
    var rows = list.map(function (e) {
      var d = new Date(e.begin), idx = FD.events.indexOf(e);
      var when = e.allDay ? 'All day' : hhmm(d);
      var day = new Date().toDateString() === d.toDateString() ? '' : ' · tomorrow';
      return '<div class="trow"><span style="width:56px;font:600 20px var(--display);color:var(--amber);flex-shrink:0">' + when + '</span>' +
        '<span class="grow"><b class="ell">' + esc(e.title) + '</b><span class="s13 mute ell" style="display:block">' + esc(e.location || 'No location') + day + (e.calName ? ' · ' + esc(e.calName) : '') + '</span></span>' +
        (e.location ? '<button type="button" class="sq amberbtn" data-a="evnav" data-i="' + idx + '" aria-label="Navigate">' + ic('nav', 18, 'currentColor', 2.4) + '</button>' : '') + '</div>';
    }).join('');
    return '<div class="recent card"><div class="sb"><div style="font-weight:600;font-size:20px">Today & tomorrow</div><span class="lab">' + fmt(weekKm()) + ' km this week</span></div>' +
      (rows || '<div class="empty">No meetings in the next day and a half.</div>') + '</div>';
  }
  function homeC() {
    var t = now(), F = calcFuel();
    return '<div class="hm c">' +
      '<div class="sb"><div class="clk"><b>' + t.time + '</b><span>' + t.dShort + '</span></div>' +
      '<button type="button" class="sq greybtn" style="border-radius:999px" data-a="screen" data-s="settings" aria-label="Settings">' + ic('sliders', 20) + '</button></div>' +
      tripBanner() + setupBanner() + nextCard() +
      '<div class="navp"><div class="sb"><h2>Navigate</h2>' + ic('nav', 26, 'currentColor', 2.2) + '</div>' + searchBox('c', 'Where to?') +
      '<div class="qp">' + placeBtn(settings.places[0], 0, 'qp') + placeBtn(settings.places[1], 1, 'qp') + '</div></div>' + trafficAlert() +
      appTiles('c') +
      '<button type="button" class="fuelrow" data-a="screen" data-s="fuel">' + ic('fuel', 22, '#F5A524') + '<b>Fuel · ' + (F.avg ? fmt(F.avg, 1) + ' km/L avg' : 'track km/L') + '</b><span>' + (F.avg ? F.proj[1].aed + ' / mo' : 'Log fill-up') + '</span>' + ic('chev', 16, '#9AA6B4', 2.4) + '</button>' +
      voiceBar('c') + '</div>';
  }
  function homeI() {
    var t = now();
    var recent = trips.slice(0, 4).map(function (tr, i) {
      return '<button type="button" class="trow" data-a="again" data-i="' + i + '">' + ic(tr.dest ? 'pin' : 'wheel', 20, '#F5A524') +
        '<span class="grow" style="text-align:left"><b class="ell">' + esc(tr.dest ? tr.dest.name : 'Free drive') + '</b><span class="s13 mute">' + new Date(tr.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' · ' + fmt(tr.km, 1) + ' km · ' + Math.round(tr.min) + ' min · ' + fmt(tr.avg) + ' km/h</span></span></button>';
    }).join('');
    return '<div class="hm i">' +
      '<div class="sb"><div class="clk"><b>' + t.time + '</b><em>' + t.day + '</em><span>' + t.date + '</span></div>' +
      '<div class="row"><span class="pill">' + ic('wheel', 14, 'currentColor', 2.2) + 'Drive mode</span>' +
      '<button type="button" class="btn" data-a="free">' + ic('wheel', 18) + 'Track a drive</button>' +
      '<button type="button" class="sq greybtn" style="border-radius:999px" data-a="screen" data-s="settings" aria-label="Settings">' + ic('sliders', 20) + '</button></div></div>' +
      tripBanner() + setupBanner() +
      '<div class="mid">' +
      '<div class="navp"><div class="sb"><h2>Navigate</h2>' + ic('nav', 28, 'currentColor', 2.2) + '</div>' + searchBox('i', 'Search a place or address') +
      '<div class="places">' + settings.places.map(function (p, i) { return placeBtn(p, i); }).join('') + '</div>' + trafficAlert() + '</div>' +
      (FD.native && FD.status.calendar ? agendaCard() :
      '<div class="recent card"><div class="sb"><div style="font-weight:600;font-size:20px">Recent trips</div><span class="lab">' + fmt(weekKm()) + ' km this week</span></div>' +
      (recent || '<div class="empty">Your trips appear here after your first drive, with distance, time and average speed.</div>') + '</div>') + '</div>' +
      appTiles('i') + voiceBar('i') + '</div>';
  }

  /* ---------- navigation screen ---------- */
  function navHTML(L) {
    var i = L === 'i';
    var stats =
      stat('Drive time', 'drive', 'h:min') + stat(i ? 'Average speed' : 'Avg speed', 'avg', 'km/h') +
      stat(i ? 'Time to destination' : 'Time left', 'left', 'min', '', 'leftU') + stat(i ? 'Total trip time' : 'Total trip', 'total', 'min', '', 'totalU') +
      stat(i ? 'Km driven' : 'Driven', 'driven', 'km') + stat(i ? 'Km to destination' : 'To go', 'rem', 'km', 'teal') +
      '<button type="button" class="stat fuel" data-a="screen" data-s="fuel"><span class="k"><span>' + (i ? 'Fuel efficiency' : 'Fuel eff.') + '</span><span>›</span></span><span class="v"><span data-b="kml">–</span><small> km/L' + (i ? ' avg' : '') + '</small></span></button>' +
      stat(i ? 'Trip fuel used' : 'Trip fuel', 'tripL', 'L', '', 'tripU');
    var acts = '<div class="acts"><button type="button" class="end" data-a="end">' + (i ? 'End trip' : 'End') + '</button>' +
      '<button type="button" data-a="calls" aria-label="Calls" style="color:#6EA8FE">' + ic('phone', 22) + '</button>' +
      '<a href="' + LINKS.wa + '" aria-label="WhatsApp" style="color:#4ADE80">' + ic('wa', 22) + '</a>' +
      '<a href="' + LINKS.wab + '" aria-label="WhatsApp Business" style="color:#34C3B5">' + ic('wab', 22) + '</a>' +
      '<a href="' + LINKS.cal + '" aria-label="Calendar" style="color:#F5A524">' + ic('cal', 22) + '</a></div>';
    var mapPart = '<div class="map" id="mapSlot"><div class="mapmsg" data-b="mapmsg"></div><div class="turn wait" data-b="turn"></div>' +
      '<div class="spd"><div class="dial"><b data-b="speed">0</b><span>KM/H</span></div></div>' +
      '<div class="mapbtns"><button type="button" class="round" data-a="mute" data-b="mutebtn" aria-label="Mute voice guidance" aria-pressed="false">' + ic('sound', 22) + '</button>' +
      '<button type="button" class="round" data-a="recenter" aria-label="Recenter map">' + ic('target', 20, 'currentColor', 2.2) + '</button></div></div>';
    if (!i) {
      return '<div class="nv c">' + mapPart + '<div class="sheet"><div class="handle"></div>' +
        '<div class="sb"><div class="eta"><b data-b="eta">--:--</b><span class="lab">Arrival</span></div><div class="right"><div style="font-weight:600;font-size:15px" class="ell" data-b="dest"></div><div class="s12 mute" data-b="sub"></div></div></div>' +
        '<div class="prog"><i data-b="prog"></i></div><div class="st4">' + stats + '</div>' + acts + '</div></div>';
    }
    return '<div class="nv i">' + mapPart + '<div class="side">' +
      '<div class="sb" style="align-items:flex-end"><div><div class="lab">Arrival</div><div class="bigeta" data-b="eta">--:--</div></div>' +
      '<div class="right"><div style="font-weight:600;font-size:16px" class="ell" data-b="dest"></div><div class="s13 mute" data-b="sub"></div></div></div>' +
      '<div style="display:flex;flex-direction:column;gap:6px"><div class="prog" style="height:8px"><i data-b="prog"></i></div>' +
      '<div class="sb s13 mute"><span data-b="pct"></span><span data-b="totalkm"></span></div></div>' +
      '<div class="st2">' + stats + '</div>' +
      '<div class="nextrow" data-b="next"></div>' + acts + '</div></div>';
  }
  function stat(k, key, unit, cls, unitKey) {
    return '<div class="stat' + (cls ? ' ' + cls : '') + '"><span class="k">' + k + '</span><span class="v"><span data-b="' + key + '">–</span><small' + (unitKey ? ' data-b="' + unitKey + '"' : '') + '> ' + unit + '</small></span></div>';
  }
  function manIcon(m) {
    m = (m || '').toUpperCase();
    if (m === 'ARRIVE') return 'flag';
    if (m.indexOf('UTURN') >= 0) return 'uturn';
    if (m.indexOf('ROUNDABOUT') >= 0) return 'round';
    if (m.indexOf('LEFT') >= 0) return 'left';
    if (m.indexOf('RIGHT') >= 0) return 'right';
    return 'up';
  }
  function distLabel(m) { return m >= 1000 ? fmt(m / 1000, 1) + ' km' : Math.max(10, Math.round(m / 10) * 10) + ' m'; }
  function tripVM() {
    var N = FD.nav, t = N.trip; if (!t) return null;
    var F = calcFuel(), nowT = Date.now();
    var elapsed = Math.max(0, (nowT - t.startedAt) / 1000);
    var km = t.distance / 1000;
    var vm = {
      speed: Math.round(t.speed || 0),
      drive: Math.floor(elapsed / 3600) + ':' + pad(Math.floor(elapsed / 60) % 60),
      avg: elapsed > 30 ? fmt(km / (elapsed / 3600)) : '0',
      driven: fmt(km, 1),
      kml: F.avg ? fmt(F.avg, 1) : '–',
      tripL: F.avg ? fmt(km / F.avg, 1) : '–',
      tripU: F.avg ? (S.layout === 'i' ? ' L · AED ' + fmt(km / F.avg * F.price) : ' L') : ' L',
      dest: t.dest ? t.dest.name : 'Free drive'
    };
    if (t.route && t.remaining != null) {
      var rem = t.arrived ? 0 : t.remaining;
      var leftMin = t.arrived ? 0 : Math.max(1, Math.round(t.route.duration * (rem / Math.max(1, t.route.distance)) / 60));
      var totalMin = Math.round(elapsed / 60) + leftMin;
      var pct = Math.min(100, Math.round(100 * (1 - rem / Math.max(1, t.route.distance))));
      vm.eta = hhmm(new Date(nowT + leftMin * 60000));
      vm.left = String(leftMin); vm.leftU = ' min';
      vm.total = totalMin >= 60 ? Math.floor(totalMin / 60) + ':' + pad(totalMin % 60) : String(totalMin);
      vm.totalU = totalMin >= 60 ? ' h:min' : ' min';
      vm.rem = fmt(rem / 1000, 1);
      vm.prog = pct;
      vm.pct = pct + '% of trip done';
      vm.totalkm = fmt(t.route.distance / 1000, 1) + ' km route';
      vm.sub = pct + '% done · ' + fmt(t.route.distance / 1000, 1) + ' km route';
    } else {
      vm.eta = '--:--'; vm.left = '–'; vm.leftU = ' min'; vm.rem = '–'; vm.prog = 0;
      vm.total = String(Math.round(elapsed / 60)); vm.totalU = ' min';
      vm.pct = t.dest ? 'Waiting for route' : 'No destination'; vm.totalkm = '';
      vm.sub = t.dest ? 'Planning route…' : 'Tracking your drive';
    }
    var cls = 'turn', big = '', line = '', small = '', icon = 'up';
    if (t.status === 'error') { cls += ' err'; icon = 'x'; big = 'No route'; line = t.error || 'Could not plan a route.'; small = 'Trip stats are still being recorded.'; }
    else if (t.status === 'locating') { cls += ' wait'; icon = 'target'; big = 'Finding you'; line = 'Waiting for GPS…'; small = 'Keep the screen on and stay outdoors for a quick fix.'; }
    else if (t.status === 'routing') { cls += ' wait'; icon = 'nav'; big = 'Planning'; line = 'Getting the fastest route with live traffic…'; small = ''; }
    else if (t.status === 'free') { cls += ' wait'; icon = 'wheel'; big = 'Free drive'; line = 'Recording distance, time and speed'; small = 'Tap End to save the trip.'; }
    else if (t.arrived) { icon = 'flag'; big = 'Arrived'; line = t.dest.name; small = 'Trip complete · tap End to save it'; }
    else {
      var u = N.upcoming();
      if (u) { icon = manIcon(u.man); big = distLabel(u.dist); line = u.instr; small = u.then ? 'Then: ' + u.then : ''; }
    }
    vm.turnCls = cls;
    vm.turn = ic(icon, S.layout === 'c' ? 44 : 52, 'currentColor', 2.6) + '<div class="grow"><b>' + esc(big) + '</b><div class="t ell">' + esc(line) + '</div>' + (small ? '<div class="s ell">' + esc(small) + '</div>' : '') + '</div>';
    var u2 = N.upcoming && t.route ? N.upcoming(1) : null;
    vm.next = u2 ? ic(manIcon(u2.man), 22, '#9AA6B4', 2.2) + '<span class="grow ell">Next: ' + esc(u2.instr) + '</span><span class="s13 mute">' + distLabel(u2.dist) + '</span>'
      : ic('clock', 22, '#9AA6B4', 2.2) + '<span class="grow ell">Started ' + hhmm(new Date(t.startedAt)) + '</span>';
    vm.mapmsg = FD.nav.mapMessage();
    return vm;
  }
  function updateNav() {
    if (S.screen !== 'nav') return;
    if (FD.nav.updateScreen) { FD.nav.updateScreen(); return; }
    var vm = tripVM(); if (!vm) return;
    document.querySelectorAll('[data-b]').forEach(function (el) {
      var k = el.getAttribute('data-b');
      if (k === 'turn') { el.className = vm.turnCls; el.innerHTML = vm.turn; }
      else if (k === 'next' || k === 'mapmsg') { el.innerHTML = vm[k] || ''; }
      else if (k === 'prog') { el.style.width = vm.prog + '%'; }
      else if (k === 'mutebtn') { el.setAttribute('aria-pressed', String(!!FD.nav.muted)); el.innerHTML = ic(FD.nav.muted ? 'mute' : 'sound', 22); }
      else if (vm[k] != null) { el.textContent = vm[k]; }
    });
  }
  FD.onTrip = function (kind) {
    if (kind === 'arrived') toast('You have arrived');
    if (S.screen === 'nav') updateNav();
  };

  /* ---------- fuel screen ---------- */
  function fuelNotice(L) {
    if (!noticeOn()) return '';
    var g = settings.grade, nowP = prices.grades[g], was = prices.previous && prices.previous[g];
    var diff = was ? (nowP - was) : 0;
    var text = g + ' is now AED ' + fmt(nowP, 2) + ' per litre' + (was ? ' (' + (diff >= 0 ? '+' : '−') + fmt(Math.abs(diff), 2) + ')' : '') + '. Your fuel costs have been recalculated.';
    var title = 'New fuel prices for ' + (prices.month || dayLabel(prices.updated));
    if (L === 'i') return '<div class="notice">' + ic('refresh', 20, '#34C3B5', 2.2) + '<span class="grow" style="font-size:14px"><strong style="color:var(--fg)">' + title + '.</strong> <span>' + text + '</span></span><button type="button" class="dismiss" data-a="dismiss">Dismiss</button></div>';
    return '<div class="notice">' + ic('refresh', 20, '#34C3B5', 2.2) + '<div class="grow"><b>' + title + '</b><span>' + text + '</span></div><button type="button" class="x" data-a="dismiss" aria-label="Dismiss">' + ic('x', 16, 'currentColor', 2.2) + '</button></div>';
  }
  function hero(F, L) {
    return '<div class="hero"><div><div class="lab" style="color:var(--ink)">' + (L === 'i' ? 'Average fuel efficiency' : 'Average') + '</div><b>' + (F.avg ? fmt(F.avg, 1) : '–') + '<small> km/L</small></b></div>' +
      '<div class="meta"><span>' + (F.avg ? fmt(100 / F.avg, 1) : '–') + ' L/100 km</span><span>' + F.measured + ' refills measured</span><span>' + fmt(F.totKm) + ' km logged</span></div></div>';
  }
  function mini3(F, L) {
    function m(k, v) { return '<div class="mini"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }
    return '<div class="g3">' + m(L === 'i' ? 'Petrol consumed' : 'Fuel used', fmt(F.totL, 1) + ' L') + m(L === 'i' ? 'Total spent' : 'Spent', 'AED ' + fmt(F.spent)) +
      m(L === 'i' ? 'Cost per km now' : 'Cost per km', F.avg ? 'AED ' + fmt(F.price / F.avg, 2) : '–') + '</div>';
  }
  function chips() {
    return '<div class="chips">' + GRADES.map(function (g) {
      return '<button type="button" class="chip" data-a="grade" data-g="' + g + '" aria-pressed="' + (settings.grade === g) + '">' + g + ' · ' + fmt(prices.grades[g], 2) + '</button>';
    }).join('') + '</div>';
  }
  function autoBtn() { return '<button type="button" class="autobtn" data-a="auto" aria-pressed="' + settings.auto + '">' + (settings.auto ? 'Auto-update on' : 'Auto-update off') + '</button>'; }
  function priceInput(L) {
    return '<label class="pin" for="price-' + L + '">Your price · AED<input id="price-' + L + '" type="number" inputmode="decimal" step="0.01" data-price value="' + esc(settings.price || fmt(prices.grades[settings.grade], 2)) + '">/ L</label>';
  }
  function projTiles(F, L) {
    return '<div class="g3">' + F.proj.map(function (p) {
      return '<div class="proj"><span class="lab">' + (L === 'i' ? 'Per ' : 'This ') + p.label + '</span><span class="a">' + p.aed + '</span>' +
        (L === 'i' ? '<span style="font-size:14px;color:var(--soft)">' + p.l + ' petrol</span><span class="s13 mute">' + p.km + ' driven</span>' : '<span class="s12 mute">' + p.l + ' · ' + p.km + '</span>') + '</div>';
    }).join('') + '</div>';
  }
  function fuelForm(L) {
    var f = S.form, last = neighbours(isoDay()).prev;
    function fld(k, label, type, ph) {
      return '<label for="' + k + '-' + L + '">' + label + '<input id="' + k + '-' + L + '" type="' + type + '"' + (type === 'number' ? ' inputmode="decimal" step="any"' : '') + ' data-k="' + k + '" placeholder="' + (ph || '') + '" value="' + esc(f[k]) + '"></label>';
    }
    return '<div class="form"><h3>Log a refill</h3><div class="fields">' +
      fld('date', 'Date', 'date') + fld('odo', 'Odometer (km)', 'number', last ? String(last.odo + 600) : 'e.g. 48210') +
      (byAmount() ? fld('amount', 'Amount paid (AED)', 'number', '220.00') : fld('litres', 'Litres filled', 'number', '52.0')) + '</div>' +
      '<div class="pv" data-preview>' + esc(previewText()) + '</div>' +
      (S.err ? '<span class="err">' + esc(S.err) + '</span>' : '') +
      '<button type="button" class="savebtn" data-a="save">Save refill</button>' +
      '<span class="s12 mute">Fill the tank fully each time. ' + (byAmount() ? 'Litres are worked out from the amount and that month\'s fuel price.' : 'Cost is worked out from that month\'s fuel price.') + ' Switch between litres and amount in Settings.</span></div>';
  }
  function history(F) {
    if (!F.rows.length) return '<div class="empty">No fill-ups yet. Your first entry sets the starting odometer reading; km/L appears from the second.</div>';
    return F.rows.slice().reverse().map(function (r) {
      var e = r.e;
      return '<div class="hrow"><span class="d">' + dayLabel(e.date) + '</span>' +
        '<div class="grow"><b>' + (r.km !== null ? '+' + fmt(r.km) + ' km · ' + fmt(r.eff, 1) + ' km/L' : 'Starting reading') + '</b>' +
        '<span class="s12 mute">Odometer ' + fmt(e.odo) + ' · ' + fmt(e.litres, 1) + ' L · AED ' + fmt(e.paid || e.litres * e.rate, 2) + '</span></div>' +
        '<button type="button" class="del" data-a="del" data-id="' + e.id + '" aria-label="Delete this refill">' + ic('x', 16, 'currentColor', 2.2) + '</button></div>';
    }).join('');
  }
  function fuelC() {
    var F = calcFuel();
    return '<div class="fu c"><div class="fhd"><button type="button" class="backbtn" data-a="back" aria-label="Back">' + ic('back', 20, 'currentColor', 2.4) + '</button><h1>Fuel efficiency</h1>' + ic('fuel', 24, '#F5A524') + '</div>' +
      '<div class="fbody">' + fuelNotice('c') + (S.showForm ? fuelForm('c') : '') + hero(F, 'c') + mini3(F, 'c') +
      '<div class="pcard"><div class="sb"><div class="grow"><div style="font-weight:600;font-size:15px">Fuel price · AED ' + fmt(F.price, 2) + ' / L</div><div class="s12 mute">' + esc(statusText(false)) + '</div></div>' + autoBtn() + '</div>' +
      chips() + (settings.auto ? '<button type="button" class="ghost" data-a="check">Check for new prices now</button>' : priceInput('c')) + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px"><span class="lab">Fuel cost at AED ' + fmt(F.price, 2) + ' / L · ' + fmt(F.perDay) + ' km a day</span>' + projTiles(F, 'c') + '</div>' +
      '<div class="hist"><span class="lab">Refill history</span>' + history(F) + '</div></div>' +
      '<div class="ffoot"><button type="button" class="bigbtn" data-a="form">' + (S.showForm ? 'Close' : '+ Log a refill') + '</button></div></div>';
  }
  function fuelI() {
    var F = calcFuel();
    return '<div class="fu i"><div class="fhd"><button type="button" class="backbtn" data-a="back" aria-label="Back">' + ic('back', 20, 'currentColor', 2.4) + '</button><h1>Fuel efficiency</h1>' +
      '<span class="status"><span class="dot' + (settings.auto ? '' : ' off') + '"></span>' + esc(statusText(true)) + '</span>' +
      (settings.auto ? '<button type="button" class="ghost" data-a="check">Check now</button>' : '') + autoBtn() + '</div>' +
      fuelNotice('i') +
      '<div class="cols"><div class="colL">' + hero(F, 'i') + mini3(F, 'i') +
      '<div class="projcard">' + chips() + (settings.auto ? '' : priceInput('i')) +
      '<div class="sb" style="align-items:baseline"><span style="font-weight:600;font-size:17px">Fuel cost at AED ' + fmt(F.price, 2) + ' / L</span><span class="s13 mute">Based on ' + fmt(F.perDay) + ' km a day</span></div>' +
      projTiles(F, 'i') + '</div></div>' +
      '<div class="colR">' + fuelForm('i') + '<span class="lab">Refill history</span><div class="hist">' + history(F) + '</div></div></div></div>';
  }

  /* ---------- settings ---------- */
  function settingsHTML(L) {
    var placeRows = settings.places.map(function (p, i) {
      return '<div class="prow">' + ic(p.icon, 20, '#F5A524') + '<div class="grow"><input class="inp" data-pname="' + i + '" value="' + esc(p.name) + '" aria-label="Place name"><div class="s12 mute ell" style="margin-top:4px">' + esc(p.addr || 'Not set') + '</div></div>' +
        '<button type="button" class="btn" data-a="setplace" data-i="' + i + '">' + (p.lat ? 'Change' : 'Set') + '</button></div>';
    }).join('');
    var contactRows = settings.contacts.map(function (c, i) {
      return '<div class="prow"><input class="inp" data-cname="' + i + '" placeholder="Name" value="' + esc(c.name) + '" aria-label="Contact name"><input class="inp" type="tel" data-cnum="' + i + '" placeholder="+971 50 123 4567" value="' + esc(c.number) + '" aria-label="Phone number"></div>';
    }).join('');
    var keySection = FD.native ? FD.nativeSettings() + FD.googleKeySection() :
      '<section class="sec"><h2>Google Maps key</h2><p>Needed for the map, place search and live-traffic routes. Paste the key from your Google Cloud project (see the install guide).</p>' +
      '<input class="inp" id="apikey" placeholder="AIza…" autocomplete="off" spellcheck="false" value="' + esc(settings.apiKey) + '">' +
      '<div class="row"><button type="button" class="btn amber" data-a="savekey">Save key</button><span class="s13 mute" id="keystatus">' + (settings.apiKey ? 'Key saved' : 'No key yet') + '</span></div></section>';
    return '<div class="st ' + L + '"><div class="fhd"><button type="button" class="backbtn" data-a="back" aria-label="Back">' + ic('back', 20, 'currentColor', 2.4) + '</button><h1>Settings</h1></div><div class="stbody">' +
      keySection +
      (FD.native ? calendarSection() : '') +
      '<section class="sec"><h2>Saved places</h2><p>Shown on the home screen for one-tap navigation.</p>' + placeRows + '</section>' +
      trafficSection() +
      '<section class="sec"><h2>Quick-dial contacts</h2><p>Tap Calls while driving to ring these numbers with one tap, or say "Call" and the name.</p>' + contactRows + '<button type="button" class="btn amber" data-a="savecontacts">Save contacts</button></section>' +
      '<section class="sec"><h2>Driving</h2>' + (FD.native ? '' : '<div class="toggle">Voice guidance<button type="button" data-a="voicetoggle" aria-pressed="' + settings.voice + '" aria-label="Voice guidance"></button></div>') +
      '<div class="toggle">Fuel price auto-update<button type="button" data-a="auto" aria-pressed="' + settings.auto + '" aria-label="Fuel price auto-update"></button></div>' +
      '<label class="s13 mute" for="inputSel">When logging a refill, enter</label><select id="inputSel" class="inp" data-inputsel><option value="litres"' + (byAmount() ? '' : ' selected') + '>Litres filled</option><option value="amount"' + (byAmount() ? ' selected' : '') + '>Amount paid (AED)</option></select>' +
      '<label class="s13 mute" for="gradeSel">Fuel your car uses</label><select id="gradeSel" class="inp" data-gradesel>' + GRADES.map(function (g) { return '<option' + (g === settings.grade ? ' selected' : '') + '>' + g + '</option>'; }).join('') + '</select></section>' +
      '<section class="sec"><h2>Backup</h2><p>Your fill-ups, trips and settings are stored on this phone only. Export a backup file now and then, and import it after changing phones or clearing Chrome data.</p>' +
      '<div class="row" style="flex-wrap:wrap"><button type="button" class="btn" data-a="export">Export backup</button><label class="btn" for="importFile">Import backup</label><input id="importFile" type="file" accept="application/json,.json" hidden></div></section>' +
      '<section class="sec"><h2>About</h2><p>Fold Drive ' + (FD.native ? (FD.status.version || VERSION) + ' for Android' : VERSION) + ' · ' + trips.length + ' trips · ' + fuel.entries.length + ' fill-ups stored.</p></section>' +
      '</div></div>';
  }

  function calendarSection() {
    var cals = FD.calendars || [], hidden = settings.hiddenCals || [];
    if (!FD.status.calendar) return '';
    var rows = cals.map(function (c) {
      var on = hidden.indexOf(String(c.id)) < 0;
      var src = /exchange|outlook|microsoft|office|eas/i.test(c.type + ' ' + c.account) ? 'Outlook / Exchange' : (/google/i.test(c.type) ? 'Google' : (/samsung|local/i.test(c.type) ? 'Phone' : c.type.split('.').pop()));
      return '<div class="toggle"><span class="grow">' + esc(c.name) + '<span class="s12 mute" style="display:block">' + esc(src) + (c.account && c.account !== c.name ? ' · ' + esc(c.account) : '') + '</span></span>' +
        '<button type="button" data-a="caltoggle" data-id="' + c.id + '" aria-pressed="' + on + '" aria-label="Show ' + esc(c.name) + '"></button></div>';
    }).join('');
    return '<section class="sec"><h2>Calendars</h2><p>Meetings from the calendars switched on here appear on the home screen.</p>' + (rows || '<div class="empty">No calendars found on this phone.</div>') +
      '<p><b style="color:var(--fg)">Don\'t see Outlook?</b> Open the Outlook app → Settings → tap your account → turn on <b style="color:var(--fg)">Sync calendars</b>. Then come back here. Or add your work account in the phone\'s Settings → Accounts.</p></section>';
  }

  /* ---------- traffic (TomTom, optional) ---------- */
  function ttRoute(from, to) {
    var url = 'https://api.tomtom.com/routing/1/calculateRoute/' + from.lat + ',' + from.lng + ':' + to.lat + ',' + to.lng +
      '/json?key=' + encodeURIComponent(settings.tomtomKey) + '&traffic=true&travelMode=car&routeType=fastest&sectionType=traffic&instructionsType=text&language=en-GB';
    return fetch(url).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error('TomTom rejected the key. Check it in Settings.');
      if (!r.ok) throw new Error('Traffic service error ' + r.status);
      return r.json();
    }).then(function (j) {
      var rt = j.routes && j.routes[0]; if (!rt) throw new Error('No route found');
      var sm = rt.summary, ins = (rt.guidance && rt.guidance.instructions) || [];
      function roadAt(idx) {
        var name = '';
        for (var i = 0; i < ins.length && ins[i].pointIndex <= idx; i++) {
          var n = ins[i].street || (ins[i].roadNumbers || []).join(' / ');
          if (n) name = n;
        }
        return name;
      }
      var jams = (rt.sections || []).filter(function (x) { return x.sectionType === 'TRAFFIC' && (x.delayInSeconds || 0) >= 60; }).map(function (x) {
        return {
          road: roadAt(x.startPointIndex) || 'On the way', delayMin: Math.round(x.delayInSeconds / 60),
          kind: x.simpleCategory === 'ROAD_WORK' ? 'roadworks' : x.simpleCategory === 'ROAD_CLOSURE' ? 'road closed' : 'slow traffic'
        };
      }).sort(function (a, b) { return b.delayMin - a.delayMin; });
      return { km: sm.lengthInMeters / 1000, mins: Math.round(sm.travelTimeInSeconds / 60), delayMin: Math.round((sm.trafficDelayInSeconds || 0) / 60), jams: jams, at: Date.now() };
    });
  }
  FD.traffic = { route: ttRoute, hasKey: function () { return !!settings.tomtomKey; } };
  function placeCoords(p) {
    if (p.lat != null) return { lat: p.lat, lng: p.lng };
    if (FD.native && p.query) {
      var g = null; try { g = JSON.parse(window.Android.geocode(p.query)); } catch (e) { }
      if (g && g.lat != null) { p.lat = g.lat; p.lng = g.lng; saveSettings(); return g; }
    }
    return null;
  }
  var lastHomeTraffic = 0;
  function refreshHomeTraffic(force) {
    if (!settings.tomtomKey || FD.nav.trip) return;
    if (!force && Date.now() - lastHomeTraffic < 5 * 60000) return;
    lastHomeTraffic = Date.now();
    FD.nav.here().then(function (here) {
      settings.places.forEach(function (p, i) {
        var to = placeCoords(p); if (!to) return;
        if (FD.nav.hav && FD.nav.hav(here, to) < 500) { S.traffic[i] = { here: true }; return; }
        ttRoute(here, to).then(function (r) { S.traffic[i] = r; if (S.screen === 'home') softRender(); })
          .catch(function (e) { S.traffic[i] = { error: e.message }; });
      });
    }).catch(function () { });
  }
  function softRender() { var a = document.activeElement; if (!(a && a.tagName === 'INPUT') && !S.modal) render(); }
  function trafficFor(i) {
    var r = S.traffic[i]; if (!r || r.error || r.here || r.mins == null) return '';
    return r.mins + ' min' + (r.delayMin >= 2 ? ' · +' + r.delayMin : '');
  }
  function trafficAlert() {
    var worst = null;
    settings.places.forEach(function (p, i) {
      var r = S.traffic[i]; if (!r || !r.jams || !r.jams.length) return;
      var j = r.jams[0]; if (j.delayMin >= 3 && (!worst || j.delayMin > worst.j.delayMin)) worst = { j: j, p: p };
    });
    if (!worst) return '';
    return '<div class="alert">' + ic('clock', 18, 'currentColor', 2.2) + '<span class="grow"><b>' + esc(worst.j.road) + ' +' + worst.j.delayMin + ' min</b> · ' + worst.j.kind + ' on the way to ' + esc(worst.p.name) + '</span></div>';
  }
  FD.trafficAlertsHTML = function (t) {
    if (!t || !t.jams || !t.jams.length) return '';
    return t.jams.slice(0, 2).map(function (j) { return '<div class="alert">' + ic('clock', 18, 'currentColor', 2.2) + '<span class="grow"><b>' + esc(j.road) + ' +' + j.delayMin + ' min</b> · ' + j.kind + '</span></div>'; }).join('');
  };
  function trafficSection() {
    return '<section class="sec"><h2>Traffic alerts</h2><p>Optional. Shows delays by road name (for example "Sheikh Zayed Rd +6 min") for your saved places and the trip you are on, and exact km left. Needs a free TomTom key: sign up at developer.tomtom.com (no card needed), open Keys, and copy your key here.</p>' +
      '<input class="inp" id="ttkey" placeholder="TomTom API key" autocomplete="off" spellcheck="false" value="' + esc(settings.tomtomKey || '') + '">' +
      '<div class="row"><button type="button" class="btn amber" data-a="savett">Save key</button><span class="s13 mute" id="ttstatus">' + (settings.tomtomKey ? 'Key saved' : 'Not set up') + '</span></div></section>';
  }

  /* ---------- modals ---------- */
  function modalHTML() {
    if (S.modal === 'calls') {
      var rows = settings.contacts.filter(function (c) { return c.name && c.number; }).map(function (c) {
        if (FD.native) return '<button type="button" class="mrow" data-a="dial" data-n="' + esc(c.number) + '">' + ic('phone', 22, '#6EA8FE') + '<span>' + esc(c.name) + '<small>' + esc(c.number) + '</small></span></button>';
        return '<a class="mrow" href="tel:' + esc(c.number.replace(/[^\d+]/g, '')) + '">' + ic('phone', 22, '#6EA8FE') + '<span>' + esc(c.name) + '<small>' + esc(c.number) + '</small></span></a>';
      }).join('');
      return '<div class="modal" data-a="close"><div class="mbox" role="dialog" aria-label="Calls"><h2>Calls</h2>' +
        (rows || '<div class="empty">Add quick-dial contacts in Settings to call them with one tap.</div>') +
        (FD.native ? '<button type="button" class="mrow" data-a="open" data-app="dialer">' + ic('phone', 22, '#9AA6B4') + '<span>Open phone dialer' + ((FD.counts || {}).missed ? '<small>' + FD.counts.missed + ' missed calls</small>' : '') + '</span></button>'
          : '<a class="mrow" href="tel:">' + ic('phone', 22, '#9AA6B4') + '<span>Open phone dialer</span></a>') +
        '<button type="button" class="btn" data-a="close">Close</button></div></div>';
    }
    if (S.modal === 'chats' && S.chatApp) {
      var app = S.chatApp, name = app === 'business' ? 'WhatsApp Business' : 'WhatsApp';
      var list = ((FD.chats || {})[app] || []).slice().sort(function (a, b) { return b.time - a.time; });
      var body;
      if (!FD.status.notif) body = '<div class="empty">Allow Notification access in Settings so Fold Drive can show unread messages.</div>';
      else if (!list.length) body = '<div class="empty">No unread messages.</div>';
      else body = list.map(function (c) {
        var lines = (c.lines || []).slice(-3).map(function (l) { return '<span class="s13 mute ell" style="display:block">' + (l.from && l.from !== c.title ? '<b style="color:var(--soft)">' + esc(l.from) + ':</b> ' : '') + esc(l.text) + '</span>'; }).join('');
        return '<button type="button" class="mrow" style="align-items:flex-start" data-a="openchat" data-key="' + esc(c.key) + '" data-app="' + app + '">' +
          '<span class="grow" style="text-align:left"><span class="sb"><b class="ell" style="font-size:16px">' + esc(c.title) + '</b><span class="badge" style="position:static">' + c.count + '</span></span>' + lines + '</span></button>';
      }).join('');
      return '<div class="modal" data-a="close"><div class="mbox" role="dialog" aria-label="' + name + '"><h2>' + name + '</h2>' + body +
        '<div class="row"><button type="button" class="btn amber" data-a="open" data-app="' + app + '" style="flex:1">Open ' + name + '</button><button type="button" class="btn" data-a="close">Close</button></div></div></div>';
    }
    if (S.modal === 'summary' && S.summary) {
      var t = S.summary;
      function cell(k, v) { return '<div class="mini"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }
      return '<div class="modal" data-a="close"><div class="mbox" role="dialog" aria-label="Trip saved"><h2>Trip saved</h2><div class="s15 mute">' + esc(t.dest ? t.dest.name : 'Free drive') + '</div>' +
        '<div class="sumgrid">' + cell('Km driven', fmt(t.km, 1) + ' km') + cell('Drive time', Math.round(t.min) + ' min') + cell('Average speed', fmt(t.avg) + ' km/h') +
        cell('Fuel used', t.litres ? fmt(t.litres, 1) + ' L' : '–') + cell('Fuel cost', t.litres ? 'AED ' + fmt(t.cost, 2) : '–') + cell('Top speed', fmt(t.top) + ' km/h') + '</div>' +
        '<button type="button" class="btn amber" data-a="close">Done</button></div></div>';
    }
    if (S.modal === 'picker' && S.picker != null) {
      var p = settings.places[S.picker];
      return '<div class="modal"><div class="mbox" role="dialog" aria-label="Choose a place"><h2>Set ' + esc(p.name) + '</h2>' +
        '<form class="srch" data-f="search" data-t="pick">' + ic('search', 18, 'currentColor', 2.2) + '<input id="pickq" data-search="pick" placeholder="Search an address or place" autocomplete="off" value="' + esc(S.search.pick.q) + '"></form>' +
        '<div class="results" data-results="pick">' + resultsHTML('pick') + '</div>' +
        (FD.native ? '<p class="s13 mute" style="margin:0">Type the address or place name as you would in Google Maps, then tap it below.</p>' : '') +
        '<button type="button" class="mrow" data-a="usehere">' + ic('target', 22, '#34C3B5') + '<span>Use my current location</span></button>' +
        '<button type="button" class="btn" data-a="close">Cancel</button></div></div>';
    }
    return '';
  }

  /* ---------- render ---------- */
  var app = document.getElementById('app');
  function screenHTML() {
    var L = S.layout;
    if (S.screen === 'nav' && FD.nav.trip) return FD.nav.renderScreen ? FD.nav.renderScreen(L) : navHTML(L);
    if (S.screen === 'fuel') return L === 'c' ? fuelC() : fuelI();
    if (S.screen === 'settings') return settingsHTML(L);
    return L === 'c' ? homeC() : homeI();
  }
  function render() {
    if (S.screen === 'nav' && !FD.nav.trip) S.screen = 'home';
    var active = document.activeElement, activeId = active && active.id, selStart = active && active.selectionStart;
    app.innerHTML = screenHTML() + modalHTML();
    if (S.screen === 'nav') { FD.nav.attach(document.getElementById('mapSlot')); updateNav(); }
    if (activeId) {
      var el = document.getElementById(activeId);
      if (el && el.tagName === 'INPUT') { el.focus(); try { if (selStart != null) el.setSelectionRange(selStart, selStart); } catch (e) { } }
    }
  }
  FD.render = render;
  function show(screen) { if (screen !== S.screen) { S.prev = S.screen; S.screen = screen; } S.modal = null; render(); }
  FD.show = show;

  /* ---------- search ---------- */
  var searchT = {};
  function runSearch(t, q) {
    var s = S.search[t]; s.q = q; s.msg = ''; clearTimeout(searchT[t]);
    if (!q.trim()) { s.list = []; updateResults(t); return; }
    if (!settings.apiKey && !FD.native) { s.msg = 'Add your Google Maps key in Settings to search places.'; updateResults(t); return; }
    if (!FD.native) { s.msg = 'Searching…'; updateResults(t); }
    searchT[t] = setTimeout(function () {
      FD.nav.suggest(q).then(function (list) {
        if (s.q !== q) return;
        s.list = list; s.msg = list.length ? '' : 'No places found for "' + q + '".'; updateResults(t);
      }).catch(function (e) { s.msg = FD.nav.errorText(e); s.list = []; updateResults(t); });
    }, 280);
  }
  function updateResults(t) { document.querySelectorAll('[data-results="' + t + '"]').forEach(function (el) { el.innerHTML = resultsHTML(t); }); }
  function pickResult(t, i) {
    var r = S.search[t].list[i]; if (!r) return;
    toast('Getting location…');
    FD.nav.resolve(r).then(function (place) {
      S.search[t] = { q: '', list: [], msg: '' };
      if (t === 'pick') { assignPlace(place); return; }
      startNav(place);
    }).catch(function (e) { toast(FD.nav.errorText(e)); });
  }
  function assignPlace(place) {
    var p = settings.places[S.picker];
    p.lat = place.lat; p.lng = place.lng; p.query = place.query || ''; p.addr = place.address || place.name;
    saveSettings(); S.modal = null; S.picker = null; toast(p.name + ' saved'); render();
  }
  function startNav(place) {
    if (FD.nav.trip) finishTrip(false);
    FD.nav.start({ name: place.name, lat: place.lat, lng: place.lng, query: place.query || '', address: place.address || '' });
    show('nav');
  }
  FD.startNav = startNav;
  FD.refreshHomeTraffic = refreshHomeTraffic;
  FD.back = function () {
    if (S.modal) { S.modal = null; S.picker = null; render(); return true; }
    if (S.screen === 'home') return false;
    show(FD.nav.trip && S.screen !== 'nav' ? 'nav' : 'home');
    return true;
  };

  /* ---------- trip end ---------- */
  function finishTrip(showSummary) {
    var t = FD.nav.end(); if (!t) return;
    var F = calcFuel();
    var km = t.distance / 1000, min = Math.max(0, (t.endedAt - t.startedAt) / 60000);
    var rec = { start: t.startedAt, end: t.endedAt, km: km, min: min, avg: min > 0.5 ? km / (min / 60) : 0, top: t.top || 0, dest: t.dest, litres: F.avg ? km / F.avg : 0, cost: F.avg ? km / F.avg * F.price : 0 };
    if (km >= 0.2) FD.saveTrip(rec);
    if (showSummary && km >= 0.2) { S.summary = rec; S.modal = 'summary'; }
    else if (showSummary) toast('Trip ended · too short to save');
  }

  /* ---------- voice commands ---------- */
  function listen() {
    if (FD.native) { window.Android.voice(); return; }
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Voice commands need Chrome on Android.'); return; }
    var r = new SR(); r.lang = 'en-GB'; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = function (e) { handleVoice(e.results[0][0].transcript); };
    r.onerror = function (e) { toast(e.error === 'not-allowed' ? 'Allow microphone access for voice commands.' : "Didn't catch that. Try again."); };
    try { r.start(); toast('Listening…'); } catch (e) { toast('Voice is busy. Try again.'); }
  }
  function handleVoice(text) {
    var t = text.toLowerCase().trim(), m;
    if ((m = t.match(/^(?:navigate|take me|drive|directions?|go)\s+(?:to\s+)?(?:the\s+)?(.+)$/))) {
      var q = m[1].trim();
      var idx = settings.places.findIndex(function (p) { return p.name.toLowerCase() === q && (p.lat || p.query); });
      if (idx >= 0) { goPlace(idx); return; }
      if (FD.native) { startNav({ name: q, query: q }); return; }
      if (!settings.apiKey) { toast('Add your Google Maps key in Settings first.'); return; }
      toast('Searching "' + q + '"…');
      FD.nav.suggest(q).then(function (list) {
        if (!list.length) { toast('No places found for "' + q + '".'); return; }
        return FD.nav.resolve(list[0]).then(startNav);
      }).catch(function (e) { toast(FD.nav.errorText(e)); });
      return;
    }
    if ((m = t.match(/^call\s+(.+)$/))) {
      var c = settings.contacts.find(function (c) { return c.name && c.number && c.name.toLowerCase().indexOf(m[1]) >= 0; });
      if (c) { if (FD.native) window.Android.call(c.number); else window.location.href = 'tel:' + c.number.replace(/[^\d+]/g, ''); return; }
      toast('No quick-dial contact named "' + m[1] + '". Add one in Settings.'); return;
    }
    if (/whatsapp business|business/.test(t)) { if (FD.native) window.Android.open('business'); else window.location.href = LINKS.wab; return; }
    if (/whatsapp/.test(t)) { if (FD.native) window.Android.open('whatsapp'); else window.location.href = LINKS.wa; return; }
    if (/calendar/.test(t)) { if (FD.native) window.Android.open('calendar'); else window.location.href = LINKS.cal; return; }
    if (/maps|map/.test(t) && FD.native) { window.Android.open('maps'); return; }
    if (/fuel/.test(t)) { show('fuel'); return; }
    if (/^(end|stop)/.test(t) && FD.nav.trip) { finishTrip(true); show('home'); return; }
    toast('Heard "' + text + '". Try "Navigate to office" or "Call Ahmed".');
  }
  FD.onVoice = handleVoice;
  function goPlace(i) {
    var p = settings.places[i];
    if (!p.lat && !p.query) { S.picker = i; S.modal = 'picker'; S.search.pick = { q: '', list: [], msg: '' }; render(); return; }
    startNav({ name: p.name, lat: p.lat, lng: p.lng, query: p.query, address: p.addr });
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-a]'); if (!el) return;
    var a = el.getAttribute('data-a');
    if (a === 'close' && el.classList.contains('modal') && ev.target !== el) return;
    var g, i;
    switch (a) {
      case 'screen': show(el.getAttribute('data-s')); break;
      case 'back': show(FD.nav.trip && S.prev === 'nav' ? 'nav' : 'home'); break;
      case 'calls': S.modal = 'calls'; render(); break;
      case 'close': S.modal = null; S.picker = null; render(); break;
      case 'listen': listen(); break;
      case 'free': if (FD.nav.trip) finishTrip(false); FD.nav.start(null); show('nav'); break;
      case 'place': goPlace(+el.getAttribute('data-i')); break;
      case 'again':
        var tr = trips[+el.getAttribute('data-i')];
        if (tr && tr.dest) startNav(tr.dest); else { FD.nav.start(null); show('nav'); }
        break;
      case 'pickres': pickResult(el.getAttribute('data-t'), +el.getAttribute('data-i')); break;
      case 'end': finishTrip(true); S.prev = 'home'; S.screen = 'home'; render(); break;
      case 'mute': FD.nav.muted = !FD.nav.muted; updateNav(); toast(FD.nav.muted ? 'Voice guidance muted' : 'Voice guidance on'); break;
      case 'recenter': FD.nav.recenter(); break;
      case 'form': S.showForm = !S.showForm; S.err = ''; render(); break;
      case 'grade':
        settings.grade = el.getAttribute('data-g'); if (!settings.auto) settings.price = '';
        saveSettings(); render(); break;
      case 'auto':
        settings.auto = !settings.auto; if (settings.auto) settings.price = '';
        saveSettings(); render(); break;
      case 'check': toast('Checking UAE fuel prices…'); fetchPrices(true); break;
      case 'dismiss': save('fd-price-seen', prices.updated); render(); break;
      case 'del':
        var id = el.getAttribute('data-id');
        fuel.entries = fuel.entries.filter(function (x) { return String(x.id) !== id; });
        saveFuel(); render(); toast('Refill deleted'); break;
      case 'save': saveRefill(); break;
      case 'savekey':
        var k = (document.getElementById('apikey').value || '').trim();
        var had = settings.apiKey;
        settings.apiKey = k; saveSettings();
        if (had && had !== k && FD.nav.mapsLoaded()) { toast('Key saved · restarting'); setTimeout(function () { location.reload(); }, 600); return; }
        if (!k) { toast('Key removed'); render(); return; }
        document.getElementById('keystatus').textContent = 'Testing…';
        FD.nav.load().then(function () { return FD.nav.suggest('Dubai Mall'); })
          .then(function () { document.getElementById('keystatus').textContent = 'Key works: map and search are ready'; toast('Google Maps is ready'); })
          .catch(function (e) { var s = document.getElementById('keystatus'); if (s) s.textContent = FD.nav.errorText(e); });
        break;
      case 'setplace': S.picker = +el.getAttribute('data-i'); S.modal = 'picker'; S.search.pick = { q: '', list: [], msg: '' }; render(); break;
      case 'usehere':
        toast('Finding your location…');
        FD.nav.here().then(function (c) { assignPlace({ name: settings.places[S.picker].name, lat: c.lat, lng: c.lng, address: 'Pinned at ' + c.lat.toFixed(5) + ', ' + c.lng.toFixed(5) }); })
          .catch(function (e) { toast(FD.nav.errorText(e)); });
        break;
      case 'savecontacts':
        document.querySelectorAll('[data-cname]').forEach(function (inp) { settings.contacts[+inp.getAttribute('data-cname')].name = inp.value.trim(); });
        document.querySelectorAll('[data-cnum]').forEach(function (inp) { settings.contacts[+inp.getAttribute('data-cnum')].number = inp.value.trim(); });
        saveSettings(); toast('Contacts saved'); break;
      case 'voicetoggle': settings.voice = !settings.voice; saveSettings(); render(); break;
      case 'export': exportData(); break;
      case 'open': window.Android.open(el.getAttribute('data-app')); if (S.modal) { S.modal = null; render(); } break;
      case 'dial': window.Android.call(el.getAttribute('data-n')); S.modal = null; render(); break;
      case 'perm': window.Android.request(el.getAttribute('data-p')); break;
      case 'chats': if (FD.refreshNative) FD.refreshNative(); S.chatApp = el.getAttribute('data-app'); S.modal = 'chats'; render(); break;
      case 'openchat': window.Android.openChat(el.getAttribute('data-key'), el.getAttribute('data-app')); S.modal = null; render(); break;
      case 'caltoggle':
        var cid = el.getAttribute('data-id'), hc = settings.hiddenCals || [];
        settings.hiddenCals = hc.indexOf(cid) >= 0 ? hc.filter(function (x) { return x !== cid; }) : hc.concat([cid]);
        saveSettings(); render(); break;
      case 'savett':
        settings.tomtomKey = (document.getElementById('ttkey').value || '').trim(); saveSettings();
        var tst = document.getElementById('ttstatus');
        if (!settings.tomtomKey) { tst.textContent = 'Not set up'; break; }
        tst.textContent = 'Testing…';
        ttRoute({ lat: 25.1972, lng: 55.2744 }, { lat: 25.2131, lng: 55.2797 })
          .then(function (r) { tst.textContent = 'Key works · Dubai Mall to DIFC ' + r.mins + ' min now'; lastHomeTraffic = 0; refreshHomeTraffic(true); })
          .catch(function (e) { tst.textContent = e.message; });
        break;
      case 'pref': FD.prefToggle(el.getAttribute('data-k')); break;
      case 'openmaps': FD.nav.recenter(); break;
      case 'savegkey': FD.saveGoogleKey(); break;
      case 'mapfollow': if (typeof FD.nav.follow === 'function') FD.nav.follow(); break;
      case 'evnav':
        var ev = (FD.events || [])[+el.getAttribute('data-i')];
        if (ev && ev.location) startNav({ name: ev.title, query: ev.location }); else toast('This meeting has no location');
        break;
    }
  });
  document.addEventListener('input', function (ev) {
    var tg = ev.target;
    var st = tg.getAttribute && tg.getAttribute('data-search');
    if (st) { runSearch(st, tg.value); return; }
    var k = tg.getAttribute && tg.getAttribute('data-k');
    if (k) {
      S.form[k] = tg.value;
      var pv = previewText();
      document.querySelectorAll('[data-preview]').forEach(function (x) { x.textContent = pv; });
    }
  });
  document.addEventListener('change', function (ev) {
    var tg = ev.target;
    if (tg.hasAttribute('data-price')) { settings.price = tg.value; saveSettings(); render(); }
    else if (tg.hasAttribute('data-gradesel')) { settings.grade = tg.value; saveSettings(); render(); }
    else if (tg.hasAttribute('data-inputsel')) { settings.fuelInput = tg.value; saveSettings(); render(); toast(tg.value === 'amount' ? 'Refills: enter the amount paid' : 'Refills: enter litres filled'); }
    else if (tg.hasAttribute('data-pname')) { settings.places[+tg.getAttribute('data-pname')].name = tg.value.trim() || 'Place'; saveSettings(); }
    else if (tg.id === 'importFile' && tg.files && tg.files[0]) importData(tg.files[0]);
  });
  document.addEventListener('submit', function (ev) {
    var f = ev.target.closest('[data-f="search"]'); if (!f) return;
    ev.preventDefault();
    var t = f.getAttribute('data-t'), s = S.search[t];
    if (s.list.length) pickResult(t, 0);
    else if (s.q) runSearch(t, s.q);
  });

  function saveRefill() {
    var fm = S.form, odo = parseFloat(fm.odo), f = formFill(), litres = f.litres, rate = f.rate;
    if (!fm.date || !(odo > 0) || !(litres > 0) || !(rate > 0)) { S.err = 'Fill in the date, odometer and ' + (byAmount() ? 'amount paid.' : 'litres.'); render(); return; }
    var nb = neighbours(fm.date);
    if (nb.prev && odo <= nb.prev.odo) { S.err = 'Odometer must be more than ' + fmt(nb.prev.odo) + ' km, the reading on ' + dayLabel(nb.prev.date) + '.'; render(); return; }
    if (nb.next && odo >= nb.next.odo) { S.err = 'Odometer must be less than ' + fmt(nb.next.odo) + ' km, the reading on ' + dayLabel(nb.next.date) + '.'; render(); return; }
    fuel.entries.push({ id: Date.now(), date: fm.date, odo: odo, litres: Math.round(litres * 100) / 100, rate: rate, paid: byAmount() ? f.amount : null });
    saveFuel();
    S.form = { date: isoDay(), odo: '', litres: '', amount: '', rate: '' }; S.err = ''; S.showForm = false;
    render();
    toast(nb.prev ? 'Refill saved · ' + fmt(odo - nb.prev.odo) + ' km · ' + fmt((odo - nb.prev.odo) / litres, 1) + ' km/L' : 'Starting odometer reading saved');
  }

  function exportData() {
    var data = { app: 'Fold Drive', version: VERSION, exported: new Date().toISOString(), settings: Object.assign({}, settings, { apiKey: '' }), fuel: fuel, trips: trips };
    if (FD.native) {
      var ok = window.Android.saveFile('fold-drive-backup-' + isoDay() + '.json', JSON.stringify(data, null, 2));
      toast(ok ? 'Backup saved to Downloads' : 'Could not save the backup');
      return;
    }
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'fold-drive-backup-' + isoDay() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast('Backup saved to Downloads');
  }
  function importData(file) {
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result);
        if (!d || d.app !== 'Fold Drive' || !d.fuel) throw new Error();
        var key = settings.apiKey;
        Object.assign(settings, d.settings || {}); settings.apiKey = key || (d.settings && d.settings.apiKey) || '';
        fuel = d.fuel; trips = d.trips || [];
        saveSettings(); saveFuel(); save('fd-trips', trips);
        toast('Backup imported · ' + fuel.entries.length + ' fill-ups, ' + trips.length + ' trips'); render();
      } catch (e) { toast('That file is not a Fold Drive backup.'); }
    };
    rd.readAsText(file);
  }

  /* ---------- lifecycle ---------- */
  var lastLayout = S.layout, rT;
  window.addEventListener('resize', function () {
    clearTimeout(rT);
    rT = setTimeout(function () {
      var L = layoutNow();
      if (L !== lastLayout) { lastLayout = L; S.layout = L; render(); }
    }, 150);
  });
  setInterval(function () {
    var a = document.activeElement;
    if (S.screen === 'home' && !S.modal && !(a && a.tagName === 'INPUT')) { if (FD.native) FD.refreshNative(); refreshHomeTraffic(false); render(); }
  }, 30000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - load('fd-prices-checked', 0) > 6 * 3600000) fetchPrices(false);
  });

  window.addEventListener('DOMContentLoaded', function () {
    var qs = new URLSearchParams(location.search).get('screen');
    if (qs === 'fuel' || qs === 'settings') S.screen = qs;
    render();
    fetchPrices(false);
    setTimeout(function () { refreshHomeTraffic(true); }, 1500);
    if ('serviceWorker' in navigator && !window.Android) navigator.serviceWorker.register('sw.js').catch(function () { });
  });
})();
