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
      v: 2,
      // valores neutros só para o app abrir; os reais são digitados na 1ª abertura (profile.ok) e ficam só no aparelho
      profile: { ok: false, nome: '', idade: 30, altura: 170, pesoInicial: 100, inicio: hoje, meta1: 90, metaFinal: 75, ritmo: 1.2 },
      settings: {
        apiKey: '',
        model: 'auto',
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
        falar: false,
      },
      days: {},
      weights: [],
      chat: [],
      notified: {},
    };
  }

  function emptyDay() {
    // foods = o que foi contado por voz/texto; treinos = treinos em casa e afins (ambos com estimativa da IA)
    return { meals: {}, agua: 0, refri: 0, caminhada: 0, extras: [], fissuras: [], fechou: false, foods: [], treinos: [] };
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

  /** Ajustes de versões antigas: o modelo padrão antigo não existe na API e quebrava o coach. */
  function migrate() {
    const set = state.settings;
    if (!set.model || P.MODELS_MORTOS.includes(set.model)) set.model = 'auto';
    state.v = 2;
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
    migrate();
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

  const foodsOf = (d, mealId) => d.foods.filter((f) => f.meal === mealId);
  /** Refeição feita = marcada no plano OU com algo contado por voz/texto. */
  const mealDone = (d, id) => foodsOf(d, id).length > 0 || !!(d.meals[id] && d.meals[id].done);
  /** O que foi contado vale mais que o plano: se a refeição tem itens contados, o plano marcado não soma. */
  const planCounts = (d, id) => !foodsOf(d, id).length && !!(d.meals[id] && d.meals[id].done);

  function dayStats(k) {
    const set = state.settings;
    const d = peekDay(k);
    const hoje = U.key();
    let kcal = 0, p = 0, c = 0, f = 0, done = 0, req = 0;
    for (const m of P.MEALS) {
      if (!m.opcional) req++;
      if (planCounts(d, m.id)) {
        const t = P.optTotals(m.opcoes[optIndex(k, m)]);
        kcal += t.k; p += t.p; c += t.c; f += t.f;
      }
      if (mealDone(d, m.id) && !m.opcional) done++;
    }
    for (const x of d.foods) {
      kcal += x.kcal; p += x.p; c += x.c; f += x.f;
    }
    const manualK = d.extras.reduce((a, e) => a + e.kcal, 0);
    kcal += manualK;
    // "fora do plano" = extras digitados à mão + itens que a IA (ou você) marcou como fora do plano
    const fora = d.foods.filter((x) => x.fora);
    const extrasK = Math.round(manualK + fora.reduce((a, x) => a + x.kcal, 0));
    const extrasN = d.extras.length + fora.length;

    const treinoMin = d.treinos.reduce((a, t) => a + t.min, 0);
    const treinoK = d.treinos.reduce((a, t) => a + t.kcal, 0);
    const move = d.caminhada + treinoMin;

    const closed = !!d.fechou || k < hoje;
    const parts = {
      refeicoes: req ? (40 * done) / req : 0,
      agua: 15 * U.clamp(d.agua / set.agua, 0, 1),
      caminhada: 15 * U.clamp(move / set.caminhada, 0, 1),
      refri: closed && d.refri <= set.refriMax ? 10 : 0,
      cozinha: closed && extrasN === 0 ? 20 : 0,
    };
    const hasData = done > 0 || d.foods.length > 0 || d.agua > 0 || move > 0 || extrasN > 0 || d.fechou;
    const score = hasData ? Math.round(Object.values(parts).reduce((a, b) => a + b, 0)) : null;
    const venci = d.fissuras.filter((x) => x.won).length;
    const cedi = d.fissuras.length - venci;
    return {
      kcal: Math.round(kcal), p: Math.round(p), c: Math.round(c), f: Math.round(f), done, req,
      extrasK, extrasN, treinoMin, treinoK: Math.round(treinoK), move, parts, closed, hasData, score, venci, cedi,
    };
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

  // ---- Registro por voz/texto ----------------------------------------------
  /** Refeição mais perto do horário (em minutos). Depois da cozinha fechar, vira "fora de hora". */
  function guessMeal(nowMin = U.nowMin()) {
    if (nowMin >= U.minutes(state.settings.cozinhaFecha)) return 'ex';
    let best = null;
    for (const m of P.MEALS) {
      const diff = Math.abs(U.minutes(mealTime(m)) - nowMin);
      if (!best || diff < best.diff) best = { id: m.id, diff };
    }
    return best.id;
  }

  /**
   * Grava no dia o que a IA entendeu (já revisado por você). Devolve um "recibo" com o que mudou,
   * para o botão Desfazer.
   * e = { comidas:[{meal,nome,kcal,p,c,f,fora,motivo,obs}], treinos:[{tipo,min,kcal,obs}], agua, refri, caminhada, peso }
   */
  function applyEntry(k, e, src = 'voz') {
    const d = day(k);
    const rec = { k, foods: [], treinos: [], agua: 0, refri: 0, caminhada: 0, peso: null, plano: [] };
    const ts = Date.now();
    for (const x of e.comidas || []) {
      const md = d.meals[x.meal];
      // o que você contou substitui o plano marcado daquela refeição
      if (md && md.done && !rec.plano.some((q) => q.id === x.meal)) {
        rec.plano.push({ id: x.meal, opt: md.opt, at: md.at });
        md.done = false;
        md.at = null;
      }
      const id = U.uid();
      d.foods.push({ id, ts, src, meal: x.meal, nome: x.nome, kcal: x.kcal, p: x.p, c: x.c, f: x.f, fora: !!x.fora, motivo: x.motivo || '', obs: x.obs || '' });
      rec.foods.push(id);
    }
    for (const t of e.treinos || []) {
      const id = U.uid();
      d.treinos.push({ id, ts, src, tipo: t.tipo, min: t.min, kcal: t.kcal, obs: t.obs || '' });
      rec.treinos.push(id);
    }
    if (e.agua > 0) { d.agua += e.agua; rec.agua = e.agua; }
    if (e.refri > 0) { d.refri += e.refri; rec.refri = e.refri; }
    if (e.caminhada > 0) { d.caminhada += e.caminhada; rec.caminhada = e.caminhada; }
    if (e.peso > 0) {
      const same = state.weights.find((w) => w.date === k && !w.inicial);
      if (same) {
        rec.peso = { id: same.id, prev: same.kg, novo: false };
        same.kg = e.peso;
      } else {
        const w = { id: U.uid(), date: k, kg: e.peso, cintura: null };
        state.weights.push(w);
        rec.peso = { id: w.id, prev: null, novo: true };
      }
    }
    save();
    return rec;
  }

  function undoEntry(rec) {
    const d = day(rec.k);
    d.foods = d.foods.filter((x) => !rec.foods.includes(x.id));
    d.treinos = d.treinos.filter((x) => !rec.treinos.includes(x.id));
    d.agua = Math.max(0, d.agua - rec.agua);
    d.refri = Math.max(0, d.refri - rec.refri);
    d.caminhada = Math.max(0, d.caminhada - rec.caminhada);
    for (const q of rec.plano) {
      const md = d.meals[q.id];
      if (md && !foodsOf(d, q.id).length) { md.done = true; md.at = q.at; md.opt = q.opt; }
    }
    if (rec.peso) {
      if (rec.peso.novo) state.weights = state.weights.filter((w) => w.id !== rec.peso.id);
      else {
        const w = state.weights.find((q) => q.id === rec.peso.id);
        if (w) w.kg = rec.peso.prev;
      }
    }
    save();
  }

  function removeFood(k, id) {
    const d = day(k);
    d.foods = d.foods.filter((x) => x.id !== id);
    save();
  }
  function removeTreino(k, id) {
    const d = day(k);
    d.treinos = d.treinos.filter((x) => x.id !== id);
    save();
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
    migrate();
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
    peekDay, day, mealTime, pool, optIndex, planDay, dayStats, streak, foodsOf, mealDone, planCounts,
    guessMeal, applyEntry, undoEntry, removeFood, removeTreino,
    weightsSorted, currentWeight, bmi, ma7, trend,
  };
})(window);
