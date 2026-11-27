/*
 * Rechenlogik – bewusst ohne DOM, damit sie im Browser UND in Node
 * (z. B. für die spätere lokale Automatisierung) genutzt werden kann.
 *
 * Datenmodell eines Monats: eine Liste von Einträgen. Jeder Eintrag
 * enthält nur Änderungen (Deltas). Der aktuelle Stand ist die Summe
 * aller Deltas – dadurch kann jeder Eintrag einzeln gelöscht werden.
 *
 *   { id, ts, kind, note, d: { worked, planned, online, cash } }
 */
(function (root) {
  'use strict';

  var FIELDS = ['worked', 'planned', 'online', 'cash'];

  function r2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  /* Stunden intern als Dezimalzahl, aber feiner gerundet als Geld,
     damit z. B. 3 × 0:20 exakt 1:00 ergibt. */
  function rH(n) {
    return Math.round((Number(n) || 0) * 1e6) / 1e6;
  }

  /** Stunden -> "6:30" (Stunden:Minuten) */
  function fmtHM(h) {
    var neg = h < 0;
    var m = Math.round(Math.abs(Number(h) || 0) * 60);
    return (neg ? '-' : '') + Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
  }

  /**
   * "6:30" -> 6.5, "6" -> 6, ":45" -> 0.75, "-1:15" -> -1.25.
   * Ohne colonOnly gilt auch "," bzw. "." als Trenner für Minuten
   * ("6,30" = 6:30), weil die iPhone-Zahlentastatur keinen Doppelpunkt hat.
   * Ungültig (z. B. Minuten >= 60) -> null.
   */
  function parseHours(v, colonOnly) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v == null) return null;
    var s = String(v).trim().replace(/\s|std\.?|h/gi, '');
    if (s === '') return null;
    var neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    var m = s.match(colonOnly ? /^(\d*):(\d{1,2})$/ : /^(\d*)[:,.](\d{1,2})$/);
    var h;
    if (m) {
      var mins = Number(m[2]);
      if (mins >= 60) return null;
      h = Number(m[1] || 0) + mins / 60;
    } else if (/^\d+$/.test(s)) {
      h = Number(s);
    } else if (colonOnly) {
      h = parseNum(s); // Automatik darf Dezimalzahlen als Text liefern
      if (h == null) return null;
    } else {
      return null;
    }
    h = Math.round(h * 60) / 60; // auf ganze Minuten
    return rH(neg ? -h : h);
  }

  /** "12,50" / "12.5" / " 7 " -> Zahl, sonst null */
  function parseNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v == null) return null;
    var s = String(v).trim().replace(/\s|€|h/g, '').replace(',', '.');
    if (s === '' || s === '-' || s === '.') return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function totals(entries) {
    var t = { worked: 0, planned: 0, online: 0, cash: 0 };
    (entries || []).forEach(function (e) {
      FIELDS.forEach(function (f) {
        t[f] += Number(e.d && e.d[f]) || 0;
      });
    });
    t.worked = rH(t.worked);
    t.planned = rH(t.planned);
    t.online = r2(t.online);
    t.cash = r2(t.cash);
    return t;
  }

  /**
   * Alle Kennzahlen für die Anzeige.
   * settings: { wage: 14, deductionPct: 0 }
   */
  function summary(entries, settings) {
    var t = totals(entries);
    var wage = Number(settings && settings.wage) || 0;
    var factor = 1 - (Number(settings && settings.deductionPct) || 0) / 100;

    var tips = t.online + t.cash;
    var payNow = t.worked * wage * factor;
    var tipPerHour = t.worked > 0 ? tips / t.worked : 0;
    var totalHours = t.worked + t.planned;
    var payMonth = totalHours * wage * factor;
    var projectedTips = t.worked > 0 ? tipPerHour * totalHours : tips;

    return {
      worked: t.worked,
      planned: t.planned,
      online: t.online,
      cash: t.cash,
      tips: r2(tips),
      tipPerHour: r2(tipPerHour),
      // Aktuell
      payNow: r2(payNow),                       // ohne Trinkgeld
      totalNow: r2(payNow + tips),              // mit Trinkgeld
      // Prognose Monatsende
      totalHours: rH(totalHours),
      payMonth: r2(payMonth),                   // ohne Trinkgeld
      forecastCurrentTips: r2(payMonth + tips), // mit bisherigem Trinkgeld
      projectedTips: r2(projectedTips),
      forecastProjected: r2(payMonth + projectedTips), // mit hochgerechnetem TG
      progress: totalHours > 0 ? t.worked / totalHours : 0
    };
  }

  /**
   * Erzeugt die Deltas, um vom aktuellen Stand auf einen Ziel-Stand zu
   * kommen (für "Stand eintragen", Online-Gesamtstand & Automatisierung).
   * target: beliebige Teilmenge von { worked, planned, online, cash }
   */
  function deltaToTarget(entries, target) {
    var t = totals(entries);
    var d = {};
    FIELDS.forEach(function (f) {
      if (target && target[f] != null && isFinite(target[f])) {
        var diff = (f === 'worked' || f === 'planned') ? rH(target[f] - t[f]) : r2(target[f] - t[f]);
        if (diff !== 0) d[f] = diff;
      }
    });
    return d;
  }

  /**
   * Deltas für eine Schicht. Gearbeitete Stunden werden optional von den
   * geplanten Stunden abgezogen (nie unter 0).
   * shift: { hours, cash, onlineTotal (optional, neuer Gesamtstand), fromPlan }
   */
  function shiftDelta(entries, shift) {
    var t = totals(entries);
    var d = {};
    var h = Number(shift.hours) || 0;
    if (h) d.worked = rH(h);
    if (shift.fromPlan && h > 0 && t.planned > 0) {
      d.planned = -rH(Math.min(h, t.planned));
    }
    var c = Number(shift.cash) || 0;
    if (c) d.cash = r2(c);
    if (shift.onlineTotal != null && isFinite(shift.onlineTotal)) {
      var od = r2(shift.onlineTotal - t.online);
      if (od !== 0) d.online = od;
    }
    return d;
  }

  function isEmptyDelta(d) {
    return !FIELDS.some(function (f) { return d[f]; });
  }

  var api = {
    FIELDS: FIELDS,
    r2: r2,
    rH: rH,
    fmtHM: fmtHM,
    parseHours: parseHours,
    parseNum: parseNum,
    totals: totals,
    summary: summary,
    deltaToTarget: deltaToTarget,
    shiftDelta: shiftDelta,
    isEmptyDelta: isEmptyDelta
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TGCalc = api;
})(this);
