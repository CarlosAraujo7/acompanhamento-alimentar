/* Interface do app: telas, ações, modais, coach e lembretes. */
(function () {
  'use strict';
  const { U, PlanData: P, Store: S, Charts: C, Gemini: G, ICS } = window;
  const esc = U.esc;
  const $ = (sel, root = document) => root.querySelector(sel);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const TABS = ['hoje', 'progresso', 'plano', 'coach', 'ajustes'];
  const ui = {
    tab: 'hoje', today: U.key(), date: U.key(), chatBusy: false, chatError: '', chatDetail: '', chatStatus: '', installEvt: null, timer: null,
    lock: false, // tela de primeiros passos: não pode ser dispensada
    sticky: false, // gravando/enviando voz: tocar fora ou Esc não fecha
    enter: true, // anima a entrada dos cards ao abrir/trocar de aba
    fx: {}, // último valor de cada anel/barra/número, para animar a mudança
    hintI: 0, toastFn: null, closeHooks: [],
  };
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const buzz = (ms = 12) => {
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {
      /* ignore */
    }
  };

  // ===========================================================================
  // Utilidades de UI
  // ===========================================================================
  /** Aviso rápido. Com `act` = { label, fn } mostra um botão (ex.: Desfazer) e fica mais tempo. */
  function toast(msg, act) {
    const t = $('#toast');
    ui.toastFn = act ? act.fn : null;
    t.innerHTML = `<span>${esc(msg)}</span>${act ? `<button class="toast-act" data-action="toast-act">${esc(act.label)}</button>` : ''}`;
    t.classList.toggle('act', !!act);
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), act ? 7000 : Math.min(9000, Math.max(2800, String(msg).length * 55)));
  }

  /** Chuva rápida de emojis para comemorar uma meta. */
  function celebrate(emojis = ['🎉', '✨', '💧', '🔥']) {
    if (reduceMotion()) return;
    const root = document.body;
    for (let i = 0; i < 14; i++) {
      const el = document.createElement('span');
      el.className = 'pf';
      el.textContent = emojis[i % emojis.length];
      const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
      const dist = 90 + Math.random() * 90;
      el.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
      el.style.setProperty('--dy', `${Math.sin(a) * dist - 40}px`);
      el.style.setProperty('--rot', `${Math.round(Math.random() * 360 - 180)}deg`);
      root.appendChild(el);
      setTimeout(() => el.remove(), 1300);
    }
  }

  function stopTimer() {
    if (ui.timer) {
      clearInterval(ui.timer.iv);
      ui.timer = null;
    }
  }
  function runCloseHooks() {
    const hooks = ui.closeHooks;
    ui.closeHooks = [];
    hooks.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.warn(e);
      }
    });
  }
  function openModal(html) {
    stopTimer();
    runCloseHooks();
    ui.sticky = false;
    $('#modal-root').innerHTML = `<div class="overlay"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  }
  function closeModal(force) {
    if (ui.lock && !force) return; // a tela de primeiros passos não pode ser dispensada
    stopTimer();
    runCloseHooks();
    ui.sticky = false;
    $('#modal-root').innerHTML = '';
  }
  /** Fechar por toque fora/Esc: respeita o modo "sticky" (gravação em andamento). */
  const dismissModal = () => (ui.sticky ? undefined : closeModal());

  // ---- Temas de cor ---------------------------------------------------------
  // [id, nome, fundo, cartão, acento] — só para a pré-visualização; as cores reais estão no CSS
  const THEMES = [
    ['auto', 'Automático', 'linear-gradient(135deg,#0f1115 50%,#f5f6f8 50%)', '#7aa7ff', '#2f5bea'],
    ['grafite', 'Grafite', '#0f1115', '#171a21', '#7aa7ff'],
    ['claro', 'Claro', '#f5f6f8', '#ffffff', '#2f5bea'],
    ['oled', 'Preto', '#000000', '#0e0e12', '#a78bfa'],
    ['quente', 'Quente', '#14100d', '#1e1813', '#fb923c'],
    ['oceano', 'Oceano', '#0a1420', '#111f30', '#22d3ee'],
  ];
  function applyTheme() {
    const t = S.state.settings.tema || 'auto';
    document.documentElement.setAttribute('data-theme', t);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    const meta = $('meta[name="theme-color"]');
    if (meta && bg) meta.setAttribute('content', bg);
  }

  const getPath = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), S.state);
  function setPath(path, val) {
    const ks = path.split('.');
    const last = ks.pop();
    ks.reduce((o, k) => o[k], S.state)[last] = val;
  }

  const mealById = (id) => P.MEALS.find((m) => m.id === id);
  const macroLine = (t) => `<b>${t.k} kcal</b> · P ${t.p} g · C ${t.c} g · G ${t.f} g`;
  const fmtDay = (k) => cap(U.parse(k).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));

  function persist(rerender = true) {
    S.save();
    if (rerender) render();
  }

  // ===========================================================================
  // Feedback local (funciona sem internet e sem chave)
  // ===========================================================================
  function localFeedback(k) {
    const set = S.state.settings;
    const d = S.peekDay(k);
    const s = S.dayStats(k);
    const isToday = k === U.key();
    const nowM = U.nowMin();
    const out = [];
    const add = (tone, text) => out.push({ tone, text });

    if (!s.hasData) {
      add('', isToday ? 'Nada registrado ainda. Primeiro passo: 500 ml de água e a primeira refeição no horário.' : 'Sem registros neste dia.');
      return out;
    }
    const pend = P.MEALS.filter((m) => !m.opcional && !S.mealDone(d, m.id));
    const late = isToday ? pend.filter((m) => nowM > U.minutes(S.mealTime(m)) + 45) : pend;
    if (s.done === s.req) add('good', 'Todas as refeições planejadas foram feitas.');
    else if (late.length) {
      add('bad', `${isToday ? 'Atrasada' : 'Não feita'}${late.length > 1 ? 's' : ''}: ${late.map((m) => m.nome.toLowerCase()).join(', ')}. ${isToday ? 'Faça a refeição planejada agora — não pule nem junte duas.' : 'Sem compensar: siga o plano no próximo horário.'}`);
    } else add('', `${s.done}/${s.req} refeições feitas. Mantenha os horários.`);

    if (s.done === s.req || !isToday) {
      if (s.p >= set.proteina * 0.9) add('good', `Proteína ${s.p} g: meta batida.`);
      else add('bad', `Proteína ${s.p} g de ${set.proteina} g. Faltaram ~${Math.round(set.proteina - s.p)} g: comece a próxima refeição pela proteína.`);
    }
    if (s.extrasN > 0) {
      add('bad', `${s.extrasK} kcal fora do plano (${s.extrasN} registro${s.extrasN > 1 ? 's' : ''}). Não compense: a próxima refeição é normal.`);
    } else if (s.kcal > set.kcal * 1.05) {
      add('bad', `${s.kcal} kcal: acima da meta de ${set.kcal}. Confira as porções (balança nas primeiras semanas).`);
    }
    if (d.agua >= set.agua) add('good', `Água: ${U.num(d.agua / 1000)} L, meta batida.`);
    else if (!isToday || U.nowMin() > 17 * 60) add('bad', `Água: ${U.num(d.agua / 1000)} L de ${U.num(set.agua / 1000)} L.`);
    if (s.move >= set.caminhada) add('good', `Movimento: ${s.move} min${s.treinoMin ? ` (${s.treinoMin} de treino)` : ''}, meta feita.`);
    else if (!isToday) add('bad', `Movimento: ${s.move} de ${set.caminhada} min.`);
    if (d.refri > set.refriMax) add('bad', `Refrigerante zero: ${d.refri} latas (limite ${set.refriMax}).`);
    if (s.venci) add('good', `${s.venci} fissura${s.venci > 1 ? 's' : ''} vencida${s.venci > 1 ? 's' : ''}. Isso é disciplina de verdade.`);
    return out.slice(0, 6);
  }

  // ===========================================================================
  // Tela: HOJE
  // ===========================================================================
  const GEAR = '<button class="iconbtn" data-action="go" data-tab="ajustes" aria-label="Ajustes"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg></button>';
  const ICON_MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3M9 21h6"/></svg>';

  function nextMeal(k) {
    if (k !== U.key()) return null;
    const d = S.peekDay(k);
    const nowM = U.nowMin();
    const closeM = U.minutes(S.state.settings.cozinhaFecha);
    const pend = P.MEALS.filter((m) => !S.mealDone(d, m.id) && !(m.opcional && nowM > closeM));
    pend.sort((a, b) => U.minutes(S.mealTime(a)) - U.minutes(S.mealTime(b)));
    // obrigatórias primeiro: a próxima ainda no horário; se todas as pendentes já passaram, cobra a mais recente
    const req = pend.filter((m) => !m.opcional);
    return req.find((m) => U.minutes(S.mealTime(m)) + 45 >= nowM) || req[req.length - 1] || pend[0] || null;
  }

  /** Linha de um alimento contado por voz/texto. */
  function foodRow(f) {
    return `<li class="frow ${f.fora ? 'out' : ''}">
      <div class="fname"><b>${esc(f.nome)}</b>${f.fora ? ' <span class="badge warn">fora do plano</span>' : ''}${f.fora && f.motivo ? `<small class="bad">${esc(f.motivo)}</small>` : ''}${f.obs ? `<small>${esc(f.obs)}</small>` : ''}</div>
      <div class="fk"><b>${Math.round(f.kcal)}</b> kcal<small>P ${Math.round(f.p)} g</small></div>
      <button class="icon-x" data-action="food-del" data-id="${f.id}" aria-label="Remover ${esc(f.nome)}">✕</button></li>`;
  }

  function mealCard(m, k) {
    const d = S.peekDay(k);
    const foods = S.foodsOf(d, m.id);
    const hasFoods = foods.length > 0;
    const planDone = S.planCounts(d, m.id);
    const done = hasFoods || planDone;
    const o = m.opcoes[S.optIndex(k, m)];
    const time = S.mealTime(m);
    const isToday = k === U.key();
    const late = isToday && !done && !m.opcional && U.nowMin() > U.minutes(time) + 45;
    const badges = (m.opcional ? '<span class="badge">opcional</span>' : '') + (late ? '<span class="badge warn">atrasada</span>' : '') + (hasFoods ? '<span class="badge ia">contado</span>' : '');
    const tick = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    const check = hasFoods
      ? `<span class="check on" aria-hidden="true">${tick}</span>`
      : `<button class="check" data-action="toggle-meal" data-id="${m.id}" aria-pressed="${planDone}" aria-label="${planDone ? 'Desmarcar' : 'Marcar como feita'}: ${esc(m.nome)}">${tick}</button>`;

    let body;
    if (hasFoods) {
      const sum = foods.reduce((a, f) => ({ k: a.k + f.kcal, p: a.p + f.p, c: a.c + f.c, f: a.f + f.f }), { k: 0, p: 0, c: 0, f: 0 });
      body = `<ul class="flist">${foods.map(foodRow).join('')}</ul>
        <div class="macro">${macroLine({ k: Math.round(sum.k), p: Math.round(sum.p), c: Math.round(sum.c), f: Math.round(sum.f) })}</div>
        <div class="mrow"><button class="btn sm" data-action="voz-open" data-meal="${m.id}">🎙️ Adicionar</button><button class="link small" data-action="pick-opt" data-id="${m.id}">ver opções do plano</button></div>`;
    } else {
      body = `<div class="opt-name">${planDone ? 'Plano' : 'Sugestão'}: ${esc(o.nome)} <button class="link small" data-action="pick-opt" data-id="${m.id}">trocar</button></div>
        <details class="mini"><summary>ver itens</summary><ul class="items">${o.itens.map((i) => `<li>${esc(i.t)}</li>`).join('')}</ul></details>
        <div class="macro">${macroLine(P.optTotals(o))}</div>
        ${planDone ? '' : `<div class="tip">${esc(m.dica)}</div>
        <div class="mrow"><button class="btn sm primary" data-action="toggle-meal" data-id="${m.id}">✓ Segui o plano</button><button class="btn sm" data-action="voz-open" data-meal="${m.id}">🎙️ Contar o que comi</button></div>`}`;
    }
    return `<article class="card meal ${done ? 'done' : ''} ${late ? 'late' : ''}">${check}
      <div class="meal-body"><div class="meal-head"><span class="time">${time}</span><h3>${m.icone} ${esc(m.nome)}</h3>${badges}</div>${body}</div></article>`;
  }

  /** Comida fora de hora (contada por voz) e extras digitados à mão. */
  function offPlanCard(k) {
    const d = S.peekDay(k);
    const ex = S.foodsOf(d, 'ex');
    if (!ex.length && !d.extras.length) return '';
    const tk = Math.round(ex.reduce((a, f) => a + f.kcal, 0) + d.extras.reduce((a, e) => a + e.kcal, 0));
    return `<section class="card"><div class="row between"><h3>🍽️ Fora de hora</h3><b class="bad">+${tk} kcal</b></div>
      ${ex.length ? `<ul class="flist">${ex.map(foodRow).join('')}</ul>` : ''}
      ${d.extras.length ? `<div class="row wrap" style="margin-top:10px">${d.extras
        .map((e, i) => `<span class="chip">${esc(e.label)} · ${e.kcal} kcal <button class="link" data-action="extra-del" data-i="${i}" aria-label="Remover">✕</button></span>`)
        .join('')}</div>` : ''}
      <p class="tiny muted" style="margin-top:8px">Sem compensar: a próxima refeição é normal.</p></section>`;
  }

  function treinosCard(k) {
    const d = S.peekDay(k);
    if (!d.treinos.length) return '';
    return `<section class="card"><div class="row between"><h3>💪 Treinos</h3><span class="tiny muted">gasto é estimativa; não vira crédito para comer</span></div>
      <ul class="flist">${d.treinos
        .map(
          (t) => `<li class="frow"><div class="fname"><b>${esc(t.tipo)}</b>${t.obs ? `<small>${esc(t.obs)}</small>` : ''}</div>
            <div class="fk"><b>${t.min}</b> min<small>~${Math.round(t.kcal)} kcal</small></div>
            <button class="icon-x" data-action="treino-del" data-id="${t.id}" aria-label="Remover treino">✕</button></li>`
        )
        .join('')}</ul></section>`;
  }

  function viewHoje() {
    const k = ui.date;
    const hoje = U.key();
    const isToday = k === hoje;
    const st = S.state;
    const set = st.settings;
    const d = S.peekDay(k);
    const s = S.dayStats(k);
    const nowM = U.nowMin();
    const h = new Date().getHours();
    const hello = !isToday ? 'Revisando o dia' : h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    const nome = st.profile.nome ? `, ${esc(st.profile.nome.split(' ')[0])}` : '';
    const pd = S.planDay(k);
    const streak = S.streak();
    const hasKey = !!set.apiKey;

    // status da cozinha
    let status = '';
    if (isToday) {
      const first = U.minutes(S.mealTime(P.MEALS[0]));
      const close = U.minutes(set.cozinhaFecha);
      if (nowM < first) status = `🌙 Jejum até ${S.mealTime(P.MEALS[0])}. Beba 500 ml de água ao acordar.`;
      else if (nowM >= close) status = '🔒 <b>Cozinha fechada.</b> Só água, chá ou gelatina zero.';
      else status = `🟢 Cozinha aberta até ${set.cozinhaFecha}.`;
    }

    // próxima refeição
    let nextHtml = '';
    if (isToday) {
      const nm = nextMeal(k);
      if (nm) {
        const diff = U.minutes(S.mealTime(nm)) - nowM;
        const when = diff > 0 ? `em ${U.fmtDur(diff)}` : diff >= -45 ? 'agora' : `atrasada há ${U.fmtDur(-diff)}`;
        const cls = diff < -45 ? 'warn' : 'good';
        nextHtml = `<div class="card next">
          <div class="eyebrow">Próxima refeição</div>
          <div class="row between"><div class="big">${nm.icone} ${esc(nm.nome)}</div><div class="${cls}"><b>${S.mealTime(nm)}</b> · ${when}</div></div>
        </div>`;
      } else {
        nextHtml = `<div class="card next"><div class="big">✅ Refeições do dia concluídas</div><div class="muted small">Agora é manter a cozinha fechada.</div></div>`;
      }
    }

    const rest = set.kcal - s.kcal;
    const over = rest < 0;
    const protRest = Math.max(0, set.proteina - s.p);
    const bar = (cls, pct, key) => {
      const w = (U.clamp(pct, 0, 1) * 100).toFixed(1);
      return `<div class="bar ${cls}"><i data-fx="${key}" data-prop="width" data-from="0%" data-to="${w}%" style="width:${w}%"></i></div>`;
    };
    const legend = (color, label, val) => `<div class="lg"><i style="background:${color}"></i><span>${label}</span><b>${val}</b></div>`;
    const kcalColor = over && s.kcal > set.kcal * 1.05 ? 'var(--bad)' : 'var(--accent)';

    const fb = localFeedback(k);

    const dateNav = k <= st.profile.inicio && isToday ? '' : `<div class="row between" style="margin:-4px 0 10px">
        <button class="btn sm ghost" data-action="date-prev" ${k <= st.profile.inicio ? 'disabled' : ''} aria-label="Dia anterior">‹ Anterior</button>
        ${isToday ? '' : '<button class="btn sm" data-action="date-today">Voltar para hoje</button>'}
        <button class="btn sm ghost" data-action="date-next" ${isToday ? 'disabled' : ''} aria-label="Próximo dia">Próximo ›</button>
      </div>`;

    const parts = s.parts;
    const breakdown = `Refeições ${Math.round(parts.refeicoes)}/40 · Água ${Math.round(parts.agua)}/15 · Movimento ${Math.round(parts.caminhada)}/15 · Refri ${parts.refri}/10 · Cozinha fechada ${parts.cozinha}/20`;

    // tiles
    const aguaPct = Math.round(U.clamp(d.agua / set.agua, 0, 1) * 100);
    const dots = Array.from({ length: Math.max(set.refriMax, d.refri) }, (_, i) => `<i class="${i < d.refri ? (i >= set.refriMax ? 'on bad' : 'on') : ''}"></i>`).join('');
    const movePct = s.move / set.caminhada;
    const hint = P.VOICE_HINTS[ui.hintI % P.VOICE_HINTS.length];

    return `<div class="stack">
      <div class="top">
        <div><div class="eyebrow">${fmtDay(k)}${pd >= 1 ? ` · dia ${pd}` : ''}</div><h1>${hello}${nome}</h1></div>
        <div class="top-r"><div class="streak" title="Dias seguidos com 80+ pontos">🔥 ${streak} <small>${streak === 1 ? 'dia' : 'dias'}</small></div>${GEAR}</div>
      </div>
      ${dateNav}

      <section class="card hero2">
        <div class="hero">
          ${C.rings(
            [
              { pct: s.kcal / set.kcal, color: kcalColor, key: 'r-kcal' },
              { pct: s.p / set.proteina, color: 'var(--good)', key: 'r-prot' },
              { pct: d.agua / set.agua, color: 'var(--info)', key: 'r-agua' },
            ],
            { big: s.score == null ? '–' : String(s.score), small: 'pontos', label: 'Calorias, proteína e água do dia' }
          )}
          <div class="hero-side">
            <div class="eyebrow">${over ? 'acima da meta' : 'ainda pode comer'}</div>
            <div class="bignum"><span data-count="${Math.abs(rest)}" data-cid="rest">${U.num(Math.abs(rest), 0)}</span> <small>kcal</small></div>
            <div class="legend2">
              ${legend(kcalColor, 'Calorias', `${U.num(s.kcal, 0)} / ${U.num(set.kcal, 0)}`)}
              ${legend('var(--good)', 'Proteína', `${s.p} / ${set.proteina} g`)}
              ${legend('var(--info)', 'Água', `${U.num(d.agua / 1000, 1)} / ${U.num(set.agua / 1000, 1)} L`)}
            </div>
          </div>
        </div>
        <div class="hero-foot">
          <div class="bar-label"><span>Carboidrato</span><b>${s.c} / ${set.carbo} g</b></div>${bar(s.c > set.carbo ? 'warn' : 'blue', s.c / set.carbo, 'b-carbo')}
          ${protRest > 0 && s.done > 0 ? `<p class="tiny muted" style="margin-top:8px">Faltam ~${Math.round(protRest)} g de proteína para a meta.</p>` : ''}
        </div>
        ${status ? `<div class="status">${status}</div>` : ''}
      </section>

      <button class="voicecta" data-action="voz-open">
        <span class="vc-mic">${ICON_MIC}</span>
        <span class="vc-txt"><b>Contar por voz</b><small id="vc-hint">${hasKey ? `“${esc(hint)}”` : 'Ative com a chave do Gemini em Ajustes'}</small></span>
        <span class="vc-go" aria-hidden="true">›</span>
      </button>

      ${nextHtml}

      <div class="bento">
        <section class="tile water">
          <div class="tile-h"><span>💧 Água</span><b>${U.num(d.agua / 1000, 2)} <small>/ ${U.num(set.agua / 1000, 1)} L</small></b></div>
          <div class="glass" role="img" aria-label="${aguaPct}% da meta de água"><div class="fill" data-fx="agua" data-prop="height" data-from="0%" data-to="${aguaPct}%" style="height:${aguaPct}%"></div><span class="glass-pct">${aguaPct}%</span></div>
          <div class="tile-actions">
            <button class="btn sm" data-action="water" data-n="200">+200</button>
            <button class="btn sm" data-action="water" data-n="500">+500</button>
            <button class="btn sm ghost" data-action="water" data-n="-200" aria-label="Tirar 200 ml">−</button>
          </div>
        </section>
        <section class="tile">
          <div class="tile-h"><span>🏃 Movimento</span></div>
          <div class="move-row">
            ${C.ring({ pct: movePct, size: 66, stroke: 8, color: 'var(--good)', big: String(s.move), small: 'min', label: 'Minutos de movimento', key: 'r-move' })}
            <div class="move-info"><span>meta ${set.caminhada} min</span><span>🚶 ${d.caminhada} · 💪 ${s.treinoMin}</span></div>
          </div>
          <div class="tile-actions">
            <button class="btn sm" data-action="walk" data-n="10">+10 caminhada</button>
            <button class="btn sm" data-action="voz-open" data-hint="treino" aria-label="Contar um treino por voz">🎙️ Treino</button>
          </div>
        </section>
        <section class="tile">
          <div class="tile-h"><span>🥤 Refri zero</span><b class="${d.refri > set.refriMax ? 'bad' : ''}">${d.refri} <small>/ ${set.refriMax}</small></b></div>
          <div class="cans">${dots}</div>
          <div class="tile-actions">
            <button class="btn sm" data-action="refri" data-n="1">+1 lata</button>
            <button class="btn sm ghost" data-action="refri" data-n="-1" aria-label="Tirar uma lata">−</button>
          </div>
        </section>
      </div>

      <div>
        <div class="sec-title"><h2>Diário de ${isToday ? 'hoje' : 'o dia'}</h2><span class="tiny muted">${s.done}/${s.req} refeições</span></div>
        ${P.MEALS.map((m) => mealCard(m, k)).join('')}
      </div>

      ${offPlanCard(k)}
      ${treinosCard(k)}

      <div class="actions3">
        <button class="btn" data-action="fissura"><span>🧊</span>Fissura</button>
        <button class="btn" data-action="extra"><span>🍽️</span>Comi fora do plano</button>
        <button class="btn" data-action="weight"><span>⚖️</span>Registrar peso</button>
      </div>

      <section class="card">
        <div class="row between"><h2>Feedback do dia</h2>${hasKey ? '<button class="btn sm" data-action="ask-day">🤖 Coach</button>' : ''}</div>
        <ul class="fb" style="margin-top:10px">${fb.map((f) => `<li class="${f.tone}">${esc(f.text)}</li>`).join('')}</ul>
      </section>

      <button class="btn block ${d.fechou ? '' : 'primary'}" data-action="close-day">${d.fechou ? '🔒 Dia encerrado · toque para reabrir' : '🔒 Encerrar o dia (cozinha fechada)'}</button>
      <details class="small muted"><summary>Como os pontos são calculados</summary><p style="margin-top:6px">${breakdown}. Refri e “cozinha fechada” só contam quando o dia é encerrado (ou já passou). Treinos somam no movimento. Itens contados que a IA marcou como “fora do plano” tiram os pontos de cozinha fechada. Sequência = dias seguidos com 80+ pontos.</p></details>
    </div>`;
  }
  // ===========================================================================
  // Tela: PROGRESSO
  // ===========================================================================
  function etaInfo(kg) {
    const pr = S.state.profile;
    const need = kg - pr.meta1;
    if (need <= 0) return { done: true };
    const tr = S.trend();
    const real = tr != null && tr < -0.1;
    // o ritmo real inicial é inflado pela perda de água: limita a um valor sustentável na previsão
    const rate = real ? U.clamp(-tr, 0.3, Math.max(pr.ritmo * 1.5, 1.5)) : pr.ritmo;
    const weeks = need / rate;
    return { weeks, rate, basis: real ? 'seu ritmo real' : 'o ritmo planejado', date: U.addDays(U.key(), Math.ceil(weeks * 7)) };
  }

  function viewProgresso() {
    const st = S.state;
    const pr = st.profile;
    const ws = S.weightsSorted();
    const cur = ws[ws.length - 1];
    const prev = ws.length > 1 ? ws[ws.length - 2] : null;
    const lost = pr.pesoInicial - cur.kg;
    const lostPct = (lost / pr.pesoInicial) * 100;
    const delta = prev ? cur.kg - prev.kg : null;
    const tr = S.trend();
    const faseTotal = pr.pesoInicial - pr.meta1;
    const faseProg = faseTotal > 0 ? U.clamp(lost / faseTotal, 0, 1) : 0;
    const eta = etaInfo(cur.kg);
    const hoje = U.key();

    // resumo de 7 dias
    let n = 0, sumScore = 0, sumK = 0, sumP = 0, aguaOk = 0, walk = 0, venci = 0, cedi = 0, daysFull = 0;
    for (let i = 0; i < 7; i++) {
      const k = U.addDays(hoje, -i);
      if (k < pr.inicio) continue;
      const s = S.dayStats(k);
      const d = S.peekDay(k);
      if (!s.hasData) continue;
      n++;
      sumScore += s.score;
      sumK += s.kcal;
      sumP += s.p;
      if (d.agua >= st.settings.agua) aguaOk++;
      walk += s.move;
      venci += s.venci;
      cedi += s.cedi;
      if (s.done === s.req) daysFull++;
    }
    const avg = (v) => (n ? Math.round(v / n) : '–');

    // marcos
    const min = Math.min(...ws.map((w) => w.kg));
    const marks = [];
    for (let t = Math.floor((pr.pesoInicial - 0.01) / 10) * 10; t > pr.metaFinal; t -= 10) marks.push(t);
    marks.push(pr.metaFinal);
    const nextMark = marks.find((t) => min > t);
    const markHtml = marks
      .map((t) => `<span class="ms ${min <= t ? 'got' : t === nextMark ? 'next' : ''}">${t} kg${min <= t ? ' ✓' : ''}</span>`)
      .join('');

    const hist = ws
      .slice()
      .reverse()
      .map(
        (w) => `<li><span>${U.dateLabel(w.date, { day: '2-digit', month: '2-digit', year: '2-digit' })}${w.inicial ? ' <span class="badge">inicial</span>' : ''}</span>
          <span><b>${U.num(w.kg)} kg</b>${w.cintura ? ` · cintura ${U.num(w.cintura)} cm` : ''}</span>
          ${w.inicial ? '<span></span>' : `<button class="link bad" data-action="weight-del" data-id="${w.id}" aria-label="Apagar">apagar</button>`}</li>`
      )
      .join('');

    return `<div class="stack">
      <div class="top"><div><div class="eyebrow">Desde ${U.dateLabel(pr.inicio, { day: '2-digit', month: 'long' })}</div><h1>Progresso</h1></div>
        <div class="top-r"><button class="btn sm primary" data-action="weight">⚖️ Pesar</button>${GEAR}</div></div>

      <div class="grid2">
        <div class="stat"><div class="l">Peso atual</div><div class="v">${U.num(cur.kg)} <small>kg</small></div>
          <div class="d ${delta == null ? 'muted' : delta <= 0 ? 'good' : 'bad'}">${delta == null ? 'primeira pesagem' : (delta > 0 ? '+' : '') + U.num(delta) + ' kg desde a anterior'}</div></div>
        <div class="stat"><div class="l">Perdido</div><div class="v">${U.num(Math.max(lost, -999))} <small>kg</small></div>
          <div class="d muted">${U.num(lostPct)}% do peso inicial</div></div>
        <div class="stat"><div class="l">IMC</div><div class="v">${U.num(S.bmi(cur.kg))}</div>
          <div class="d muted">início: ${U.num(S.bmi(pr.pesoInicial))}</div></div>
        <div class="stat"><div class="l">Ritmo real</div><div class="v">${tr == null ? '–' : U.num(Math.abs(tr), 2)} <small>kg/sem</small></div>
          <div class="d muted">${tr == null ? 'precisa de 3+ pesagens' : tr < 0 ? 'perdendo' : 'sem queda'} · plano ${U.num(pr.ritmo)}</div></div>
      </div>

      <section class="card">
        <div class="row between"><h2>Fase 1 · ${U.num(pr.meta1)} kg</h2><b>${Math.round(faseProg * 100)}%</b></div>
        <div class="bar" style="margin-top:10px"><i style="width:${faseProg * 100}%"></i></div>
        <p class="small muted" style="margin-top:8px">${
          eta.done
            ? '🎉 Meta da fase 1 atingida!'
            : `Faltam <b class="${''}">${U.num(cur.kg - pr.meta1)} kg</b>. Mantendo ${eta.basis} (${U.num(eta.rate, 2)} kg/sem): ~${Math.ceil(eta.weeks)} semanas, por volta de <b>${U.dateLabel(eta.date, { day: '2-digit', month: 'long' })}</b>.`
        }</p>
      </section>

      <section class="card">
        <h2>Peso ao longo do tempo</h2>
        ${C.weightChart()}
        <div class="legend"><span><i></i>média 7 dias</span><span><i class="p"></i>ritmo planejado</span><span><i class="m"></i>meta fase 1</span></div>
        <p class="tiny muted" style="margin-top:6px">Pese-se sempre no mesmo horário (ao acordar, após o banheiro). O peso oscila 1–2 kg por água: olhe a linha verde, não o ponto isolado.</p>
      </section>

      <section class="card">
        <h2>Calorias dos últimos 7 dias</h2>
        <div style="margin-top:6px">${C.weekBars()}</div>
        <p class="tiny muted" style="margin-top:4px">Verde: 80+ pontos · amarelo: 50–79 · vermelho: abaixo de 50 ou acima da meta. A linha tracejada é a meta.</p>
      </section>

      <section class="card">
        <h2>Últimos 7 dias</h2>
        <div class="kv" style="margin-top:10px">
          <span>Pontos médios</span><span>${avg(sumScore)} / 100</span>
          <span>Dias com todas as refeições</span><span>${daysFull} / ${n || 0}</span>
          <span>Calorias médias</span><span>${avg(sumK)} kcal</span>
          <span>Proteína média</span><span>${avg(sumP)} g</span>
          <span>Dias com meta de água</span><span>${aguaOk} / ${n || 0}</span>
          <span>Movimento total (caminhada + treino)</span><span>${walk} min</span>
          <span>Fissuras vencidas / cedeu</span><span>${venci} / ${cedi}</span>
        </div>
        ${st.settings.apiKey ? '<button class="btn block" style="margin-top:12px" data-action="ask-week">🤖 Análise da semana com o coach</button>' : ''}
      </section>

      <section class="card"><h2>Adesão (5 semanas)</h2><div style="margin-top:10px">${C.heatmap()}</div>
        <p class="tiny muted" style="margin-top:8px">Verde: 80+ pontos · amarelo: 50–79 · vermelho: abaixo de 50.</p></section>

      <section class="card"><h2>Marcos de peso</h2><div class="milestones" style="margin-top:10px">${markHtml}</div></section>

      <details class="acc"><summary>Histórico de pesagens</summary><div class="inner"><ul class="wlist">${hist}</ul></div></details>
    </div>`;
  }

  // ===========================================================================
  // Tela: PLANO
  // ===========================================================================
  function viewPlano() {
    const set = S.state.settings;
    const req = P.MEALS.filter((m) => !m.opcional);
    const range = (key, fn) => fn(...req.map((m) => fn(...m.opcoes.map((o) => P.optTotals(o)[key]))));
    const sumMin = req.reduce((a, m) => a + Math.min(...m.opcoes.map((o) => P.optTotals(o).k)), 0);
    const sumMax = req.reduce((a, m) => a + Math.max(...m.opcoes.map((o) => P.optTotals(o).k)), 0);
    void range;

    const mealsHtml = P.MEALS.map(
      (m) => `<div style="margin-top:14px"><h3>${m.icone} ${esc(m.nome)} · ${S.mealTime(m)}</h3><p class="tip">${esc(m.dica)}</p>
        ${m.opcoes
          .map((o) => {
            const t = P.optTotals(o);
            return `<div class="opt"><b>${esc(o.nome)}</b> ${o.sc ? '<span class="badge">sem carbo de prato</span>' : ''}
              <ul class="items">${o.itens.map((i) => `<li>${esc(i.t)}</li>`).join('')}</ul><div class="macro">${macroLine(t)}</div></div>`;
          })
          .join('')}</div>`
    ).join('');

    const ul = (arr) => `<ul class="pill-list">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;

    return `<div class="stack">
      <div class="top"><div><div class="eyebrow">Seu plano restrito</div><h1>Plano</h1></div><div class="top-r">${GEAR}</div></div>

      <section class="card">
        <div class="kv">
          <span>Meta de calorias</span><span>~${U.num(set.kcal, 0)} kcal</span>
          <span>Faixa real (4 refeições)</span><span>${U.num(sumMin, 0)}–${U.num(sumMax, 0)} kcal</span>
          <span>Proteína</span><span>~${set.proteina} g</span>
          <span>Carboidrato</span><span>até ${set.carbo} g</span>
          <span>Água</span><span>${U.num(set.agua / 1000, 1)} L</span>
          <span>Caminhada</span><span>${set.caminhada} min</span>
          <span>Cozinha fecha</span><span>${set.cozinhaFecha}</span>
        </div>
        <p class="small muted" style="margin-top:10px">Modo ${set.lowcarb ? '<b>low-carb estrito</b> (só opções sem carboidrato de prato)' : 'padrão (carboidrato de prato no café e no almoço)'} · mude em Ajustes.</p>
      </section>

      <details class="acc" open><summary>Regras de ouro</summary><div class="inner"><ol class="rules">${P.REGRAS.map(([t, d]) => `<li><b>${esc(t)}</b> ${esc(d)}</li>`).join('')}</ol></div></details>
      <details class="acc"><summary>Refeições e opções</summary><div class="inner">${mealsHtml}</div></details>
      <details class="acc"><summary>O que pode, o que limitar, o que fica fora</summary><div class="inner">
        <h3 class="good">À vontade</h3>${ul(P.LIVRES)}
        <h3 class="warn" style="margin-top:14px">Com limite</h3>${ul(P.LIMITADOS)}
        <h3 class="bad" style="margin-top:14px">Fora do plano</h3>${ul(P.FORA)}</div></details>
      <details class="acc"><summary>Lista de compras (1 semana)</summary><div class="inner">
        ${P.COMPRAS.map((c) => `<h3 style="margin-top:10px">${esc(c.cat)}</h3>${ul(c.itens)}`).join('')}
        <p class="tiny muted" style="margin-top:10px">Quantidades aproximadas para 7 dias; ajuste conforme as opções que você escolher.</p></div></details>
      <details class="acc"><summary>Protocolo anti-fissura</summary><div class="inner"><ol class="rules">${P.PROTOCOLO.map((p) => `<li>${esc(p)}</li>`).join('')}</ol></div></details>
      <details class="acc"><summary>Movimento</summary><div class="inner">${ul(P.MOVIMENTO)}</div></details>
      <details class="acc"><summary>Saúde, exames e sinais de alerta</summary><div class="inner">
        <h3>Exames para pedir ao médico</h3>${ul(P.SAUDE.exames)}
        <h3 class="bad" style="margin-top:14px">Procure atendimento se houver</h3>${ul(P.SAUDE.alertas)}
        <h3 style="margin-top:14px">Observações</h3>${ul(P.SAUDE.notas)}</div></details>
      <details class="acc"><summary>Como a meta foi calculada</summary><div class="inner"><p class="small">${esc(P.CALCULO.texto(S.currentWeight().kg, S.state.profile.altura, S.state.profile.idade, set.kcal))}</p></div></details>
    </div>`;
  }

  // ===========================================================================
  // Tela: COACH (Gemini)
  // ===========================================================================
  function chatHTML() {
    const st = S.state;
    let h = '';
    if (!st.chat.length && !ui.chatBusy) {
      h += `<div class="card flat small"><b>Coach com IA (Gemini).</b> Ele enxerga seu plano, o que você contou hoje, os últimos 7 dias e seus pesos. Pergunte, peça troca de refeição, desabafe uma fissura ou peça a análise do dia. Toque no 🎙️ para falar em vez de digitar.<br><span class="muted">Não substitui médico ou nutricionista.</span></div>`;
    }
    for (const m of st.chat) {
      if (m.role === 'user') h += `<div class="bubble user">${esc(m.text).replace(/\n/g, '<br>')}</div>`;
      else if (m.role === 'model') h += `<div class="bubble model">${U.md(m.text)}<button class="bubble-say" data-action="speak" data-ts="${m.ts}" aria-label="Ouvir resposta">🔊</button></div>`;
    }
    if (ui.chatBusy) h += `<div class="bubble model typing"><span></span><span></span><span></span></div>${ui.chatStatus ? `<div class="tiny muted chat-status">${esc(ui.chatStatus)}</div>` : ''}`;
    if (ui.chatError) {
      h += `<div class="bubble err small">⚠️ ${esc(ui.chatError)}
        ${ui.chatDetail ? `<details class="tiny"><summary>Detalhes técnicos</summary><pre>${esc(ui.chatDetail)}</pre></details>` : ''}
        <div class="row wrap" style="margin-top:8px">
          ${st.chat.length && st.chat[st.chat.length - 1].role === 'user' ? '<button class="btn sm" data-action="coach-retry">↻ Tentar de novo</button>' : ''}
          <button class="btn sm ghost" data-action="diagnose">Diagnóstico</button>
        </div></div>`;
    }
    return h;
  }

  function viewCoach() {
    const set = S.state.settings;
    return `<div class="stack coach">
      <div class="top"><div><div class="eyebrow">Gemini · ${esc(ui.lastModel || (set.model === 'auto' ? 'modelo automático' : set.model))}</div><h1>Coach</h1></div>
        <div class="top-r">${S.state.chat.length ? '<button class="btn sm ghost" data-action="coach-clear">Limpar</button>' : ''}${GEAR}</div></div>
      ${
        set.apiKey
          ? ''
          : `<div class="card"><b>Falta a chave do Gemini.</b><p class="small muted" style="margin:6px 0 10px">Crie uma em aistudio.google.com/apikey e cole em Ajustes. Ela fica só neste aparelho.</p><button class="btn primary" data-action="go" data-tab="ajustes">Abrir Ajustes</button></div>`
      }
      <div class="chat" id="chat">${chatHTML()}</div>
      <div class="quick">${P.QUICK_PROMPTS.map((q, i) => `<button class="chip" data-action="coach-quick" data-i="${i}">${esc(q.length > 38 ? q.slice(0, 36) + '…' : q)}</button>`).join('')}</div>
      <form class="composer" data-form="coach">
        <button class="btn micbtn" type="button" data-action="voz-coach" aria-label="Falar com o coach">${ICON_MIC}</button>
        <textarea id="coach-input" rows="1" placeholder="Pergunte ou desabafe…" aria-label="Mensagem para o coach"></textarea>
        <button class="btn primary" type="submit" ${ui.chatBusy ? 'disabled' : ''}>Enviar</button>
      </form>
    </div>`;
  }

  function renderChat(quiet) {
    const el = $('#chat');
    if (!el || ui.tab !== 'coach') return;
    el.innerHTML = chatHTML();
    const btn = $('.composer .btn.primary');
    if (btn) btn.disabled = ui.chatBusy;
    if (!quiet) window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  /** Envia ao coach. `retry` refaz o último pedido sem duplicar a mensagem. */
  async function sendToCoach(text, opts = {}) {
    if (ui.chatBusy) return;
    const st = S.state;
    if (opts.retry) {
      const last = st.chat[st.chat.length - 1];
      if (!last || last.role !== 'user') return;
    } else {
      text = (text || '').trim();
      if (!text) return;
    }
    if (!st.settings.apiKey) {
      toast('Cole a chave do Gemini em Ajustes.');
      go('ajustes');
      return;
    }
    if (!opts.retry) {
      st.chat.push({ role: 'user', text, ts: Date.now() });
      st.chat = st.chat.slice(-60);
    }
    ui.chatBusy = true;
    ui.chatError = '';
    ui.chatDetail = '';
    ui.chatStatus = '';
    S.save();
    if (ui.tab !== 'coach') go('coach');
    else renderChat();
    try {
      const out = await G.ask(st.chat, {
        onStatus: (t) => {
          ui.chatStatus = t;
          renderChat(true);
        },
      });
      st.chat.push({ role: 'model', text: out.text, ts: Date.now(), model: out.model });
      ui.lastModel = out.model;
      if (st.settings.falar && window.Voice) window.Voice.speak(out.text.replace(/[*_`#]/g, ''));
    } catch (e) {
      ui.chatError = e.message || 'Falha ao falar com o Gemini.';
      ui.chatDetail = e.detail || '';
    }
    ui.chatBusy = false;
    ui.chatStatus = '';
    S.save();
    renderChat();
  }

  // ===========================================================================
  // Tela: AJUSTES
  // ===========================================================================
  function field(label, path, o = {}) {
    const type = o.type || 'number';
    const dt = type === 'number' ? 'num' : 'text';
    // número como texto + teclado decimal: aceita "1,2" e "1.2" em qualquer idioma do aparelho
    const v = type === 'number' ? String(getPath(path)).replace('.', ',') : getPath(path);
    if (type === 'textarea') {
      return `<label class="field"><span>${label}</span>
        <textarea data-bind="${path}" data-type="text" maxlength="${o.max || 300}" placeholder="${esc(o.placeholder || '')}">${esc(getPath(path))}</textarea>
        ${o.hint ? `<small>${o.hint}</small>` : ''}</label>`;
    }
    return `<label class="field"><span>${label}</span>
      <input data-bind="${path}" data-type="${dt}" type="${type === 'number' ? 'text' : type}" value="${esc(v)}" ${type === 'number' ? 'inputmode="decimal" autocomplete="off"' : ''}
        ${o.min != null ? `data-min="${o.min}"` : ''} ${o.max != null ? `data-max="${o.max}"` : ''}>
      ${o.hint ? `<small>${o.hint}</small>` : ''}</label>`;
  }
  const toggle = (label, path, hint) => `<label class="toggle"><span>${label}${hint ? `<br><small class="muted">${hint}</small>` : ''}</span>
      <input type="checkbox" data-bind="${path}" data-type="bool" ${getPath(path) ? 'checked' : ''}></label>`;

  function viewAjustes() {
    const set = S.state.settings;
    const notifSupported = 'Notification' in window;
    const notifState = notifSupported ? Notification.permission : 'unsupported';
    return `<div class="stack">
      <div class="top"><div><div class="eyebrow">Configurações</div><h1>Ajustes</h1></div><button class="btn sm ghost" data-action="go" data-tab="hoje">‹ Voltar</button></div>

      <section class="card"><h2>Instalar no celular</h2>
        <p class="small muted" style="margin:6px 0 10px">Android (Chrome): menu ⋮ → <i>Instalar app</i>. iPhone (Safari): Compartilhar → <i>Adicionar à Tela de Início</i>.</p>
        ${ui.installEvt ? '<button class="btn primary block" data-action="install">📲 Instalar agora</button>' : ''}
      </section>

      <section class="card"><h2>Aparência</h2>
        <div class="themes" style="margin-top:12px">${THEMES.map(
          ([id, nome, bg, card, acc]) => `<button class="theme-btn" data-action="theme" data-t="${id}" aria-pressed="${(set.tema || 'auto') === id}">
            <div class="sw" style="background:${bg}"><i style="background:${card}"></i><b style="background:${acc}"></b></div>${nome}</button>`
        ).join('')}</div></section>

      <section class="card"><h2>Perfil e metas</h2><div class="fields" style="margin-top:12px">
        ${field('Nome (opcional)', 'profile.nome', { type: 'text' })}
        <div class="grid2">${field('Idade', 'profile.idade', { min: 14, max: 100 })}${field('Altura (cm)', 'profile.altura', { min: 120, max: 230 })}</div>
        <div class="grid2">${field('Peso inicial (kg)', 'profile.pesoInicial', { min: 40, max: 400 })}${field('Início do plano', 'profile.inicio', { type: 'date' })}</div>
        <div class="grid2">${field('Meta fase 1 (kg)', 'profile.meta1', { min: 40, max: 400 })}${field('Meta final (kg)', 'profile.metaFinal', { min: 40, max: 400 })}</div>
        ${field('Ritmo planejado (kg/semana)', 'profile.ritmo', { min: 0.2, max: 2, hint: 'Entre 0,7 e 1,5 é o realista. Só afeta a linha tracejada e as previsões.' })}
      </div></section>

      <section class="card"><h2>Metas do dia</h2><div class="fields" style="margin-top:12px">
        <div class="grid2">${field('Calorias (kcal)', 'settings.kcal', { min: 1200, max: 4000 })}${field('Proteína (g)', 'settings.proteina', { min: 50, max: 300 })}</div>
        <div class="grid2">${field('Carboidrato máx. (g)', 'settings.carbo', { min: 20, max: 400 })}${field('Água (ml)', 'settings.agua', { min: 1000, max: 5000 })}</div>
        <div class="grid2">${field('Caminhada (min)', 'settings.caminhada', { min: 5, max: 180 })}${field('Refri zero (latas)', 'settings.refriMax', { min: 0, max: 10 })}</div>
        ${field('Cozinha fecha às', 'settings.cozinhaFecha', { type: 'time' })}
        ${toggle('Modo low-carb estrito', 'settings.lowcarb', 'Sugere só opções sem tapioca, cuscuz, pão ou arroz (~90 g de carboidrato/dia).')}
        <p class="tiny muted">Abaixo de 1.500 kcal não é recomendado sem acompanhamento médico.</p>
      </div></section>

      <section class="card"><h2>Horários das refeições</h2>
        <div class="times" style="margin-top:12px">${P.MEALS.map((m) => field(`${m.icone} ${esc(m.nome)}`, `settings.horarios.${m.id}`, { type: 'time' })).join('')}</div></section>

      <section class="card"><h2>Coach (Gemini)</h2><div class="fields" style="margin-top:12px">
        <label class="field"><span>Chave da API</span>
          <input data-bind="settings.apiKey" data-type="text" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(set.apiKey)}" placeholder="AIza…">
          <small>Gere em aistudio.google.com/apikey. Fica só no armazenamento deste aparelho e vai direto ao Google. Nunca é incluída no backup.</small></label>
        <label class="field"><span>Modelo</span>
          <input data-bind="settings.model" data-type="text" list="models" value="${esc(set.model)}" autocapitalize="off" spellcheck="false">
          <datalist id="models">${P.MODELS.map((m) => `<option value="${m}">`).join('')}</datalist>
          <small>Deixe <b>auto</b>: o app pergunta ao Google quais modelos a sua chave enxerga e usa o melhor, trocando sozinho se um falhar.</small></label>
        ${field('Sobre você, para o coach (opcional)', 'settings.sobreMim', { type: 'textarea', placeholder: 'Ex.: sensível a cafeína; já tentei planos flexíveis e prefiro firmeza.', hint: 'Fica só neste aparelho e vai ao Gemini quando você usa o coach.' })}
        <div class="grid2"><button class="btn" data-action="test-gemini">Testar conexão</button><button class="btn" data-action="diagnose">Diagnóstico</button></div>
        <p class="tiny muted">Ao usar o coach ou o registro por voz, seu plano, registros dos últimos 7 dias, pesos, o texto acima e o <b>áudio</b> que você gravar são enviados ao Gemini (sem nome). O áudio não fica salvo no app. Para limitar abusos caso a chave vaze, restrinja-a no Google AI Studio.</p>
      </div></section>

      <section class="card"><h2>Voz</h2>
        <div style="margin-top:10px">${toggle('Ler respostas em voz alta', 'settings.falar', 'O coach e as confirmações do registro por voz são faladas (voz do aparelho, funciona offline).')}</div>
        <div class="row wrap" style="margin-top:10px"><button class="btn sm" data-action="speak-test">🔊 Testar voz</button></div>
        <p class="tiny muted" style="margin-top:8px">Microfone: ${window.Voice && window.Voice.supported() ? 'disponível neste navegador.' : 'indisponível aqui (precisa de HTTPS e permissão); use o campo de texto do registro.'}</p>
      </section>

      <section class="card"><h2>Lembretes</h2>
        <p class="small muted" style="margin:6px 0 10px">A forma mais confiável: baixe o arquivo de lembretes e abra no seu calendário (alarmes diários de refeições, água, caminhada e cozinha fechada).</p>
        <button class="btn block" data-action="ics">📅 Baixar lembretes (.ics)</button>
        <div style="margin-top:12px">${toggle('Avisos dentro do app', 'settings.notif', notifSupported ? `Só tocam com o app aberto ou recém-aberto (permissão: ${notifState}).` : 'Este navegador não suporta notificações.')}</div>
        ${set.notif ? '<button class="btn sm" style="margin-top:8px" data-action="test-notif">Testar aviso</button>' : ''}
      </section>

      <section class="card"><h2>Seus dados</h2>
        <p class="small muted" style="margin:6px 0 10px">Tudo fica neste aparelho. Faça backup de vez em quando — se limpar os dados do navegador, o histórico some.</p>
        <div class="grid2"><button class="btn" data-action="export">⬇️ Exportar</button><button class="btn" data-action="import">⬆️ Importar</button></div>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
        <button class="btn danger block" style="margin-top:10px" data-action="reset">Apagar tudo</button>
      </section>
    </div>`;
  }

  // ===========================================================================
  // Render / navegação
  // ===========================================================================
  const VIEWS = { hoje: viewHoje, progresso: viewProgresso, plano: viewPlano, coach: viewCoach, ajustes: viewAjustes };

  /**
   * Anima anéis, barras, a água e os números do valor anterior até o novo (o HTML já nasce com o valor final,
   * então sem JavaScript ou com "reduzir movimento" tudo aparece certo, só sem animação).
   */
  function runFx() {
    const calm = reduceMotion();
    const setFx = (el, prop, val) => {
      if (prop === 'dash') el.style.strokeDashoffset = val;
      else el.style[prop] = val;
    };
    document.querySelectorAll('#view [data-fx]').forEach((el) => {
      const key = el.dataset.fx;
      const to = el.dataset.to;
      const from = key in ui.fx ? ui.fx[key] : el.dataset.from;
      ui.fx[key] = to;
      if (calm || from == null || from === to) return;
      setFx(el, el.dataset.prop, from);
      void el.getBoundingClientRect(); // fixa o ponto de partida antes de animar
      requestAnimationFrame(() => setFx(el, el.dataset.prop, to));
    });
    document.querySelectorAll('#view [data-count]').forEach((el) => {
      const id = 'n:' + el.dataset.cid;
      const to = Number(el.dataset.count);
      const from = id in ui.fx ? ui.fx[id] : 0;
      ui.fx[id] = to;
      if (calm || from === to) return;
      const t0 = performance.now();
      const step = (t) => {
        const p = Math.min(1, (t - t0) / 650);
        el.textContent = U.num(from + (to - from) * (1 - Math.pow(1 - p, 3)), 0);
        if (p < 1 && el.isConnected) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function render() {
    const view = $('#view');
    view.innerHTML = VIEWS[ui.tab]();
    view.classList.toggle('enter', ui.enter && !reduceMotion());
    ui.enter = false;
    document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false'));
    runFx();
    if (ui.tab === 'coach') window.scrollTo(0, document.body.scrollHeight);
  }

  function go(tab) {
    if (!TABS.includes(tab)) tab = 'hoje';
    ui.tab = tab;
    ui.enter = true;
    ui.fx = {};
    try {
      history.replaceState(null, '', '#/' + tab);
    } catch (e) {
      /* file:// ou sandbox */
    }
    closeModal();
    render();
    if (tab !== 'coach') window.scrollTo(0, 0);
  }

  // ===========================================================================
  // Modais
  // ===========================================================================
  function openPick(id) {
    const m = mealById(id);
    const cur = S.optIndex(ui.date, m);
    openModal(`<h2>${m.icone} ${esc(m.nome)}</h2><p class="muted small">Escolha a opção. Calorias e proteína ficam próximas.</p>
      ${m.opcoes
        .map((o, i) => `<button class="opt-pick ${i === cur ? 'sel' : ''}" data-action="select-opt" data-id="${id}" data-i="${i}"><b>${esc(o.nome)}</b><span class="muted small">${macroLine(P.optTotals(o))}</span></button>`)
        .join('')}
      <button class="btn block ghost" style="margin-top:12px" data-action="close-modal">Fechar</button>`);
  }

  function openFissura() {
    openModal(`<h2>Fissura? Respira.</h2><p class="muted small">Ela costuma passar em menos de 10 minutos. Você não precisa vencer para sempre, só agora.</p>
      <div class="timer" id="ftimer">10:00</div>
      <button class="btn primary block" id="fstart" data-action="fissura-start">Começar contagem de 10 min</button>
      <ol class="rules small" style="margin-top:16px">${P.PROTOCOLO.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="grid2" style="margin-top:16px"><button class="btn primary" data-action="fissura-win">✓ Venci</button><button class="btn danger" data-action="fissura-lose">Cedi</button></div>
      ${S.state.settings.apiKey ? '<button class="btn block ghost" style="margin-top:8px" data-action="fissura-coach">🤖 Falar com o coach</button>' : ''}
      <button class="btn block ghost" style="margin-top:4px" data-action="close-modal">Fechar</button>`);
  }

  function openExtras() {
    openModal(`<h2>Comi fora do plano</h2>
      <p class="muted small">Registrar é parte do plano: o app só ajuda se tiver a verdade. Estime sem culpa — e na próxima refeição, volte ao normal (sem pular nem compensar).</p>
      ${P.EXTRAS_PRESETS.map(([l, k], i) => `<button class="opt-pick" data-action="extra-add" data-i="${i}"><b>${esc(l)}</b><span class="muted small">~${k} kcal</span></button>`).join('')}
      <form data-form="extra" class="fields" style="margin-top:14px">
        <label class="field"><span>Outro (descrição, opcional)</span><input name="label" type="text" maxlength="40"></label>
        <label class="field"><span>Calorias estimadas</span><input name="kcal" type="number" inputmode="numeric" min="10" max="5000" required></label>
        <button class="btn primary block" type="submit">Registrar</button>
      </form>
      <button class="btn block ghost" style="margin-top:8px" data-action="close-modal">Cancelar</button>`);
  }

  function openOnboarding() {
    const p = S.state.profile;
    ui.lock = true;
    openModal(`<h2>Primeiros passos</h2>
      <p class="muted small">Esses dados ficam <b>só neste aparelho</b> (não vão para o código nem para o site). Dá para mudar depois em Ajustes.</p>
      <form data-form="onboarding" class="fields" style="margin-top:12px">
        <label class="field"><span>Nome (opcional)</span><input name="nome" type="text" maxlength="30" autocomplete="off"></label>
        <div class="grid2">
          <label class="field"><span>Idade</span><input name="idade" type="text" inputmode="numeric" required placeholder="${p.idade}"></label>
          <label class="field"><span>Altura (cm)</span><input name="altura" type="text" inputmode="numeric" required placeholder="${p.altura}"></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Peso atual (kg)</span><input name="kg" type="text" inputmode="decimal" required placeholder="${p.pesoInicial}"></label>
          <label class="field"><span>Início do plano</span><input name="inicio" type="date" value="${U.key()}" required></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Meta fase 1 (kg)</span><input name="meta1" type="text" inputmode="decimal" required></label>
          <label class="field"><span>Meta final (kg)</span><input name="metaFinal" type="text" inputmode="decimal" required></label>
        </div>
        <small class="muted">Sugestão: fase 1 = perder ~10% do peso (preenchida sozinha ao digitar o peso).</small>
        <button class="btn primary block" type="submit">Começar</button>
      </form>`);
  }

  function openWeight() {
    const cur = S.currentWeight();
    openModal(`<h2>Registrar peso</h2><p class="muted small">Ao acordar, após o banheiro, sem roupa pesada — sempre nas mesmas condições.</p>
      <form data-form="weight" class="fields" style="margin-top:12px">
        <label class="field"><span>Peso (kg)</span><input name="kg" type="text" inputmode="decimal" placeholder="${U.num(cur.kg)}" required autofocus></label>
        <label class="field"><span>Cintura (cm, opcional)</span><input name="cintura" type="text" inputmode="decimal"></label>
        <label class="field"><span>Data</span><input name="date" type="date" value="${U.key()}" max="${U.key()}" required></label>
        <button class="btn primary block" type="submit">Salvar</button>
      </form>
      <button class="btn block ghost" style="margin-top:8px" data-action="close-modal">Cancelar</button>`);
  }

  // ===========================================================================
  // Ações (cliques)
  // ===========================================================================
  const actions = {
    go: (el) => go(el.dataset.tab),
    theme(el) {
      S.state.settings.tema = el.dataset.t;
      S.save();
      applyTheme();
      render();
    },
    'close-modal': () => closeModal(),

    'date-prev'() {
      if (ui.date > S.state.profile.inicio) {
        ui.date = U.addDays(ui.date, -1);
        render();
      }
    },
    'date-next'() {
      if (ui.date < U.key()) {
        ui.date = U.addDays(ui.date, 1);
        render();
      }
    },
    'date-today'() {
      ui.date = U.key();
      render();
    },

    'toggle-meal'(el) {
      const m = mealById(el.dataset.id);
      const d = S.day(ui.date);
      if (S.foodsOf(d, m.id).length) return toast('Esta refeição tem itens contados. Remova-os (✕) para voltar ao plano.');
      const md = d.meals[m.id] || (d.meals[m.id] = {});
      if (!md.done) md.opt = S.optIndex(ui.date, m);
      md.done = !md.done;
      md.at = md.done ? Date.now() : null;
      S.save();
      render();
      if (md.done) {
        buzz();
        const s = S.dayStats(ui.date);
        const all = !m.opcional && s.done === s.req;
        toast(all ? '✓ Todas as refeições do dia feitas!' : `✓ ${m.nome} feito`);
        if (all) celebrate(['🎉', '✨', '🥳', '💪']);
      }
    },
    'food-del'(el) {
      S.removeFood(ui.date, el.dataset.id);
      persist();
    },
    'treino-del'(el) {
      S.removeTreino(ui.date, el.dataset.id);
      persist();
    },
    'toast-act'() {
      const fn = ui.toastFn;
      ui.toastFn = null;
      $('#toast').classList.remove('show');
      if (fn) fn();
    },
    'pick-opt': (el) => openPick(el.dataset.id),
    'select-opt'(el) {
      const m = mealById(el.dataset.id);
      const d = S.day(ui.date);
      const md = d.meals[m.id] || (d.meals[m.id] = {});
      md.opt = Number(el.dataset.i);
      closeModal();
      persist();
    },

    water(el) {
      const d = S.day(ui.date);
      const before = d.agua;
      d.agua = Math.max(0, d.agua + Number(el.dataset.n));
      persist();
      buzz();
      if (before < S.state.settings.agua && d.agua >= S.state.settings.agua) {
        toast('💧 Meta de água batida!');
        celebrate(['💧', '🎉', '✨']);
      }
    },
    walk(el) {
      const d = S.day(ui.date);
      const before = S.dayStats(ui.date).move;
      d.caminhada = Math.max(0, d.caminhada + Number(el.dataset.n));
      persist();
      buzz();
      if (before < S.state.settings.caminhada && S.dayStats(ui.date).move >= S.state.settings.caminhada) {
        toast('🏃 Meta de movimento batida!');
        celebrate(['🏃', '🎉', '🔥']);
      }
    },
    refri(el) {
      const d = S.day(ui.date);
      d.refri = Math.max(0, d.refri + Number(el.dataset.n));
      persist();
      if (d.refri > S.state.settings.refriMax && Number(el.dataset.n) > 0) toast('Passou do limite de refri zero de hoje.');
    },

    fissura: () => openFissura(),
    'fissura-start'(el) {
      if (ui.timer) return;
      const end = Date.now() + 10 * 60 * 1000;
      el.textContent = 'Contando… respire e beba água';
      el.disabled = true;
      const tick = () => {
        const left = Math.max(0, end - Date.now());
        const t = $('#ftimer');
        if (t) t.textContent = `${U.pad(Math.floor(left / 60000))}:${U.pad(Math.floor((left % 60000) / 1000))}`;
        if (left <= 0) {
          clearInterval(ui.timer && ui.timer.iv);
          ui.timer = null;
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          toast('10 minutos passaram. Como está a vontade?');
        }
      };
      ui.timer = { iv: setInterval(tick, 250) };
      tick();
    },
    'fissura-win'() {
      S.day(ui.date).fissuras.push({ t: Date.now(), won: true });
      closeModal();
      persist();
      toast('🧊 Fissura vencida. Isso conta.');
    },
    'fissura-lose'() {
      S.day(ui.date).fissuras.push({ t: Date.now(), won: false });
      S.save();
      openExtras();
    },
    'fissura-coach'() {
      closeModal();
      sendToCoach('Estou com muita vontade de comer fora do horário. Me ajude agora.');
    },

    extra: () => openExtras(),
    'extra-add'(el) {
      const [label, kcal] = P.EXTRAS_PRESETS[Number(el.dataset.i)];
      S.day(ui.date).extras.push({ id: U.uid(), label, kcal });
      closeModal();
      persist();
      toast('Registrado. Próxima refeição: normal, sem compensar.');
    },
    'extra-del'(el) {
      S.day(ui.date).extras.splice(Number(el.dataset.i), 1);
      persist();
    },

    weight: () => openWeight(),
    'weight-del'(el) {
      const id = el.dataset.id;
      S.state.weights = S.state.weights.filter((w) => w.id !== id);
      persist();
    },

    'close-day'() {
      const d = S.day(ui.date);
      d.fechou = !d.fechou;
      persist();
      if (d.fechou) toast(d.extras.length ? 'Dia encerrado. Com extras, “cozinha fechada” não pontua.' : '🔒 Dia encerrado. Bom trabalho!');
    },

    'ask-day': () => sendToCoach(P.QUICK_PROMPTS[0]),
    'ask-week': () => sendToCoach(P.QUICK_PROMPTS[2]),
    'coach-quick': (el) => sendToCoach(P.QUICK_PROMPTS[Number(el.dataset.i)]),
    'coach-retry': () => sendToCoach(null, { retry: true }),
    'coach-clear'() {
      S.state.chat = [];
      ui.chatError = '';
      ui.chatDetail = '';
      persist();
    },
    speak(el) {
      const m = S.state.chat.find((x) => String(x.ts) === el.dataset.ts);
      if (m && window.Voice) window.Voice.speak(m.text.replace(/[*_`#]/g, ''));
    },
    'speak-test'() {
      if (!window.Voice || !window.Voice.canSpeak()) return toast('Este navegador não tem voz de leitura.');
      window.Voice.speak('Olá! Eu vou ler as respostas do coach e as confirmações em voz alta.');
    },
    async diagnose() {
      if (!S.state.settings.apiKey) {
        toast('Cole a chave do Gemini primeiro.');
        return go('ajustes');
      }
      openModal(`<h2>Diagnóstico do Gemini</h2><p class="muted small">Testa a sua chave e cada modelo, um por um (leva alguns segundos).</p>
        <div id="diag" style="margin-top:12px">${diagHTML({ rows: [] }, false)}</div>
        <button class="btn block ghost" style="margin-top:12px" data-action="close-modal">Fechar</button>`);
      const paint = (r, done) => {
        const el = $('#diag');
        if (el) el.innerHTML = diagHTML(r, !!done);
      };
      try {
        const r = await G.diagnose((x) => paint(x, false));
        paint(r, true);
      } catch (e) {
        const el = $('#diag');
        if (el) el.innerHTML = `<div class="bubble err small">⚠️ ${esc(e.message)}</div>`;
      }
    },

    install: async () => {
      if (!ui.installEvt) return;
      ui.installEvt.prompt();
      await ui.installEvt.userChoice.catch(() => {});
      ui.installEvt = null;
      render();
    },
    async 'test-gemini'(el) {
      el.disabled = true;
      const label = el.textContent;
      const t0 = Date.now();
      let status = 'Testando…';
      const paint = () => {
        el.textContent = `${status} ${Math.round((Date.now() - t0) / 1000)} s`;
      };
      const iv = setInterval(paint, 500);
      paint();
      try {
        const r = await G.test({
          onStatus: (t) => {
            status = t;
            paint();
          },
        });
        toast(`Conectado ✓ ${r.model} (${(r.ms / 1000).toFixed(1)} s)`);
      } catch (e) {
        toast(e.message + (e.detail ? ' Toque em Diagnóstico para ver o motivo de cada modelo.' : ''));
      } finally {
        clearInterval(iv);
        el.disabled = false;
        el.textContent = label;
      }
    },
    ics: () => ICS.download(),
    async 'test-notif'() {
      await notify('🍳 Teste de aviso', 'Se você viu isto, os avisos dentro do app funcionam.', 'teste');
    },
    export() {
      U.download(`plano-backup-${U.key()}.json`, 'application/json', S.exportJSON());
      toast('Backup baixado (sem a chave da API).');
    },
    import: () => $('#import-file').click(),
    reset() {
      openModal(`<h2>Apagar tudo?</h2><p class="muted small">Isso remove peso, registros, chat e configurações <b>deste aparelho</b>. Não dá para desfazer. Exporte um backup antes se quiser guardar.</p>
        <div class="grid2" style="margin-top:14px"><button class="btn danger" data-action="reset-confirm">Apagar</button><button class="btn" data-action="close-modal">Cancelar</button></div>`);
    },
    'reset-confirm'() {
      S.reset();
      location.reload();
    },
  };

  /** Resultado do diagnóstico: o motivo real de cada falha, para não ficar no escuro. */
  function diagHTML(r, done) {
    const rows = r.rows || [];
    const ok = rows.filter((x) => x.ok);
    let head;
    if (r.listError) head = `<div class="bubble err small">⚠️ ${esc(r.listError)}</div>`;
    else if (done && ok.length) head = `<p class="good small">✓ Funcionando. O app vai usar <b>${esc(ok[0].model)}</b>${ok.length > 1 ? ` e, se ele falhar, ${esc(ok[1].model)}` : ''}.</p>`;
    else if (done) head = '<p class="bad small">Nenhum modelo respondeu. Veja o motivo de cada um abaixo.</p>';
    else head = '<p class="small muted">Testando…</p>';
    const listed = r.listed != null ? `<p class="tiny muted">A sua chave enxerga ${r.listed} modelo(s) de texto.</p>` : '';
    const table = rows
      .map((x) => {
        const running = !x.done && !x.ok && !x.code;
        const icon = running ? '⏳' : x.ok ? '✅' : '❌';
        const note = x.ok ? (x.message || '') : x.message || '';
        return `<li><span>${icon}</span><div><b>${esc(x.model)}</b>${x.ms ? ` <span class="tiny muted">${(x.ms / 1000).toFixed(1)} s</span>` : ''}${note ? `<small>${esc(String(note).slice(0, 220))}</small>` : ''}</div></li>`;
      })
      .join('');
    return `${head}${listed}${table ? `<ul class="diag">${table}</ul>` : ''}`;
  }

  document.addEventListener('click', async (e) => {
    const tabBtn = e.target.closest('#tabs [data-tab]');
    if (tabBtn) return go(tabBtn.dataset.tab);
    if (e.target.classList && e.target.classList.contains('overlay')) return dismissModal();
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (fn) await fn(el, e);
  });

  // Campos de Ajustes (salva ao alterar)
  document.addEventListener('change', async (e) => {
    if (e.target.id === 'import-file') {
      const f = e.target.files[0];
      if (!f) return;
      try {
        S.importJSON(await f.text());
        toast('Backup importado.');
        render();
      } catch (err) {
        toast(err.message || 'Não foi possível importar.');
      }
      e.target.value = '';
      return;
    }
    const el = e.target.closest('[data-bind]');
    if (!el) return;
    const path = el.dataset.bind;
    let val;
    if (el.dataset.type === 'bool') val = el.checked;
    else if (el.dataset.type === 'num') {
      val = U.parseNum(el.value);
      const lo = el.dataset.min != null ? Number(el.dataset.min) : -Infinity;
      const hi = el.dataset.max != null ? Number(el.dataset.max) : Infinity;
      if (Number.isNaN(val) || val < lo || val > hi) {
        toast(`Valor inválido${Number.isFinite(lo) && Number.isFinite(hi) ? ` (entre ${lo} e ${hi})` : ''}.`);
        el.value = String(getPath(path)).replace('.', ',');
        return;
      }
    } else val = el.value.trim();
    if (path === 'settings.model' && !val) val = 'auto';
    if (path === 'settings.apiKey') G.resetCache(); // outra chave pode enxergar outros modelos
    if (path === 'settings.notif' && val) {
      if (!('Notification' in window)) {
        el.checked = false;
        return toast('Este navegador não suporta notificações.');
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        el.checked = false;
        return toast('Permissão de notificação negada.');
      }
    }
    setPath(path, val);
    if (path.startsWith('profile.')) S.syncSeed();
    S.save();
    toast('Salvo');
    if (path === 'settings.notif' || path === 'settings.lowcarb') render();
  });

  // Formulários
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const fd = new FormData(form);
    switch (form.dataset.form) {
      case 'coach': {
        const ta = $('#coach-input');
        const text = ta.value;
        ta.value = '';
        ta.style.height = 'auto';
        sendToCoach(text);
        break;
      }
      case 'extra': {
        const kcal = Math.round(U.parseNum(fd.get('kcal')));
        if (!(kcal >= 10 && kcal <= 5000)) return toast('Informe as calorias (10 a 5000).');
        S.day(ui.date).extras.push({ id: U.uid(), label: String(fd.get('label') || '').trim() || 'Extra', kcal });
        closeModal();
        persist();
        toast('Registrado. Próxima refeição: normal, sem compensar.');
        break;
      }
      case 'onboarding': {
        const num = (n) => U.parseNum(fd.get(n));
        const idade = num('idade'), altura = num('altura'), kg = num('kg'), meta1 = num('meta1'), metaFinal = num('metaFinal');
        const inicio = String(fd.get('inicio'));
        if (!(idade >= 14 && idade <= 100)) return toast('Idade inválida (14 a 100).');
        if (!(altura >= 120 && altura <= 230)) return toast('Altura inválida (120 a 230 cm).');
        if (!(kg >= 40 && kg <= 400)) return toast('Peso inválido (40 a 400 kg).');
        if (!(meta1 >= 40 && meta1 < kg)) return toast('A meta da fase 1 precisa ser menor que o peso atual.');
        if (!(metaFinal >= 40 && metaFinal <= meta1)) return toast('A meta final deve ser menor ou igual à da fase 1.');
        if (!inicio) return toast('Informe a data de início.');
        Object.assign(S.state.profile, {
          ok: true, nome: String(fd.get('nome') || '').trim(), idade: Math.round(idade), altura: Math.round(altura),
          pesoInicial: Math.round(kg * 10) / 10, inicio, meta1, metaFinal,
        });
        S.syncSeed();
        ui.lock = false;
        ui.date = U.key();
        closeModal();
        persist();
        toast('Tudo pronto. Bom começo!');
        break;
      }
      case 'weight': {
        const kg = U.parseNum(fd.get('kg'));
        const cint = U.parseNum(fd.get('cintura'));
        const date = String(fd.get('date'));
        if (!(kg >= 40 && kg <= 400)) return toast('Peso inválido (40 a 400 kg).');
        if (!date || date > U.key()) return toast('Data inválida.');
        const same = S.state.weights.find((w) => w.date === date && !w.inicial);
        const entry = same || { id: U.uid(), date };
        entry.kg = Math.round(kg * 10) / 10;
        entry.cintura = Number.isNaN(cint) ? null : cint;
        if (!same) S.state.weights.push(entry);
        closeModal();
        persist();
        const cur = S.currentWeight();
        toast(`Peso registrado: ${U.num(cur.kg)} kg`);
        break;
      }
    }
  });

  // Campo do coach: cresce com o texto; Ctrl/Cmd+Enter envia
  document.addEventListener('input', (e) => {
    const form = e.target.closest && e.target.closest('form[data-form="onboarding"]');
    if (form) {
      if (e.target.name === 'meta1') e.target.dataset.touched = '1';
      if (e.target.name === 'kg' && !form.meta1.dataset.touched) {
        const kg = U.parseNum(e.target.value);
        form.meta1.value = kg >= 40 ? String(Math.round(kg * 0.9 * 10) / 10).replace('.', ',') : '';
      }
      return;
    }
    if (e.target.id !== 'coach-input') return;
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dismissModal();
    if (e.target.id === 'coach-input' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      $('.composer').requestSubmit();
    }
  });

  // ===========================================================================
  // Lembretes dentro do app
  // ===========================================================================
  async function notify(title, body, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return toast('Ative a permissão de notificação primeiro.');
    try {
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      if (reg) return await reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: [120, 60, 120] });
    } catch (e) {
      /* cai no fallback */
    }
    try {
      new Notification(title, { body, tag, icon: 'icons/icon-192.png' });
    } catch (e) {
      /* ignora */
    }
  }

  function checkReminders() {
    const st = S.state;
    if (!st.settings.notif || !('Notification' in window) || Notification.permission !== 'granted') return;
    const k = U.key();
    const nowM = U.nowMin();
    for (const key of Object.keys(st.notified)) if (!key.startsWith(k)) delete st.notified[key];
    for (const m of P.MEALS) {
      if (m.opcional) continue;
      const t = U.minutes(S.mealTime(m));
      const key = k + m.id;
      const md = S.peekDay(k).meals[m.id];
      if (nowM >= t && nowM < t + 20 && !st.notified[key] && !(md && md.done)) {
        st.notified[key] = 1;
        S.save();
        notify(`${m.icone} ${m.nome}`, `Hora de comer: ${m.opcoes[S.optIndex(k, m)].nome}. Marque no app quando terminar.`, key);
      }
    }
  }

  // ===========================================================================
  // Início
  // ===========================================================================
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    ui.installEvt = e;
    if (ui.tab === 'ajustes') render();
  });
  window.addEventListener('hashchange', () => {
    const tab = location.hash.replace('#/', '');
    if (TABS.includes(tab) && tab !== ui.tab) go(tab);
  });

  function tick() {
    const k = U.key();
    if (k !== ui.today) {
      if (ui.date === ui.today) ui.date = k;
      ui.today = k;
    }
    checkReminders();
    if (ui.tab === 'hoje' && !$('#modal-root').firstChild && !document.hidden) render();
  }
  document.addEventListener('visibilitychange', () => !document.hidden && tick());

  S.load();
  applyTheme();
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  const startTab = location.hash.replace('#/', '');
  ui.tab = TABS.includes(startTab) ? startTab : 'hoje';
  render();
  if (!S.state.profile.ok) openOnboarding();
  setInterval(tick, 60 * 1000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW não registrado', e)));
  }

  // Dica de voz do botão "Contar por voz": gira a cada poucos segundos (só mexe no texto, sem redesenhar a tela)
  setInterval(() => {
    const el = document.getElementById('vc-hint');
    if (!el || !S.state.settings.apiKey || document.hidden) return;
    ui.hintI = (ui.hintI + 1) % P.VOICE_HINTS.length;
    el.classList.add('swap');
    setTimeout(() => {
      const e2 = document.getElementById('vc-hint');
      if (e2) {
        e2.textContent = `“${P.VOICE_HINTS[ui.hintI]}”`;
        e2.classList.remove('swap');
      }
    }, 220);
  }, 5000);

  // API para o painel de voz (js/voiceui.js) e para depuração no console
  window.App = { ui, toast, celebrate, buzz, openModal, closeModal, persist, render, go, actions, sendToCoach, mealById, esc, $ };
  window.__app = { ui, S, render, go };
})();
