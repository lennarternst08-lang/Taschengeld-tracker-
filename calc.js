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
    FIELDS.forEach(function (f) { t[f] = r2(t[f]); });
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
      totalHours: r2(totalHours),
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
        var diff = r2(target[f] - t[f]);
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
    if (h) d.worked = r2(h);
    if (shift.fromPlan && h > 0 && t.planned > 0) {
      d.planned = -r2(Math.min(h, t.planned));
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
