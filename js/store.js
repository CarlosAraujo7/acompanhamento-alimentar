/* Estado do app: persistência em localStorage + cálculos (pontos do dia, sequência, peso). */
(function (g) {
  'use strict';
  const U = g.U;
  const P = g.PlanData;
  const KEY = 'plano-emagrecer-v1';
  const SCORE_OK = 80; // pontos mínimos para contar na sequência

  let state = null;

  function defaults() {
    const hoje = U.key();
    return {
      v: 1,
      // valores neutros só para o app abrir; os reais são digitados na 1ª abertura (profile.ok) e ficam só no aparelho
      profile: { ok: false, nome: '', idade: 30, altura: 170, pesoInicial: 100, inicio: hoje, meta1: 90, metaFinal: 75, ritmo: 1.2 },
      settings: {
        apiKey: '',
        model: P.MODELS[0],
        kcal: P.TARGETS.kcal,
        proteina: P.TARGETS.proteina,
        carbo: P.TARGETS.carbo,
        agua: P.TARGETS.agua,
        caminhada: P.TARGETS.caminhada,
        refriMax: P.TARGETS.refriMax,
        cozinhaFecha: P.TARGETS.cozinhaFecha,
        horarios: Object.fromEntries(P.MEALS.map((m) => [m.id, m.hora])),
        lowcarb: false,
        notif: false,
        tema: 'auto',
        sobreMim: '',
      },
      days: {},
      weights: [],
      chat: [],
      notified: {},
    };
  }

  function emptyDay() {
    return { meals: {}, agua: 0, refri: 0, caminhada: 0, extras: [], fissuras: [], fechou: false };
  }

  function deepMerge(base, extra) {
    for (const k of Object.keys(extra || {})) {
      const a = base[k];
      const b = extra[k];
      if (b && typeof b === 'object' && !Array.isArray(b) && a && typeof a === 'object' && !Array.isArray(a)) deepMerge(a, b);
      else base[k] = b;
    }
    return base;
  }

  function syncSeed() {
    let e = state.weights.find((w) => w.inicial);
    if (!e) {
      e = { id: 'inicio', inicial: true };
      state.weights.push(e);
    }
    e.date = state.profile.inicio;
    e.kg = state.profile.pesoInicial;
  }

  function load() {
    const base = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) deepMerge(base, JSON.parse(raw));
    } catch (e) {
      console.warn('Estado salvo ilegível; começando do zero.', e);
    }
    state = base;
    for (const k of Object.keys(state.days)) state.days[k] = Object.assign(emptyDay(), state.days[k]);
    syncSeed();
    return state;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Não foi possível salvar.', e);
    }
  }

  // ---- Dias ----------------------------------------------------------------
  const EMPTY = Object.freeze(emptyDay());
  const peekDay = (k) => state.days[k] || EMPTY;
  const day = (k) => state.days[k] || (state.days[k] = emptyDay());

  const mealTime = (m) => state.settings.horarios[m.id] || m.hora;

  function pool(meal) {
    const all = meal.opcoes.map((_, i) => i);
    if (!state.settings.lowcarb) return all;
    const sc = all.filter((i) => meal.opcoes[i].sc);
    return sc.length ? sc : all;
  }

  /** Opção escolhida (ou a sugerida do dia, que gira para dar variedade). */
  function optIndex(k, meal) {
    const md = peekDay(k).meals[meal.id];
    if (md && Number.isInteger(md.opt) && meal.opcoes[md.opt]) return md.opt;
    const pl = pool(meal);
    const n = U.diffDays(state.profile.inicio, k) + P.MEALS.indexOf(meal) * 2;
    return pl[((n % pl.length) + pl.length) % pl.length];
  }

  function planDay(k) {
    return U.diffDays(state.profile.inicio, k) + 1;
  }

  function dayStats(k) {
    const set = state.settings;
    const d = peekDay(k);
    const hoje = U.key();
    let kcal = 0, p = 0, c = 0, f = 0, done = 0, req = 0;
    for (const m of P.MEALS) {
      if (!m.opcional) req++;
      const md = d.meals[m.id];
      if (md && md.done) {
        const t = P.optTotals(m.opcoes[optIndex(k, m)]);
        kcal += t.k; p += t.p; c += t.c; f += t.f;
        if (!m.opcional) done++;
      }
    }
    const extrasK = d.extras.reduce((a, e) => a + e.kcal, 0);
    kcal += extrasK;

    const closed = !!d.fechou || k < hoje;
    const parts = {
      refeicoes: req ? (40 * done) / req : 0,
      agua: 15 * U.clamp(d.agua / set.agua, 0, 1),
      caminhada: 15 * U.clamp(d.caminhada / set.caminhada, 0, 1),
      refri: closed && d.refri <= set.refriMax ? 10 : 0,
      cozinha: closed && d.extras.length === 0 ? 20 : 0,
    };
    const hasData = done > 0 || d.agua > 0 || d.caminhada > 0 || d.extras.length > 0 || d.fechou;
    const score = hasData ? Math.round(Object.values(parts).reduce((a, b) => a + b, 0)) : null;
    const venci = d.fissuras.filter((x) => x.won).length;
    const cedi = d.fissuras.length - venci;
    return { kcal, p, c, f, done, req, extrasK, parts, closed, hasData, score, venci, cedi };
  }

  function streak() {
    const hoje = U.key();
    let k = hoje;
    const s0 = dayStats(k).score;
    if (s0 == null || s0 < SCORE_OK) k = U.addDays(k, -1);
    let n = 0;
    for (let i = 0; i < 400 && k >= state.profile.inicio; i++) {
      const sc = dayStats(k).score;
      if (sc != null && sc >= SCORE_OK) {
        n++;
        k = U.addDays(k, -1);
      } else break;
    }
    return n;
  }

  // ---- Peso ----------------------------------------------------------------
  function weightsSorted() {
    return state.weights
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.inicial ? -1 : b.inicial ? 1 : 0));
  }
  const currentWeight = () => {
    const w = weightsSorted();
    return w[w.length - 1];
  };
  const bmi = (kg) => kg / Math.pow(state.profile.altura / 100, 2);

  /** Média móvel de 7 dias (suaviza oscilação de água). */
  function ma7(k) {
    const lo = U.addDays(k, -6);
    const a = weightsSorted().filter((w) => w.date >= lo && w.date <= k);
    return a.length ? a.reduce((s, w) => s + w.kg, 0) / a.length : null;
  }

  /** Tendência em kg/semana (negativo = perdendo), por regressão nos últimos 28 dias. */
  function trend() {
    const w = weightsSorted();
    if (w.length < 3) return null;
    const lo = U.addDays(w[w.length - 1].date, -28);
    const pts = w.filter((x) => x.date >= lo).map((x) => [U.diffDays(w[0].date, x.date), x.kg]);
    if (pts.length < 3 || pts[pts.length - 1][0] - pts[0][0] < 6) return null;
    const n = pts.length;
    const mx = pts.reduce((s, q) => s + q[0], 0) / n;
    const my = pts.reduce((s, q) => s + q[1], 0) / n;
    const den = pts.reduce((s, q) => s + (q[0] - mx) ** 2, 0);
    return den ? (pts.reduce((s, q) => s + (q[0] - mx) * (q[1] - my), 0) / den) * 7 : null;
  }

  // ---- Backup --------------------------------------------------------------
  function exportJSON() {
    const copy = JSON.parse(JSON.stringify(state));
    copy.settings.apiKey = ''; // a chave nunca vai para o arquivo de backup
    delete copy.chat;
    return JSON.stringify(copy, null, 2);
  }

  function importJSON(text) {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !data.profile || !data.days || !Array.isArray(data.weights)) {
      throw new Error('Arquivo de backup inválido.');
    }
    const keepKey = state.settings.apiKey;
    const base = defaults();
    deepMerge(base, data);
    if (!base.settings.apiKey) base.settings.apiKey = keepKey;
    state = base;
    for (const k of Object.keys(state.days)) state.days[k] = Object.assign(emptyDay(), state.days[k]);
    syncSeed();
    save();
  }

  function reset() {
    try {
      localStorage.removeItem(KEY);
    } catch (e) {
      /* ignore */
    }
  }

  g.Store = {
    SCORE_OK,
    load, save, reset, exportJSON, importJSON, syncSeed,
    get state() { return state; },
    peekDay, day, mealTime, pool, optIndex, planDay, dayStats, streak,
    weightsSorted, currentWeight, bmi, ma7, trend,
  };
})(window);
