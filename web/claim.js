/* Fold Drive: builds the reimbursement workbook from your own template (web/templates/claim.xlsx),
   keeping its layout, styles, logos and formulas. Sheets: Sheet1 (Expenses reimbursement form),
   KilometreLog and Expense Report, ViewTrips (Salik, same layout as the Salik website export),
   plus a Parking slips sheet with the slip photos. Works in the app and in Node (for tests). */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function serial(ms) {
    var d = new Date(ms);
    return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000;
  }
  function r2(n) { return Math.round((+n || 0) * 100) / 100; }
  function colNum(c) { var n = 0; for (var i = 0; i < c.length; i++) n = n * 26 + c.charCodeAt(i) - 64; return n; }

  var CELL = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

  /* one cell's XML; spec: null (empty), {n}, {s}, {f, v} (formula with cached value), keeps the style */
  function cellXml(ref, style, spec) {
    var s = style ? ' s="' + style + '"' : '';
    if (spec == null || spec === '' || (spec.s != null && spec.s === '')) return '<c r="' + ref + '"' + s + '/>';
    if (spec.f != null) {
      var str = typeof spec.v === 'string';
      return '<c r="' + ref + '"' + s + (str ? ' t="str"' : '') + '><f>' + esc(spec.f) + '</f>' + (spec.v != null ? '<v>' + esc(str ? spec.v : r2n(spec.v)) + '</v>' : '') + '</c>';
    }
    if (spec.n != null) return '<c r="' + ref + '"' + s + '><v>' + r2n(spec.n) + '</v></c>';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + esc(spec.s) + '</t></is></c>';
  }
  function r2n(n) { return String(Math.round(n * 1e6) / 1e6); }
  function styleOf(attrs) { var m = /\ss="(\d+)"/.exec(attrs || ''); return m ? m[1] : null; }

  /* set several cells in a sheet (the cells must already exist in the template, as they do for styled ones) */
  function setCells(xml, map) {
    var done = {};
    xml = xml.replace(CELL, function (all, col, row, attrs) {
      var ref = col + row;
      if (!Object.prototype.hasOwnProperty.call(map, ref)) return all;
      done[ref] = 1;
      return cellXml(ref, styleOf(attrs), map[ref]);
    });
    Object.keys(map).forEach(function (ref) {
      if (done[ref]) return;
      // not in the template: add it to its row, in column order
      var m = /^([A-Z]+)(\d+)$/.exec(ref), col = m[1], row = m[2];
      var re = new RegExp('(<row r="' + row + '"[^>]*>)([\\s\\S]*?)(</row>)');
      if (!re.test(xml)) return;
      xml = xml.replace(re, function (a, open, inner, close) {
        var cells = inner.match(/<c r="[A-Z]+\d+"[\s\S]*?(?:\/>|<\/c>)/g) || [];
        var out = [], put = false, mine = cellXml(ref, null, map[ref]);
        cells.forEach(function (c) {
          var cc = /<c r="([A-Z]+)/.exec(c)[1];
          if (!put && colNum(cc) > colNum(col)) { out.push(mine); put = true; }
          out.push(c);
        });
        if (!put) out.push(mine);
        return open + out.join('') + close;
      });
    });
    return xml;
  }
  function getRow(xml, r) { var m = new RegExp('<row r="' + r + '"[^>]*>[\\s\\S]*?</row>').exec(xml); return m ? m[0] : null; }
  /* a copy of a template row at another row number, with new values */
  function rowFrom(tpl, from, to, values) {
    var x = tpl.replace(new RegExp('<row r="' + from + '"'), '<row r="' + to + '"')
      .replace(new RegExp('<c r="([A-Z]+)' + from + '"', 'g'), function (a, c) { return '<c r="' + c + to + '"'; });
    var map = {};
    Object.keys(values).forEach(function (c) { map[c + to] = values[c]; });
    // template formula cells we are not overwriting become plain styled cells
    x = x.replace(CELL, function (all, col, row, attrs) {
      if (map[col + row] !== undefined) return all;
      return /<f/.test(all) ? cellXml(col + row, styleOf(attrs), null) : all;
    });
    return setCells(x, map);
  }

  /* ---------- the three sheets ---------- */
  function fillSummary(xml, d) {
    var map = {
      B3: { s: d.person.name || '' }, E3: { n: serial(d.date) }, B4: { s: d.person.email || '' },
      E4: { s: d.purpose || 'Fuel, Salik, & Parking' }, A37: { s: (d.person.name || '').split(' ')[0] }
    };
    var lines = d.summary.slice(0, 26), tc = 0, tv = 0;
    for (var i = 0; i < 26; i++) {
      var r = 6 + i, e = lines[i];
      if (e) {
        var net = r2(e.net), vat = e.vat ? r2(e.vat) : null;
        tc += net; tv += vat || 0;
        map['A' + r] = { n: serial(e.date) }; map['B' + r] = { s: e.details };
        map['C' + r] = { n: net }; map['D' + r] = vat ? { n: vat } : null;
        map['E' + r] = { f: 'SUM(C' + r + ':D' + r + ')', v: r2(net + (vat || 0)) };
        map['F' + r] = e.remarks ? { s: e.remarks } : null;
      } else {
        map['A' + r] = null; map['B' + r] = null; map['C' + r] = null; map['D' + r] = null; map['F' + r] = null;
        map['E' + r] = { f: 'SUM(C' + r + ':D' + r + ')', v: 0 };
      }
    }
    var adv = r2(d.advance || 0);
    map.C32 = { f: 'SUM(C6:C31)', v: r2(tc) }; map.D32 = { f: 'SUM(D6:D31)', v: r2(tv) };
    map.E32 = { f: 'SUM(C32:D32)', v: r2(tc + tv) };
    map.E33 = adv ? { n: adv } : null;
    map.E34 = { f: 'E32-E33', v: r2(tc + tv - adv) };
    return setCells(xml, map);
  }

  function fillKm(xml, table, d) {
    var drives = d.drives, n = Math.max(1, drives.length), last = 8 + n, tot = last + 1;
    var dataTpl = getRow(xml, 9), totTpl = getRow(xml, 13);
    var rows = [], km = 0, rate = +d.rate || 0;
    for (var i = 0; i < n; i++) {
      var r = 9 + i, v = drives[i];
      var f1 = v && v.odoStart != null ? Math.round(v.odoStart) : null, f2 = v && v.odoEnd != null ? Math.round(v.odoEnd) : null;
      var k = f1 != null && f2 != null ? f2 - f1 : 0; km += k;
      rows.push(rowFrom(dataTpl, 9, r, {
        B: v ? { n: serial(v.date) } : null, C: v ? { s: v.from || '' } : null, D: v ? { s: v.to || '' } : null, E: v ? { s: v.notes || '' } : null,
        F: f1 != null ? { n: f1 } : null, G: f2 != null ? { n: f2 } : null,
        H: { f: 'IFERROR(IF(OR(ISBLANK(F' + r + '),ISBLANK(G' + r + ')),0,G' + r + '-F' + r + '), "")', v: k },
        I: { f: 'IFERROR(H' + r + '*$I$3, "")', v: r2(k * rate) }
      }));
    }
    rows.push(rowFrom(totTpl, 13, tot, {
      H: { f: 'SUBTOTAL(109,Expense3[Kilometre])', v: km }, I: { f: 'SUBTOTAL(109,Expense3[Reimbursement])', v: r2(km * rate) }
    }));
    xml = xml.replace(/<row r="9"[^>]*>[\s\S]*?<row r="13"[^>]*>[\s\S]*?<\/row>/, rows.join(''));
    var dates = drives.map(function (v) { return v.date; });
    var md = function (ms) { var x = new Date(ms); return (x.getMonth() + 1) + '/' + x.getDate() + '/' + String(x.getFullYear()).slice(2); };
    xml = setCells(xml, {
      C3: { s: d.person.name || '' }, C4: d.person.empId ? { s: d.person.empId } : null, C5: { s: d.person.vehicle || '' },
      C6: d.person.authorizedBy ? { s: d.person.authorizedBy } : null, I3: { n: rate },
      I4: { f: '"From "&TEXT(MIN(B9:B' + last + '),"m/d/yy")&" to "&TEXT(MAX(B9:B' + last + '),"m/d/yy")', v: dates.length ? 'From ' + md(Math.min.apply(null, dates)) + ' to ' + md(Math.max.apply(null, dates)) : '' },
      I5: { f: 'Mileage_Total', v: km }, I6: { f: 'Reimbursement_Total', v: r2(km * rate) }
    });
    xml = xml.replace(/<dimension ref="[^"]*"\/>/, '<dimension ref="A1:I' + tot + '"/>');
    table = table.replace(/(<table [^>]*?\sref=")[^"]*"/, '$1B8:I' + tot + '"').replace(/(<autoFilter ref=")[^"]*"/, '$1B8:I' + last + '"');
    return { xml: xml, table: table, km: km };
  }

  function fillSalik(xml, d) {
    var s = d.salik || { rows: [] }, list = s.rows || [];
    var dataTpl = getRow(xml, 16), totTpl = getRow(xml, 26);
    var rows = [], q = 0, v = 0, t = 0, merges = [];
    list.forEach(function (c, i) {
      var r = 16 + i;
      q += +c.amt || 0; v += +c.vat || 0; t += +c.total || 0;
      var tag = /^\d+$/.test(String(c.tag || '')) ? { n: +c.tag } : { s: c.tag || '' };
      rows.push(rowFrom(dataTpl, 16, r, {
        C: { s: c.txid || '' }, D: { s: c.date || '' }, F: { s: c.time || '' }, G: { s: c.post || '' }, H: { s: c.gate || '' },
        J: { s: c.dir || '' }, K: tag, P: { s: c.plate || '' }, Q: { n: +c.amt || 0 }, R: { n: +c.vat || 0 }, S: { n: +c.total || 0 }
      }));
      merges.push(r);
    });
    var tr = 16 + list.length;
    rows.push(rowFrom(totTpl, 26, tr, { J: { s: 'TotalTrips:' }, K: { n: list.length }, P: { s: 'TotalAmount (AED):' }, Q: { n: r2(q) }, R: { n: r2(v) }, S: { n: r2(t) } }));
    merges.push(tr);
    xml = xml.replace(/<row r="16"[^>]*>[\s\S]*?<row r="26"[^>]*>[\s\S]*?<\/row>/, rows.join(''));
    xml = xml.replace(/<mergeCells count="\d+">([\s\S]*?)<\/mergeCells>/, function (a, inner) {
      var keep = (inner.match(/<mergeCell ref="[^"]+"\/>/g) || []).filter(function (m) { return +/[A-Z]+(\d+)/.exec(m)[1] < 16; });
      merges.forEach(function (r) { keep.push('<mergeCell ref="D' + r + ':E' + r + '"/>', '<mergeCell ref="H' + r + ':I' + r + '"/>', '<mergeCell ref="K' + r + ':O' + r + '"/>'); });
      return '<mergeCells count="' + keep.length + '">' + keep.join('') + '</mergeCells>';
    });
    xml = setCells(xml, { C6: { s: s.account || '' }, B7: { s: s.period || '' } });
    if (s.type) xml = setCells(xml, { B9: { s: s.type } });
    xml = xml.replace(/<dimension ref="[^"]*"\/>/, '<dimension ref="B2:S' + tr + '"/>');
    return { xml: xml, total: r2(t) };
  }

  /* ---------- parking slips sheet with photos ---------- */
  var NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  function addSlips(zip, files, slips) {
    var EMU = 9525, rowPx = 20, row = 2, rowsXml = ['<row r="1"><c r="A1" t="inlineStr"><is><t>Parking slips</t></is></c></row>'];
    var anchors = [], rels = [];
    slips.forEach(function (p, i) {
      var w = p.w || 600, h = p.h || 800, k = Math.min(1, 520 / w, 720 / h);
      w = Math.round(w * k); h = Math.round(h * k);
      rowsXml.push('<row r="' + (row + 1) + '"><c r="A' + (row + 1) + '" t="inlineStr"><is><t xml:space="preserve">' + esc(p.title) + '</t></is></c></row>');
      var name = 'slip' + (i + 1) + '.jpeg';
      zip.file('xl/media/' + name, p.base64, { base64: true });
      rels.push('<Relationship Id="rId' + (i + 1) + '" Type="' + NS_R + '/image" Target="../media/' + name + '"/>');
      anchors.push('<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + (row + 1) + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
        '<xdr:ext cx="' + w * EMU + '" cy="' + h * EMU + '"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (i + 2) + '" name="Parking slip ' + (i + 1) + '"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
        '<xdr:blipFill><a:blip r:embed="rId' + (i + 1) + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + w * EMU + '" cy="' + h * EMU + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>');
      row += Math.ceil(h / rowPx) + 3;
    });
    var sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="' + NS_MAIN + '" xmlns:r="' + NS_R + '"><dimension ref="A1:A' + row + '"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="80" customWidth="1"/></cols><sheetData>' + rowsXml.join('') + '</sheetData>' +
      '<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' + (slips.length ? '<drawing r:id="rId1"/>' : '') + '</worksheet>';
    zip.file('xl/worksheets/sheetSlips.xml', sheet);
    if (slips.length) {
      zip.file('xl/worksheets/_rels/sheetSlips.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + NS_R + '/drawing" Target="../drawings/drawingSlips.xml"/></Relationships>');
      zip.file('xl/drawings/drawingSlips.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + NS_R + '">' + anchors.join('') + '</xdr:wsDr>');
      zip.file('xl/drawings/_rels/drawingSlips.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join('') + '</Relationships>');
    }
    files.ct = files.ct.replace('</Types>', '<Override PartName="/xl/worksheets/sheetSlips.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      (slips.length ? '<Override PartName="/xl/drawings/drawingSlips.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '') + '</Types>');
    if (!/Extension="jpeg"/.test(files.ct)) files.ct = files.ct.replace('<Default ', '<Default Extension="jpeg" ContentType="image/jpeg"/><Default ');
    files.wb = files.wb.replace('</sheets>', '<sheet name="Parking slips" sheetId="90" r:id="rIdSlips"/></sheets>');
    files.rels = files.rels.replace('</Relationships>', '<Relationship Id="rIdSlips" Type="' + NS_R + '/worksheet" Target="worksheets/sheetSlips.xml"/></Relationships>');
  }

  /* drop a sheet (for the "only Salik" / "only km log" exports) */
  function removeSheet(zip, files, name) {
    var list = files.wb.match(/<sheet [^>]*\/>/g) || [];
    var idx = -1, rid = null;
    list.forEach(function (s, i) { if (s.indexOf('name="' + esc(name) + '"') >= 0) { idx = i; rid = /r:id="([^"]+)"/.exec(s)[1]; } });
    if (idx < 0) return;
    files.wb = files.wb.replace(list[idx], '');
    files.wb = files.wb.replace(/<definedName ([^>]*)>([\s\S]*?)<\/definedName>/g, function (all, attrs) {
      var m = /localSheetId="(\d+)"/.exec(attrs); if (!m) return all;
      var id = +m[1]; if (id === idx) return ''; if (id > idx) return all.replace('localSheetId="' + id + '"', 'localSheetId="' + (id - 1) + '"');
      return all;
    });
    files.wb = files.wb.replace(/<definedNames><\/definedNames>/, '');
    var rel = new RegExp('<Relationship Id="' + rid + '"[^>]*Target="([^"]+)"[^>]*/>').exec(files.rels) ||
      new RegExp('<Relationship [^>]*Id="' + rid + '"[^>]*/>').exec(files.rels);
    if (rel) {
      files.rels = files.rels.replace(rel[0], '');
      var target = /Target="([^"]+)"/.exec(rel[0])[1], path = 'xl/' + target.replace(/^\/?xl\//, '');
      zip.remove(path); zip.remove(path.replace('worksheets/', 'worksheets/_rels/') + '.rels');
      files.ct = files.ct.replace(new RegExp('<Override PartName="/' + path.replace(/[.]/g, '\\.') + '"[^>]*/>'), '');
    }
  }

  function build(JSZip, templateBuf, d) {
    return JSZip.loadAsync(templateBuf).then(function (zip) {
      var names = ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'xl/tables/table1.xml'];
      return Promise.all(names.map(function (n) { return zip.file(n).async('string'); })).then(function (x) {
        var files = { wb: x[0], rels: x[1], ct: x[2] };
        var s1 = fillSummary(x[3], d);
        var km = fillKm(x[4], x[6], d);
        var sk = fillSalik(x[5], d);
        // only one tab selected (Excel groups sheets that are all selected)
        function untab(s) { return s.replace(/\stabSelected="1"/g, ''); }
        s1 = untab(s1).replace('<sheetView ', '<sheetView tabSelected="1" ');
        zip.file('xl/worksheets/sheet1.xml', s1);
        zip.file('xl/worksheets/sheet2.xml', untab(km.xml));
        zip.file('xl/tables/table1.xml', km.table);
        zip.file('xl/worksheets/sheet3.xml', untab(sk.xml));
        var want = d.sheets || ['summary', 'km', 'salik', 'slips'];
        if (want.indexOf('slips') >= 0 && ((d.slips || []).length || want.length === 1)) addSlips(zip, files, d.slips || []);
        if (want.indexOf('salik') < 0) removeSheet(zip, files, 'ViewTrips');
        if (want.indexOf('km') < 0) removeSheet(zip, files, 'KilometreLog and Expense Report');
        if (want.indexOf('summary') < 0) removeSheet(zip, files, 'Sheet1');
        if (want[0] !== 'summary') {
          // make the first remaining sheet the selected one
          var first = /<sheet [^>]*r:id="([^"]+)"/.exec(files.wb);
          var t = first && new RegExp('<Relationship [^>]*Id="' + first[1] + '"[^>]*/>').exec(files.rels);
          var p = t && 'xl/' + /Target="([^"]+)"/.exec(t[0])[1];
          if (p && zip.file(p)) return zip.file(p).async('string').then(function (sx) {
            zip.file(p, untab(sx).replace('<sheetView ', '<sheetView tabSelected="1" '));
            return finish();
          });
        }
        return finish();
        function finish() {
          zip.file('xl/workbook.xml', files.wb);
          zip.file('xl/_rels/workbook.xml.rels', files.rels);
          zip.file('[Content_Types].xml', files.ct);
          return zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
        }
      });
    });
  }

  var api = { build: build, serial: serial };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FDClaim = api;
})(this);
