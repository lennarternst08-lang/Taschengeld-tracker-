(function () {
  'use strict';

  var C = window.TGCalc;
  var STORE_KEY = 'tg-tracker-v1';
  var LOG_PREVIEW = 6;

  var eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  var num = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
  var monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
  var dateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  function fmtH(h) { return num.format(h) + ' h'; }
  function fmtSigned(n, unit) {
    var s = unit === '€' ? eur.format(Math.abs(n)) : fmtH(Math.abs(n));
    return (n < 0 ? '−' : '+') + s;
  }
  function inputVal(n) { return n ? String(C.r2(n)).replace('.', ',') : ''; }

  /* ---------- Speicher ---------- */

  function defaultStore() {
    return { version: 1, settings: { wage: 14, deductionPct: 0 }, months: {} };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultStore();
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return defaultStore();
      s.settings = Object.assign(defaultStore().settings, s.settings || {});
      s.months = s.months || {};
      return s;
    } catch (e) {
      return defaultStore();
    }
  }

  var store = load();
  var storageOk = true;

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      storageOk = true;
    } catch (e) {
      storageOk = false;
    }
  }

  function monthKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function shiftMonth(key, delta) {
    var p = key.split('-').map(Number);
    return monthKey(new Date(p[0], p[1] - 1 + delta, 1));
  }

  var currentKey = monthKey(new Date());

  function entries(key) {
    var m = store.months[key || currentKey];
    return m ? m.entries : [];
  }

  function addEntry(kind, d, meta, key) {
    if (C.isEmptyDelta(d)) return null;
    key = key || currentKey;
    if (!store.months[key]) store.months[key] = { entries: [] };
    var e = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: new Date().toISOString(),
      kind: kind,
      d: d,
      meta: meta || {}
    };
    store.months[key].entries.push(e);
    save();
    return e;
  }

  function removeEntry(id) {
    var m = store.months[currentKey];
    if (!m) return;
    m.entries = m.entries.filter(function (e) { return e.id !== id; });
    save();
  }

  /* ---------- Anzeige ---------- */

  var $ = function (id) { return document.getElementById(id); };
  var logExpanded = false;

  function setText(id, v) { $(id).textContent = v; }

  function render() {
    var list = entries();
    var s = C.summary(list, store.settings);
    var wage = store.settings.wage;

    var d = new Date(currentKey + '-01T12:00:00');
    setText('monthLabel', monthFmt.format(d));
    var isNow = currentKey === monthKey(new Date());
    setText('monthSub', isNow ? 'aktueller Monat' : (currentKey < monthKey(new Date()) ? 'vergangen' : 'Planung'));

    $('onboarding').hidden = list.length > 0;

    setText('totalNow', eur.format(s.totalNow));
    setText('payNow', eur.format(s.payNow));
    setText('payNowHint', fmtH(s.worked) + ' × ' + eur.format(wage) +
      (store.settings.deductionPct ? ' − ' + num.format(store.settings.deductionPct) + ' %' : ''));
    setText('tips', eur.format(s.tips));
    setText('tipsHint', 'online ' + eur.format(s.online) + ' · bar ' + eur.format(s.cash));

    setText('tipPerHour', eur.format(s.tipPerHour));
    setText('worked', fmtH(s.worked));
    setText('planned', fmtH(s.planned));

    setText('totalHours', fmtH(s.totalHours));
    $('progressBar').style.width = Math.round(s.progress * 100) + '%';
    setText('progressHint', fmtH(s.worked) + ' gearbeitet + ' + fmtH(s.planned) + ' geplant');
    setText('payMonth', eur.format(s.payMonth));
    setText('forecastCurrentTips', eur.format(s.forecastCurrentTips));
    setText('forecastProjected', eur.format(s.forecastProjected));
    setText('projHint', s.worked > 0
      ? 'Ø ' + eur.format(s.tipPerHour) + '/h × ' + fmtH(s.totalHours) + ' = ' + eur.format(s.projectedTips) + ' TG'
      : 'noch keine Stunden für Ø');

    renderLog(list);
  }

  function describe(e) {
    var d = e.d, parts = [], title;
    switch (e.kind) {
      case 'shift':
        title = 'Schicht ' + fmtH(d.worked || 0);
        if (d.cash) parts.push(fmtSigned(d.cash, '€') + ' bar');
        if (d.online) parts.push(fmtSigned(d.online, '€') + ' online');
        if (d.planned) parts.push(fmtSigned(d.planned, 'h') + ' geplant');
        break;
      case 'online':
        title = 'Online-TG Stand ' + eur.format(e.meta.total != null ? e.meta.total : 0);
        parts.push(fmtSigned(d.online || 0, '€'));
        break;
      case 'cash':
        title = 'Bar-TG ' + fmtSigned(d.cash || 0, '€');
        break;
      default:
        title = e.kind === 'import' ? 'Import / Automatik' : 'Stand angepasst';
        if (d.worked) parts.push(fmtSigned(d.worked, 'h') + ' gearbeitet');
        if (d.planned) parts.push(fmtSigned(d.planned, 'h') + ' geplant');
        if (d.online) parts.push(fmtSigned(d.online, '€') + ' online');
        if (d.cash) parts.push(fmtSigned(d.cash, '€') + ' bar');
    }
    return { title: title, detail: parts.join(' · ') };
  }

  function renderLog(list) {
    var ul = $('log');
    ul.textContent = '';
    var items = list.slice().reverse();
    var shown = logExpanded ? items : items.slice(0, LOG_PREVIEW);
    shown.forEach(function (e) {
      var info = describe(e);
      var li = document.createElement('li');
      var what = document.createElement('div');
      what.className = 'what';
      var t = document.createElement('div'); t.className = 't'; t.textContent = info.title;
      var dd = document.createElement('div'); dd.className = 'd';
      dd.textContent = dateFmt.format(new Date(e.ts)) + (info.detail ? ' · ' + info.detail : '');
      what.appendChild(t); what.appendChild(dd);
      var del = document.createElement('button');
      del.className = 'del'; del.type = 'button'; del.textContent = '✕';
      del.setAttribute('aria-label', 'Eintrag löschen');
      del.addEventListener('click', function () {
        if (confirm('Eintrag „' + info.title + '“ löschen?')) {
          removeEntry(e.id);
          render();
          toast('Eintrag gelöscht');
        }
      });
      li.appendChild(what); li.appendChild(del);
      ul.appendChild(li);
    });
    $('logEmpty').hidden = list.length > 0;
    $('toggleLog').hidden = items.length <= LOG_PREVIEW;
    $('toggleLog').textContent = logExpanded ? 'Weniger' : 'Alle (' + items.length + ')';
  }

  var toastTimer;
  function toast(msg, undoEntry) {
    var el = $('toast');
    el.textContent = msg;
    if (undoEntry) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Rückgängig';
      b.addEventListener('click', function () {
        removeEntry(undoEntry.id);
        render();
        toast('Rückgängig gemacht');
      });
      el.appendChild(b);
    }
    if (!storageOk) el.textContent += ' (Speichern im Browser fehlgeschlagen!)';
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, undoEntry ? 4500 : 2200);
  }

  /* ---------- Sheets ---------- */

  function field(form, name) { return form.elements[name]; }
  function val(form, name) { return C.parseNum(field(form, name).value); }

  function prefill(dialog) {
    var form = dialog.querySelector('form');
    var t = C.totals(entries());
    form.reset();
    switch (form.dataset.action) {
      case 'shift':
        field(form, 'onlineTotal').placeholder = 'bisher ' + inputVal(t.online || 0);
        field(form, 'fromPlan').checked = t.planned > 0;
        field(form, 'fromPlan').disabled = t.planned <= 0;
        break;
      case 'online':
        field(form, 'onlineTotal').value = inputVal(t.online);
        field(form, 'onlineTotal').placeholder = '0';
        break;
      case 'state':
        ['worked', 'planned', 'online', 'cash'].forEach(function (f) {
          field(form, f).value = inputVal(t[f]);
          field(form, f).placeholder = '0';
        });
        break;
      case 'settings':
        field(form, 'wage').value = inputVal(store.settings.wage);
        field(form, 'deductionPct').value = inputVal(store.settings.deductionPct) || '0';
        break;
    }
    updateHints(form);
  }

  function updateHints(form) {
    var t = C.totals(entries());
    form.querySelectorAll('[data-hint]').forEach(function (h) {
      var k = h.dataset.hint;
      if (k === 'onlineTotal') {
        var v = val(form, 'onlineTotal');
        if (v == null) { h.textContent = 'Bisher ' + eur.format(t.online) + ' online.'; return; }
        var diff = C.r2(v - t.online);
        h.innerHTML = '';
        h.append('Bisher ' + eur.format(t.online) + ' → ');
        var b = document.createElement('b'); b.textContent = fmtSigned(diff, '€');
        h.append(b, ' neues Online-TG');
      } else if (k === 'cashTotal') {
        var c = val(form, 'cash') || 0;
        h.textContent = 'Bar gesamt danach: ' + eur.format(t.cash + c);
      } else if (k === 'planned') {
        h.textContent = t.planned > 0 ? '(noch ' + fmtH(t.planned) + ')' : '(keine geplant)';
      }
    });
  }

  function openSheet(id) {
    var dlg = $(id);
    prefill(dlg);
    dlg.showModal();
    var first = dlg.querySelector('input:not([type=checkbox])');
    if (first && id !== 'sheetSettings') {
      setTimeout(function () { first.focus(); if (first.select) first.select(); }, 60);
    }
  }

  function handleSubmit(form) {
    var list = entries();
    var e;
    switch (form.dataset.action) {
      case 'shift': {
        var hours = val(form, 'hours');
        var cash = val(form, 'cash');
        var onlineTotal = val(form, 'onlineTotal');
        if (!hours && !cash && onlineTotal == null) { toast('Bitte Stunden oder Trinkgeld eingeben'); return false; }
        if (hours != null && hours < 0) { toast('Stunden dürfen nicht negativ sein'); return false; }
        var d = C.shiftDelta(list, { hours: hours, cash: cash, onlineTotal: onlineTotal, fromPlan: field(form, 'fromPlan').checked });
        e = addEntry(hours ? 'shift' : 'state', d, onlineTotal != null ? { onlineTotal: onlineTotal } : {});
        toast(e ? 'Schicht gespeichert' : 'Keine Änderung', e);
        break;
      }
      case 'online': {
        var total = val(form, 'onlineTotal');
        if (total == null) { toast('Bitte Gesamtstand eingeben'); return false; }
        e = addEntry('online', C.deltaToTarget(list, { online: total }), { total: total });
        toast(e ? 'Online-TG aktualisiert' : 'Keine Änderung', e);
        break;
      }
      case 'cash': {
        var c = val(form, 'cash');
        if (!c) { toast('Bitte Betrag eingeben'); return false; }
        e = addEntry('cash', { cash: C.r2(c) });
        toast('Bar-TG ' + fmtSigned(c, '€'), e);
        break;
      }
      case 'state': {
        var target = {};
        ['worked', 'planned', 'online', 'cash'].forEach(function (f) {
          var v = val(form, f);
          target[f] = v == null ? 0 : v;
        });
        if (target.worked < 0 || target.planned < 0) { toast('Stunden dürfen nicht negativ sein'); return false; }
        e = addEntry('state', C.deltaToTarget(list, target));
        toast(e ? 'Stand übernommen' : 'Keine Änderung', e);
        break;
      }
      case 'settings': {
        var w = val(form, 'wage');
        var p = val(form, 'deductionPct');
        if (w == null || w < 0) { toast('Ungültiger Stundenlohn'); return false; }
        store.settings.wage = C.r2(w);
        store.settings.deductionPct = Math.min(100, Math.max(0, C.r2(p || 0)));
        save();
        toast('Einstellungen gespeichert');
        break;
      }
    }
    render();
    return true;
  }

  document.querySelectorAll('[data-open]').forEach(function (b) {
    b.addEventListener('click', function () { openSheet(b.dataset.open); });
  });
  $('openSettings').addEventListener('click', function () { openSheet('sheetSettings'); });

  document.querySelectorAll('dialog.sheet').forEach(function (dlg) {
    var form = dlg.querySelector('form');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (handleSubmit(form)) dlg.close();
    });
    form.addEventListener('input', function () { updateHints(form); });
    dlg.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { dlg.close(); });
    });
    // Tippen auf den Hintergrund schließt
    dlg.addEventListener('click', function (ev) { if (ev.target === dlg) dlg.close(); });
  });

  document.querySelectorAll('.chips').forEach(function (group) {
    group.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      var form = group.closest('form');
      var input = field(form, group.dataset.target);
      var v = Number(b.value);
      if (group.dataset.mode === 'add' && v !== 0) {
        input.value = inputVal(C.r2((C.parseNum(input.value) || 0) + v));
      } else {
        input.value = v ? inputVal(v) : '';
      }
      updateHints(form);
    });
  });

  $('prevMonth').addEventListener('click', function () { currentKey = shiftMonth(currentKey, -1); logExpanded = false; render(); });
  $('nextMonth').addEventListener('click', function () { currentKey = shiftMonth(currentKey, 1); logExpanded = false; render(); });
  $('toggleLog').addEventListener('click', function () { logExpanded = !logExpanded; render(); });

  /* ---------- Export / Import / Automatik ---------- */

  $('exportBtn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'trinkgeld-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });

  $('importBtn').addEventListener('click', function () { $('importFile').click(); });
  $('importFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    file.text().then(function (txt) {
      var data = JSON.parse(txt);
      var msg = importData(data);
      $('sheetSettings').close();
      render();
      toast(msg);
    }).catch(function () { toast('Datei konnte nicht gelesen werden'); });
  });

  /**
   * Akzeptiert:
   *  1) Vollständigen Export ({ version, settings, months }) -> ersetzt alles
   *  2) Snapshot(s) für die Automatik:
   *     { month: "2026-11", worked, planned, online, cash }  (einzeln oder als Array)
   *     -> erzeugt je Monat einen Korrektur-Eintrag auf genau diesen Stand
   */
  function importData(data) {
    if (data && data.months && typeof data.months === 'object') {
      if (!confirm('Alle aktuellen Daten durch den Import ersetzen?')) return 'Import abgebrochen';
      store = Object.assign(defaultStore(), data);
      store.settings = Object.assign(defaultStore().settings, data.settings || {});
      save();
      return 'Daten importiert';
    }
    var snaps = Array.isArray(data) ? data : [data];
    var n = 0;
    snaps.forEach(function (s) { if (applySnapshot(s)) n++; });
    return n ? n + ' Stand/Stände übernommen' : 'Keine Änderungen im Import';
  }

  function applySnapshot(s) {
    if (!s || typeof s !== 'object') return null;
    var key = /^\d{4}-\d{2}$/.test(s.month || '') ? s.month : currentKey;
    var target = {
      worked: C.parseNum(s.worked != null ? s.worked : s.workedHours),
      planned: C.parseNum(s.planned != null ? s.planned : s.plannedHours),
      online: C.parseNum(s.online != null ? s.online : s.onlineTips),
      cash: C.parseNum(s.cash != null ? s.cash : s.cashTips)
    };
    var e = addEntry('import', C.deltaToTarget(entries(key), target), { source: s.source || 'import' }, key);
    return e;
  }

  // Für spätere Automatisierung (z. B. per Browser-Skript):
  // window.TGTracker.applySnapshot({ month: '2026-11', worked: 42, planned: 18, online: 96.5 })
  window.TGTracker = {
    applySnapshot: function (s) { var e = applySnapshot(s); render(); return !!e; },
    summary: function (key) { return C.summary(entries(key), store.settings); },
    exportData: function () { return JSON.parse(JSON.stringify(store)); }
  };

  $('resetMonth').addEventListener('click', function () {
    if (!confirm('Alle Einträge für ' + $('monthLabel').textContent + ' löschen?')) return;
    delete store.months[currentKey];
    save();
    $('sheetSettings').close();
    render();
    toast('Monat geleert');
  });

  render();
})();
