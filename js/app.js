/* Interface do app: telas, ações, modais, coach e lembretes. */
(function () {
  'use strict';
  const { U, PlanData: P, Store: S, Charts: C, Gemini: G, ICS } = window;
  const esc = U.esc;
  const $ = (sel, root = document) => root.querySelector(sel);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const TABS = ['hoje', 'progresso', 'plano', 'coach', 'ajustes'];
  const ui = { tab: 'hoje', today: U.key(), date: U.key(), chatBusy: false, chatError: '', installEvt: null, timer: null, lock: false };

  // ===========================================================================
  // Utilidades de UI
  // ===========================================================================
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2800);
  }

  function stopTimer() {
    if (ui.timer) {
      clearInterval(ui.timer.iv);
      ui.timer = null;
    }
  }
  function openModal(html) {
    stopTimer();
    $('#modal-root').innerHTML = `<div class="overlay"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  }
  function closeModal() {
    if (ui.lock) return; // a tela de primeiros passos não pode ser dispensada
    stopTimer();
    $('#modal-root').innerHTML = '';
  }

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
    const pend = P.MEALS.filter((m) => !m.opcional && !(d.meals[m.id] && d.meals[m.id].done));
    const late = isToday ? pend.filter((m) => nowM > U.minutes(S.mealTime(m)) + 45) : pend;
    if (s.done === s.req) add('good', 'Todas as refeições planejadas foram feitas.');
    else if (late.length) {
      add('bad', `${isToday ? 'Atrasada' : 'Não feita'}${late.length > 1 ? 's' : ''}: ${late.map((m) => m.nome.toLowerCase()).join(', ')}. ${isToday ? 'Faça a refeição planejada agora — não pule nem junte duas.' : 'Sem compensar: siga o plano no próximo horário.'}`);
    } else add('', `${s.done}/${s.req} refeições feitas. Mantenha os horários.`);

    if (s.done === s.req || !isToday) {
      if (s.p >= set.proteina * 0.9) add('good', `Proteína ${s.p} g: meta batida.`);
      else add('bad', `Proteína ${s.p} g de ${set.proteina} g. Faltaram ~${Math.round(set.proteina - s.p)} g: comece a próxima refeição pela proteína.`);
    }
    if (s.extrasK > 0) {
      add('bad', `${s.extrasK} kcal fora do plano (${d.extras.length} registro${d.extras.length > 1 ? 's' : ''}). Não compense: a próxima refeição é normal.`);
    } else if (s.kcal > set.kcal * 1.05) {
      add('bad', `${s.kcal} kcal: acima da meta de ${set.kcal}. Confira as porções (balança nas primeiras semanas).`);
    }
    if (d.agua >= set.agua) add('good', `Água: ${U.num(d.agua / 1000)} L, meta batida.`);
    else if (!isToday || U.nowMin() > 17 * 60) add('bad', `Água: ${U.num(d.agua / 1000)} L de ${U.num(set.agua / 1000)} L.`);
    if (d.caminhada >= set.caminhada) add('good', `Caminhada: ${d.caminhada} min, feita.`);
    else if (!isToday) add('bad', `Caminhada: ${d.caminhada} de ${set.caminhada} min.`);
    if (d.refri > set.refriMax) add('bad', `Refrigerante zero: ${d.refri} latas (limite ${set.refriMax}).`);
    if (s.venci) add('good', `${s.venci} fissura${s.venci > 1 ? 's' : ''} vencida${s.venci > 1 ? 's' : ''}. Isso é disciplina de verdade.`);
    return out.slice(0, 6);
  }

  // ===========================================================================
  // Tela: HOJE
  // ===========================================================================
  function nextMeal(k) {
    if (k !== U.key()) return null;
    const d = S.peekDay(k);
    const nowM = U.nowMin();
    const closeM = U.minutes(S.state.settings.cozinhaFecha);
    const pend = P.MEALS.filter((m) => !(d.meals[m.id] && d.meals[m.id].done) && !(m.opcional && nowM > closeM));
    pend.sort((a, b) => U.minutes(S.mealTime(a)) - U.minutes(S.mealTime(b)));
    // obrigatórias primeiro: a próxima ainda no horário; se todas as pendentes já passaram, cobra a mais recente
    const req = pend.filter((m) => !m.opcional);
    return req.find((m) => U.minutes(S.mealTime(m)) + 45 >= nowM) || req[req.length - 1] || pend[0] || null;
  }

  function mealCard(m, k) {
    const d = S.peekDay(k);
    const md = d.meals[m.id] || {};
    const done = !!md.done;
    const oi = S.optIndex(k, m);
    const o = m.opcoes[oi];
    const t = P.optTotals(o);
    const time = S.mealTime(m);
    const isToday = k === U.key();
    const late = isToday && !done && !m.opcional && U.nowMin() > U.minutes(time) + 45;
    const badges = (m.opcional ? '<span class="badge">opcional</span>' : '') + (late ? '<span class="badge warn">atrasada</span>' : '');
    return `<article class="card meal ${done ? 'done' : ''} ${late ? 'late' : ''}">
      <button class="check" data-action="toggle-meal" data-id="${m.id}" aria-pressed="${done}" aria-label="${done ? 'Desmarcar' : 'Marcar como feita'}: ${esc(m.nome)}">
        <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
      </button>
      <div class="meal-body">
        <div class="meal-head"><span class="time">${time}</span><h3>${m.icone} ${esc(m.nome)}</h3>${badges}</div>
        <div class="opt-name">${esc(o.nome)} <button class="link small" data-action="pick-opt" data-id="${m.id}">trocar</button></div>
        <ul class="items">${o.itens.map((i) => `<li>${esc(i.t)}</li>`).join('')}</ul>
        <div class="macro">${macroLine(t)}</div>
        ${done ? '' : `<div class="tip">${esc(m.dica)}</div>`}
      </div>
    </article>`;
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

    const kcalPct = s.kcal / set.kcal;
    const ringColor = s.kcal > set.kcal * 1.05 ? 'var(--bad)' : 'var(--accent)';
    const bar = (cls, pct) => `<div class="bar ${cls}"><i style="width:${U.clamp(pct, 0, 1) * 100}%"></i></div>`;

    const extras = d.extras.length
      ? `<div class="card"><div class="row between"><h3>Fora do plano</h3><b class="bad">+${s.extrasK} kcal</b></div>
          <div class="row wrap" style="margin-top:10px">${d.extras
            .map((e, i) => `<span class="chip">${esc(e.label)} · ${e.kcal} kcal <button class="link" data-action="extra-del" data-i="${i}" aria-label="Remover">✕</button></span>`)
            .join('')}</div></div>`
      : '';

    const fb = localFeedback(k);

    const dateNav = k <= st.profile.inicio && isToday ? '' : `<div class="row between" style="margin:-4px 0 10px">
        <button class="btn sm ghost" data-action="date-prev" ${k <= st.profile.inicio ? 'disabled' : ''} aria-label="Dia anterior">‹ Anterior</button>
        ${isToday ? '' : '<button class="btn sm" data-action="date-today">Voltar para hoje</button>'}
        <button class="btn sm ghost" data-action="date-next" ${isToday ? 'disabled' : ''} aria-label="Próximo dia">Próximo ›</button>
      </div>`;

    const parts = s.parts;
    const breakdown = `Refeições ${Math.round(parts.refeicoes)}/40 · Água ${Math.round(parts.agua)}/15 · Caminhada ${Math.round(parts.caminhada)}/15 · Refri ${parts.refri}/10 · Cozinha fechada ${parts.cozinha}/20`;

    return `<div class="stack">
      <div class="top">
        <div><div class="eyebrow">${fmtDay(k)}${pd >= 1 ? ` · dia ${pd}` : ''}</div><h1>${hello}${nome}</h1></div>
        <div class="streak" title="Dias seguidos com 80+ pontos">🔥 ${streak} <small>${streak === 1 ? 'dia' : 'dias'}</small></div>
      </div>
      ${dateNav}

      <section class="card">
        <div class="hero">
          ${C.ring({ pct: kcalPct, color: ringColor, big: U.num(s.kcal, 0), small: `de ${U.num(set.kcal, 0)} kcal`, label: 'Calorias do dia' })}
          <div class="bars">
            <div><div class="bar-label"><span>Proteína</span><b>${s.p} / ${set.proteina} g</b></div>${bar('', s.p / set.proteina)}</div>
            <div><div class="bar-label"><span>Carboidrato</span><b>${s.c} / ${set.carbo} g</b></div>${bar(s.c > set.carbo ? 'warn' : 'blue', s.c / set.carbo)}</div>
            <div><div class="bar-label"><span>Pontos do dia</span><b>${s.score == null ? 0 : s.score} / 100</b></div>${bar('', (s.score || 0) / 100)}</div>
          </div>
        </div>
        ${status ? `<div class="status">${status}</div>` : ''}
      </section>

      ${nextHtml}

      <div>
        <div class="sec-title"><h2>Refeições</h2><span class="tiny muted">${s.done}/${s.req} feitas</span></div>
        ${P.MEALS.map((m) => mealCard(m, k)).join('')}
      </div>

      ${extras}

      <div>
        <div class="sec-title"><h2>Hábitos</h2></div>
        <section class="card">
          <div class="habit">
            <div class="row between"><b>💧 Água</b><span class="small">${U.num(d.agua / 1000, 2)} / ${U.num(set.agua / 1000, 1)} L</span></div>
            ${bar('blue', d.agua / set.agua)}
            <div class="habit-actions">
              <button class="btn sm" data-action="water" data-n="250">+250 ml</button>
              <button class="btn sm" data-action="water" data-n="500">+500 ml</button>
              <button class="btn sm ghost" data-action="water" data-n="-250">−250</button>
            </div>
          </div>
          <div class="habit">
            <div class="row between"><b>🚶 Caminhada</b><span class="small">${d.caminhada} / ${set.caminhada} min</span></div>
            ${bar('', d.caminhada / set.caminhada)}
            <div class="habit-actions">
              <button class="btn sm" data-action="walk" data-n="10">+10 min</button>
              <button class="btn sm" data-action="walk" data-n="30">+30 min</button>
              <button class="btn sm ghost" data-action="walk" data-n="-10">−10</button>
            </div>
          </div>
          <div class="habit">
            <div class="row between"><b>🥤 Refri zero</b><span class="small ${d.refri > set.refriMax ? 'bad' : ''}">${d.refri} / ${set.refriMax} latas</span></div>
            ${bar(d.refri > set.refriMax ? 'bad' : 'warn', d.refri / set.refriMax)}
            <div class="habit-actions">
              <button class="btn sm" data-action="refri" data-n="1">+1 lata</button>
              <button class="btn sm ghost" data-action="refri" data-n="-1">−1</button>
            </div>
          </div>
        </section>
      </div>

      <div class="actions3">
        <button class="btn" data-action="fissura"><span>🧊</span>Fissura</button>
        <button class="btn" data-action="extra"><span>🍽️</span>Comi fora do plano</button>
        <button class="btn" data-action="weight"><span>⚖️</span>Registrar peso</button>
      </div>

      <section class="card">
        <div class="row between"><h2>Feedback do dia</h2>${S.state.settings.apiKey ? '<button class="btn sm" data-action="ask-day">🤖 Coach</button>' : ''}</div>
        <ul class="fb" style="margin-top:10px">${fb.map((f) => `<li class="${f.tone}">${esc(f.text)}</li>`).join('')}</ul>
      </section>

      <button class="btn block ${d.fechou ? '' : 'primary'}" data-action="close-day">${d.fechou ? '🔒 Dia encerrado · toque para reabrir' : '🔒 Encerrar o dia (cozinha fechada)'}</button>
      <details class="small muted"><summary>Como os pontos são calculados</summary><p style="margin-top:6px">${breakdown}. Refri e “cozinha fechada” só contam quando o dia é encerrado (ou já passou). Sequência = dias seguidos com 80+ pontos.</p></details>
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
      walk += d.caminhada;
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
        <button class="btn sm primary" data-action="weight">⚖️ Pesar</button></div>

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
        <h2>Últimos 7 dias</h2>
        <div class="kv" style="margin-top:10px">
          <span>Pontos médios</span><span>${avg(sumScore)} / 100</span>
          <span>Dias com todas as refeições</span><span>${daysFull} / ${n || 0}</span>
          <span>Calorias médias</span><span>${avg(sumK)} kcal</span>
          <span>Proteína média</span><span>${avg(sumP)} g</span>
          <span>Dias com meta de água</span><span>${aguaOk} / ${n || 0}</span>
          <span>Caminhada total</span><span>${walk} min</span>
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
      <div class="top"><div><div class="eyebrow">Seu plano restrito</div><h1>Plano</h1></div></div>

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
      h += `<div class="card flat small"><b>Coach com IA (Gemini).</b> Ele enxerga seu plano, o que você marcou hoje, os últimos 7 dias e seus pesos. Pergunte, peça troca de refeição, desabafe uma fissura ou peça a análise do dia.<br><span class="muted">Não substitui médico ou nutricionista.</span></div>`;
    }
    for (const m of st.chat) {
      if (m.role === 'user') h += `<div class="bubble user">${esc(m.text).replace(/\n/g, '<br>')}</div>`;
      else if (m.role === 'model') h += `<div class="bubble model">${U.md(m.text)}</div>`;
    }
    if (ui.chatBusy) h += '<div class="bubble model typing"><span></span><span></span><span></span></div>';
    if (ui.chatError) h += `<div class="bubble err small">⚠️ ${esc(ui.chatError)}</div>`;
    return h;
  }

  function viewCoach() {
    const set = S.state.settings;
    return `<div class="stack coach">
      <div class="top"><div><div class="eyebrow">Gemini · ${esc(set.model)}</div><h1>Coach</h1></div>
        ${S.state.chat.length ? '<button class="btn sm ghost" data-action="coach-clear">Limpar</button>' : ''}</div>
      ${
        set.apiKey
          ? ''
          : `<div class="card"><b>Falta a chave do Gemini.</b><p class="small muted" style="margin:6px 0 10px">Crie uma em aistudio.google.com/apikey e cole em Ajustes. Ela fica só neste aparelho.</p><button class="btn primary" data-action="go" data-tab="ajustes">Abrir Ajustes</button></div>`
      }
      <div class="chat" id="chat">${chatHTML()}</div>
      <div class="quick">${P.QUICK_PROMPTS.map((q, i) => `<button class="chip" data-action="coach-quick" data-i="${i}">${esc(q.length > 38 ? q.slice(0, 36) + '…' : q)}</button>`).join('')}</div>
      <form class="composer" data-form="coach">
        <textarea id="coach-input" rows="1" placeholder="Pergunte ou desabafe…" aria-label="Mensagem para o coach"></textarea>
        <button class="btn primary" type="submit" ${ui.chatBusy ? 'disabled' : ''}>Enviar</button>
      </form>
    </div>`;
  }

  function renderChat() {
    const el = $('#chat');
    if (!el || ui.tab !== 'coach') return;
    el.innerHTML = chatHTML();
    const btn = $('.composer .btn');
    if (btn) btn.disabled = ui.chatBusy;
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  async function sendToCoach(text) {
    text = (text || '').trim();
    if (!text || ui.chatBusy) return;
    const st = S.state;
    if (!st.settings.apiKey) {
      toast('Cole a chave do Gemini em Ajustes.');
      go('ajustes');
      return;
    }
    st.chat.push({ role: 'user', text, ts: Date.now() });
    st.chat = st.chat.slice(-60);
    ui.chatBusy = true;
    ui.chatError = '';
    S.save();
    if (ui.tab !== 'coach') go('coach');
    else renderChat();
    try {
      const out = await G.ask(st.chat);
      st.chat.push({ role: 'model', text: out.text, ts: Date.now() });
      if (out.model !== st.settings.model) toast(`Usei ${out.model} (o modelo escolhido não respondeu).`);
    } catch (e) {
      ui.chatError = e.message || 'Falha ao falar com o Gemini.';
    }
    ui.chatBusy = false;
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
      <div class="top"><div><div class="eyebrow">Configurações</div><h1>Ajustes</h1></div></div>

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
          <datalist id="models">${P.MODELS.map((m) => `<option value="${m}">`).join('')}</datalist></label>
        ${field('Sobre você, para o coach (opcional)', 'settings.sobreMim', { type: 'textarea', placeholder: 'Ex.: sensível a cafeína; já tentei planos flexíveis e prefiro firmeza.', hint: 'Fica só neste aparelho e vai ao Gemini quando você usa o coach.' })}
        <button class="btn block" data-action="test-gemini">Testar conexão</button>
        <p class="tiny muted">Ao usar o coach, seu plano, registros dos últimos 7 dias, pesos e o texto acima são enviados ao Gemini (sem nome). Para limitar abusos caso a chave vaze, restrinja-a no Google AI Studio.</p>
      </div></section>

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

  function render() {
    $('#view').innerHTML = VIEWS[ui.tab]();
    document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false'));
    if (ui.tab === 'coach') window.scrollTo(0, document.body.scrollHeight);
  }

  function go(tab) {
    if (!TABS.includes(tab)) tab = 'hoje';
    ui.tab = tab;
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
      const md = d.meals[m.id] || (d.meals[m.id] = {});
      if (!md.done) md.opt = S.optIndex(ui.date, m);
      md.done = !md.done;
      md.at = md.done ? Date.now() : null;
      S.save();
      render();
      if (md.done) {
        const s = S.dayStats(ui.date);
        toast(!m.opcional && s.done === s.req ? '✓ Todas as refeições do dia feitas!' : `✓ ${m.nome} feito`);
      }
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
      if (before < S.state.settings.agua && d.agua >= S.state.settings.agua) toast('💧 Meta de água batida!');
    },
    walk(el) {
      const d = S.day(ui.date);
      const before = d.caminhada;
      d.caminhada = Math.max(0, d.caminhada + Number(el.dataset.n));
      persist();
      if (before < S.state.settings.caminhada && d.caminhada >= S.state.settings.caminhada) toast('🚶 Meta de caminhada batida!');
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
    'coach-clear'() {
      S.state.chat = [];
      ui.chatError = '';
      persist();
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
      el.textContent = 'Testando…';
      try {
        await G.test();
        toast(`Conectado ✓ (${S.state.settings.model})`);
      } catch (e) {
        toast(e.message);
      }
      el.disabled = false;
      el.textContent = label;
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

  document.addEventListener('click', async (e) => {
    const tabBtn = e.target.closest('#tabs [data-tab]');
    if (tabBtn) return go(tabBtn.dataset.tab);
    if (e.target.classList && e.target.classList.contains('overlay')) return closeModal();
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
    if (e.key === 'Escape') closeModal();
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

  // Exposto para depuração no console do navegador
  window.__app = { ui, S, render, go };
})();
