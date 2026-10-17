/*
 * Painel de voz: grava → envia ao Gemini → você confere e edita → registra (com "Desfazer").
 * Usa a API exposta por js/app.js (window.App). Fluxo: gravando → enviando → conferir.
 * Se a IA falhar, o áudio fica guardado na tela para "Tentar de novo" sem precisar falar tudo outra vez.
 */
(function () {
  'use strict';
  const { U, PlanData: P, Store: S, Gemini: G, Voice: V, App } = window;
  const { ui, toast, esc, $ } = App;

  let vz = null; // sessão aberta (null = painel fechado)

  const ICON_MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3M9 21h6"/></svg>';
  const mmss = (ms) => `${Math.floor(ms / 60000)}:${U.pad(Math.floor((ms % 60000) / 1000))}`;
  const num = (v) => {
    const n = U.parseNum(v);
    return Number.isFinite(n) ? n : 0;
  };
  const paint = (html) => {
    const el = $('#vz');
    if (el) el.innerHTML = html;
  };
  const head = (title) => `<div class="vz-head"><h2>${title}</h2><button class="icon-x" data-action="vz-close" aria-label="Fechar">✕</button></div>`;

  // ===========================================================================
  // Abrir / fechar
  // ===========================================================================
  function open(opts = {}) {
    if (!S.state.settings.apiKey) {
      App.openModal(`${head('🎙️ Falta a chave do Gemini')}
        <p class="muted small" style="margin:6px 0 14px">O registro por voz usa o Gemini para entender o que você falou e estimar as calorias. Crie uma chave grátis em aistudio.google.com/apikey e cole em Ajustes. Ela fica só neste aparelho.</p>
        <button class="btn primary block" data-action="go" data-tab="ajustes">Abrir Ajustes</button>`);
      return;
    }
    vz = {
      mode: opts.mode || 'log', // 'log' = comida/água/treino · 'coach' = só transcreve para a conversa
      meal: opts.meal || null,
      hint: opts.hint || '',
      rec: null, audio: null, text: '', ctl: null, draft: null, dayKey: ui.date, raf: 0, exI: 0, exTimer: 0,
    };
    App.openModal('<div id="vz"></div>');
    ui.sticky = true;
    ui.closeHooks.push(teardown);
    if (opts.text) return showText();
    startRecording();
  }

  function teardown() {
    if (!vz) return;
    cancelAnimationFrame(vz.raf);
    clearInterval(vz.exTimer);
    if (vz.rec) vz.rec.cancel();
    if (vz.ctl) vz.ctl.abort();
    vz = null;
  }

  const close = () => App.closeModal();

  // ===========================================================================
  // Gravação
  // ===========================================================================
  const SUB = {
    log: 'Conte o que comeu, bebeu ou treinou. Pode juntar tudo numa fala só.',
    treino: 'Conte o treino: o que fez e por quanto tempo.',
    coach: 'Faça sua pergunta ou desabafe. Eu transcrevo e envio ao coach.',
  };

  async function startRecording() {
    const me = vz;
    if (!V.supported()) {
      return showError({ message: 'Este navegador não deixa gravar áudio aqui (precisa de HTTPS e microfone). Digite o que comeu abaixo.', noRetry: true }, { textFirst: true });
    }
    paint(`${head('🎙️ Microfone')}<div class="vz-proc"><div class="spinner"></div><p class="muted small">Permita o uso do microfone quando o navegador perguntar…</p></div>`);
    me.audio = null;
    me.rec = new V.Recorder({
      onTick: (ms) => {
        const t = $('#vz-time');
        if (t) t.textContent = mmss(ms);
        const note = $('#vz-note');
        if (note && ms > 6000 && me.rec && me.rec.speechMs < 200) note.textContent = 'Não estou ouvindo nada. Fale mais perto do microfone.';
      },
      onAutoStop: (why) => finishRecording(why),
    });
    const rec = me.rec;
    try {
      await rec.start();
    } catch (e) {
      // fechou o painel ou trocou para "digitar" enquanto esperava a permissão: não mexe na tela
      if (vz !== me || me.rec !== rec || e.code === 'aborted') return;
      me.rec = null;
      return showError({ message: e.message || 'Não consegui acessar o microfone.', noRetry: true }, { textFirst: true });
    }
    if (vz !== me || me.rec !== rec) return;
    showRecording();
  }

  function showRecording() {
    const sub = vz.mode === 'coach' ? SUB.coach : vz.hint === 'treino' ? SUB.treino : vz.meal ? `Conte o que comeu em: ${esc(P.SLOT_NOMES[vz.meal])}.` : SUB.log;
    const bars = Array.from({ length: 28 }, () => '<i></i>').join('');
    paint(`${head('Pode falar')}
      <p class="muted small vz-sub">${sub}</p>
      <div class="vz-stage">
        <button class="vz-mic rec" data-action="vz-stop" aria-label="Terminar e enviar"><span class="pulse"></span><span class="pulse p2"></span>${ICON_MIC}</button>
        <div class="wave" id="vz-wave" aria-hidden="true">${bars}</div>
        <div class="vz-time" id="vz-time">0:00</div>
        <div class="tiny muted" id="vz-note">Toque no microfone quando terminar</div>
      </div>
      <p class="vz-example" id="vz-ex"></p>
      <div class="vz-actions">
        <button class="btn primary" data-action="vz-stop">Enviar</button>
        <button class="btn" data-action="vz-close">Cancelar</button>
      </div>
      <button class="link small vz-alt" data-action="vz-text">⌨️ Prefiro digitar</button>`);
    animateWave();
    rotateExamples();
  }

  function animateWave() {
    const bars = Array.from(document.querySelectorAll('#vz-wave i'));
    const me = vz;
    const loop = (t) => {
      if (vz !== me || !me.rec) return;
      const lv = me.rec.level;
      bars.forEach((b, i) => {
        const wob = 0.5 + 0.5 * Math.sin(t / 130 + i * 0.75);
        b.style.transform = `scaleY(${Math.min(1, 0.12 + lv * (0.35 + 0.65 * wob)).toFixed(3)})`;
      });
      me.raf = requestAnimationFrame(loop);
    };
    me.raf = requestAnimationFrame(loop);
  }

  function rotateExamples() {
    const me = vz;
    const list = me.hint === 'treino'
      ? ['Fiz 20 minutos de agachamento e flexão em casa', 'Pedalei 30 minutos na bicicleta ergométrica', 'Fiz 15 minutos de yoga']
      : me.mode === 'coach'
        ? ['O que posso trocar no meu jantar de hoje?', 'Estou com vontade de comer doce, me ajuda', 'Como foi minha semana?']
        : P.VOICE_HINTS;
    const show = () => {
      const el = $('#vz-ex');
      if (el) el.textContent = `“${list[me.exI++ % list.length]}”`;
    };
    show();
    clearInterval(me.exTimer);
    me.exTimer = setInterval(show, 4200);
  }

  function finishRecording(why) {
    const me = vz;
    if (!me || !me.rec) return;
    const rec = me.rec;
    me.rec = null;
    cancelAnimationFrame(me.raf);
    clearInterval(me.exTimer);
    const audio = rec.stop();
    if (why === 'max') toast('Limite de 2 minutos: enviei o que deu.');
    if (audio.seconds < 0.8 || audio.speechMs < 250) {
      return showError({ message: 'Não ouvi nada. Fale mais perto do microfone e tente de novo.', noRetry: true }, { rerecord: true });
    }
    me.audio = audio;
    me.text = '';
    process();
  }

  // ===========================================================================
  // Texto
  // ===========================================================================
  function showText(prefill = '') {
    if (vz.rec) {
      vz.rec.cancel();
      vz.rec = null;
    }
    cancelAnimationFrame(vz.raf);
    clearInterval(vz.exTimer);
    const ph = vz.mode === 'coach' ? 'Escreva sua pergunta…' : 'Ex.: hoje comi dois ovos e um copo de 200 ml de leite com Nescau; depois caminhei 20 minutos';
    paint(`${head('⌨️ Digitar')}
      <form data-vz-form="text" class="fields" style="margin-top:8px">
        <textarea name="t" rows="4" maxlength="1500" placeholder="${esc(ph)}" aria-label="Relato">${esc(prefill)}</textarea>
        <button class="btn primary block" type="submit">${vz.mode === 'coach' ? 'Enviar ao coach' : 'Estimar calorias'}</button>
      </form>
      ${V.supported() ? '<button class="link small vz-alt" data-action="vz-rec">🎙️ Prefiro falar</button>' : ''}`);
    const ta = $('#vz textarea');
    if (ta) ta.focus();
  }

  // ===========================================================================
  // Enviar à IA
  // ===========================================================================
  async function process() {
    const me = vz;
    if (!me) return;
    me.ctl = new AbortController();
    const secs = me.audio ? ` (áudio de ${Math.max(1, Math.round(me.audio.seconds))} s)` : '';
    paint(`${head('Entendendo…')}
      <div class="vz-proc"><div class="spinner"></div>
        <p id="vz-status" class="muted small">Enviando${secs}</p>
        <button class="btn ghost" data-action="vz-close">Cancelar</button></div>`);
    const status = (t) => {
      const el = $('#vz-status');
      if (el && vz === me) el.textContent = t;
    };
    try {
      if (me.mode === 'coach') {
        const text = me.audio ? await G.transcribe(me.audio, { signal: me.ctl.signal, onStatus: status }) : me.text;
        if (vz !== me) return;
        me.text = text;
        return showCoachReview();
      }
      const draft = await G.interpret({ audio: me.audio, text: me.text, meal: me.meal, hint: me.hint }, { signal: me.ctl.signal, onStatus: status });
      if (vz !== me) return;
      me.draft = draft;
      me.dayKey = draft.quando === 'ontem' && U.addDays(U.key(), -1) >= S.state.profile.inicio ? U.addDays(U.key(), -1) : ui.date;
      showReview();
    } catch (e) {
      if (vz !== me || e.code === 'aborted') return;
      showError(e);
    }
  }

  function showError(e, o = {}) {
    const canRetry = !e.noRetry && vz && (vz.audio || vz.text);
    paint(`${head('⚠️ Não deu certo')}
      <p style="margin:8px 0">${esc(e.message || 'Algo falhou.')}</p>
      ${e.detail ? `<details class="tiny muted"><summary>Detalhes técnicos</summary><pre>${esc(e.detail)}</pre></details>` : ''}
      <div class="vz-col">
        ${canRetry ? '<button class="btn primary" data-action="vz-retry">↻ Tentar de novo (sem regravar)</button>' : ''}
        ${V.supported() && !o.textFirst ? '<button class="btn" data-action="vz-rec">🎙️ Gravar de novo</button>' : ''}
        <button class="btn ${o.textFirst || o.rerecord ? '' : 'ghost'}" data-action="vz-text">⌨️ Digitar</button>
        ${vz && vz.mode === 'log' ? '<button class="btn ghost" data-action="vz-manual">✍️ Registrar manualmente</button>' : ''}
        ${e.code === 'all' || e.code === 'key' || e.code === 'referer' || e.code === 'service' ? '<button class="btn ghost" data-action="diagnose">🩺 Diagnóstico</button>' : ''}
        <button class="btn ghost" data-action="vz-close">Fechar</button>
      </div>`);
  }

  // ===========================================================================
  // Conferir e editar (comida / água / treino)
  // ===========================================================================
  function blankDraft() {
    return {
      transcricao: '', quando: 'hoje', comidas: [{ meal: vz.meal || S.guessMeal(), nome: '', kcal: 0, p: 0, c: 0, f: 0, fora: false, motivo: '', obs: '' }],
      treinos: [], agua: 0, refri: 0, caminhada: 0, peso: 0, resposta: '', duvidas: [], vazio: false,
    };
  }

  const slotOptions = (cur) => Object.entries(P.SLOT_NOMES).map(([id, nome]) => `<option value="${id}" ${id === cur ? 'selected' : ''}>${esc(nome)}</option>`).join('');

  function foodEdit(x, i) {
    return `<div class="rv-item ${x.fora ? 'out' : ''}">
      <div class="rv-row1">
        <input class="rv-name" data-vz="nome" data-i="${i}" value="${esc(x.nome)}" maxlength="70" placeholder="O que comeu" aria-label="Alimento">
        <button class="icon-x" data-action="vz-del" data-kind="comidas" data-i="${i}" aria-label="Remover ${esc(x.nome)}">✕</button>
      </div>
      <div class="rv-row2">
        <select data-vz="meal" data-i="${i}" aria-label="Refeição">${slotOptions(x.meal)}</select>
        <label class="rv-num"><input data-vz="kcal" data-i="${i}" inputmode="numeric" value="${Math.round(x.kcal)}" aria-label="Calorias"><span>kcal</span></label>
      </div>
      <div class="rv-macros" id="mac-${i}">${macros(x)}</div>
      ${x.obs ? `<div class="rv-obs">💬 ${esc(x.obs)}</div>` : ''}
      <label class="rv-flag"><input type="checkbox" data-vz="fora" data-i="${i}" ${x.fora ? 'checked' : ''}> <span>Fora do plano${x.fora && x.motivo ? ` <small class="bad">· ${esc(x.motivo)}</small>` : ''}</span></label>
    </div>`;
  }
  const macros = (x) => `P ${Math.round(x.p)} g · C ${Math.round(x.c)} g · G ${Math.round(x.f)} g`;

  function treinoEdit(t, i) {
    return `<div class="rv-item">
      <div class="rv-row1">
        <input class="rv-name" data-vz="tipo" data-i="${i}" value="${esc(t.tipo)}" maxlength="50" placeholder="Treino" aria-label="Tipo de treino">
        <button class="icon-x" data-action="vz-del" data-kind="treinos" data-i="${i}" aria-label="Remover treino">✕</button>
      </div>
      <div class="rv-row2">
        <label class="rv-num"><input data-vz="tmin" data-i="${i}" inputmode="numeric" value="${Math.round(t.min)}" aria-label="Minutos"><span>min</span></label>
        <label class="rv-num"><input data-vz="tkcal" data-i="${i}" inputmode="numeric" value="${Math.round(t.kcal)}" aria-label="Calorias gastas"><span>kcal gastas</span></label>
      </div>
      ${t.obs ? `<div class="rv-obs">💬 ${esc(t.obs)}</div>` : ''}
    </div>`;
  }

  const simpleRow = (icon, label, key, val, unit, step) =>
    `<div class="rv-item rv-simple"><span class="rv-ico">${icon}</span><span class="rv-lbl">${label}</span>
      <label class="rv-num"><input data-vz="${key}" inputmode="decimal" value="${String(val).replace('.', ',')}" aria-label="${label}"><span>${unit}</span></label>
      <button class="icon-x" data-action="vz-del" data-kind="${key}" aria-label="Remover ${label}">✕</button></div>`;

  function dayOptions() {
    const hoje = U.key();
    const ontem = U.addDays(hoje, -1);
    const keys = [...new Set([ui.date, hoje, ontem])].filter((k) => k >= S.state.profile.inicio && k <= hoje).sort().reverse();
    return keys.map((k) => `<option value="${k}" ${k === vz.dayKey ? 'selected' : ''}>${k === hoje ? 'Hoje' : k === ontem ? 'Ontem' : U.dateLabel(k)}</option>`).join('');
  }

  function totals() {
    const d = vz.draft;
    const t = d.comidas.reduce((a, x) => ({ k: a.k + x.kcal, p: a.p + x.p, c: a.c + x.c, f: a.f + x.f }), { k: 0, p: 0, c: 0, f: 0 });
    // se uma refeição já estava marcada pelo plano, o que você contou a substitui (não soma os dois)
    const day = S.peekDay(vz.dayKey);
    const replaced = [...new Set(d.comidas.map((x) => x.meal))].reduce((a, id) => {
      const m = App.mealById(id);
      return m && S.planCounts(day, id) ? a + P.optTotals(m.opcoes[S.optIndex(vz.dayKey, m)]).k : a;
    }, 0);
    const base = S.dayStats(vz.dayKey).kcal;
    return { ...t, dia: Math.round(base - replaced + t.k) };
  }

  function totalLine() {
    const t = totals();
    const meta = S.state.settings.kcal;
    const cls = t.dia > meta * 1.05 ? 'bad' : '';
    return `<b>${Math.round(t.k)} kcal</b> · P ${Math.round(t.p)} g · C ${Math.round(t.c)} g · G ${Math.round(t.f)} g<br><span class="${cls}">Com isso, o dia fica em <b>${U.num(t.dia, 0)}</b> de ${U.num(meta, 0)} kcal.</span>`;
  }

  function showReview() {
    const d = vz.draft;
    const rows = [
      ...d.comidas.map(foodEdit),
      ...d.treinos.map(treinoEdit),
      d.agua > 0 ? simpleRow('💧', 'Água', 'agua', d.agua, 'ml') : '',
      d.caminhada > 0 ? simpleRow('🚶', 'Caminhada', 'caminhada', d.caminhada, 'min') : '',
      d.refri > 0 ? simpleRow('🥤', 'Refri zero', 'refri', d.refri, 'latas') : '',
      d.peso > 0 ? simpleRow('⚖️', 'Peso', 'peso', d.peso, 'kg') : '',
    ].join('');
    const empty = !rows.trim();
    paint(`${head(empty ? 'Não registrei nada' : 'Confere aí')}
      ${d.transcricao ? `<div class="vz-said">“${esc(d.transcricao)}”</div>` : ''}
      ${d.resposta ? `<p class="vz-say">${esc(d.resposta)}</p>` : ''}
      ${d.duvidas.length ? `<form data-vz-form="answer" class="vz-ask"><label class="field"><span>${d.duvidas.map(esc).join(' · ')}</span><div class="row"><input name="a" type="text" placeholder="Responder para ajustar a estimativa" maxlength="120"><button class="btn sm" type="submit">Ajustar</button></div></label></form>` : ''}
      <div class="rv-list">${rows}</div>
      ${empty ? '' : `<div class="rv-total" id="rv-total">${totalLine()}</div>`}
      <div class="rv-tools">
        <label class="rv-day"><span>Dia</span><select data-vz="day" aria-label="Dia do registro">${dayOptions()}</select></label>
        <button class="link small" data-action="vz-add" data-kind="comidas">＋ Alimento</button>
        <button class="link small" data-action="vz-add" data-kind="treinos">＋ Treino</button>
      </div>
      <p class="tiny muted">Calorias são estimativas da IA. Ajuste os números se souber melhor.</p>
      <div class="vz-actions">
        <button class="btn primary" data-action="vz-ok" ${empty ? 'disabled' : ''}>✓ Registrar</button>
        <button class="btn" data-action="${V.supported() ? 'vz-rec' : 'vz-text'}">${V.supported() ? '🎙️ Falar de novo' : '⌨️ Digitar de novo'}</button>
      </div>
      <button class="link small vz-alt" data-action="vz-close">Descartar</button>`);
  }

  function showCoachReview() {
    paint(`${head('O que entendi')}
      <form data-vz-form="coach" class="fields" style="margin-top:8px">
        <textarea name="t" rows="4" maxlength="1500" aria-label="Mensagem para o coach">${esc(vz.text)}</textarea>
        <button class="btn primary block" type="submit">Enviar ao coach</button>
      </form>
      <div class="grid2" style="margin-top:8px"><button class="btn" data-action="vz-rec">🎙️ Falar de novo</button><button class="btn ghost" data-action="vz-close">Cancelar</button></div>`);
  }

  // ---- Edição dentro da conferência ------------------------------------------
  function onInput(e) {
    const el = e.target;
    if (!vz || !vz.draft || !el.dataset || !el.dataset.vz) return;
    const d = vz.draft;
    const i = Number(el.dataset.i);
    const k = el.dataset.vz;
    const x = d.comidas[i];
    const t = d.treinos[i];
    if (k === 'nome' && x) x.nome = el.value;
    else if (k === 'kcal' && x) {
      const nk = Math.max(0, Math.round(num(el.value)));
      const ratio = x.kcal > 0 ? nk / x.kcal : 1;
      if (x.kcal > 0 && nk > 0) { x.p *= ratio; x.c *= ratio; x.f *= ratio; } // macros acompanham as calorias
      x.kcal = nk;
      const m = $(`#mac-${i}`);
      if (m) m.textContent = macros(x);
    } else if (k === 'tipo' && t) t.tipo = el.value;
    else if (k === 'tmin' && t) t.min = Math.max(0, Math.round(num(el.value)));
    else if (k === 'tkcal' && t) t.kcal = Math.max(0, Math.round(num(el.value)));
    else if (k === 'agua') d.agua = Math.max(0, Math.round(num(el.value)));
    else if (k === 'caminhada') d.caminhada = Math.max(0, Math.round(num(el.value)));
    else if (k === 'refri') d.refri = Math.max(0, Math.round(num(el.value)));
    else if (k === 'peso') d.peso = Math.max(0, num(el.value));
    else return;
    const tot = $('#rv-total');
    if (tot) tot.innerHTML = totalLine();
  }

  function onChange(e) {
    const el = e.target;
    if (!vz || !vz.draft || !el.dataset || !el.dataset.vz) return;
    const d = vz.draft;
    const i = Number(el.dataset.i);
    if (el.dataset.vz === 'meal' && d.comidas[i]) d.comidas[i].meal = el.value;
    else if (el.dataset.vz === 'fora' && d.comidas[i]) d.comidas[i].fora = el.checked;
    else if (el.dataset.vz === 'day') vz.dayKey = el.value;
    else return;
    // refaz a tela para atualizar o selo "fora do plano" e o total do dia
    const scroll = $('.sheet') ? $('.sheet').scrollTop : 0;
    showReview();
    if ($('.sheet')) $('.sheet').scrollTop = scroll;
  }

  function onSubmit(e) {
    const form = e.target.closest && e.target.closest('form[data-vz-form]');
    if (!form || !vz) return;
    e.preventDefault();
    const fd = new FormData(form);
    const kind = form.dataset.vzForm;
    if (kind === 'text' || kind === 'coach') {
      const text = String(fd.get('t') || '').trim();
      if (!text) return toast('Escreva alguma coisa.');
      if (kind === 'coach' || vz.mode === 'coach') {
        if (vz.mode === 'coach' && kind === 'text') {
          vz.text = text;
          vz.audio = null;
          return showCoachReview();
        }
        close();
        App.sendToCoach(text);
        return;
      }
      vz.text = text;
      vz.audio = null;
      process();
    } else if (kind === 'answer') {
      const a = String(fd.get('a') || '').trim();
      if (!a) return;
      vz.text = `${vz.draft.transcricao || vz.text}. Esclarecimento: ${a}`;
      vz.audio = null;
      process();
    }
  }

  // ===========================================================================
  // Registrar
  // ===========================================================================
  function confirm() {
    const d = vz.draft;
    const comidas = d.comidas
      .filter((x) => x.nome.trim())
      .map((x) => ({ ...x, nome: x.nome.trim().slice(0, 70), kcal: Math.max(0, Math.round(x.kcal)), p: Math.round(x.p * 10) / 10, c: Math.round(x.c * 10) / 10, f: Math.round(x.f * 10) / 10 }));
    const treinos = d.treinos.filter((t) => t.min > 0).map((t) => ({ ...t, tipo: t.tipo.trim() || 'Treino' }));
    const entry = { comidas, treinos, agua: d.agua, refri: d.refri, caminhada: d.caminhada, peso: d.peso >= 40 ? d.peso : 0 };
    if (!comidas.length && !treinos.length && !entry.agua && !entry.refri && !entry.caminhada && !entry.peso) return toast('Não há nada para registrar.');

    const k = vz.dayKey;
    const falar = S.state.settings.falar;
    const fala = d.resposta;
    const before = S.dayStats(k);
    const rec = S.applyEntry(k, entry, vz.audio ? 'voz' : 'texto');
    const after = S.dayStats(k);
    close(); // teardown zera `vz`
    App.persist();
    App.buzz(20);

    const bits = [];
    if (comidas.length) bits.push(`${Math.round(comidas.reduce((a, x) => a + x.kcal, 0))} kcal`);
    if (treinos.length) bits.push(`${treinos.reduce((a, t) => a + t.min, 0)} min de treino`);
    if (entry.agua) bits.push(`+${entry.agua} ml`);
    if (entry.caminhada) bits.push(`+${entry.caminhada} min caminhada`);
    if (entry.refri) bits.push(`${entry.refri} refri zero`);
    if (entry.peso) bits.push(`${U.num(entry.peso)} kg`);
    toast(`✓ Registrado: ${bits.join(' · ')}`, {
      label: 'Desfazer',
      fn: () => {
        S.undoEntry(rec);
        App.persist();
        toast('Desfeito.');
      },
    });

    const set = S.state.settings;
    const aguaAgora = S.peekDay(k).agua;
    if (before.done < before.req && after.done === after.req) App.celebrate(['🎉', '✨', '🥳', '💪']);
    else if (aguaAgora >= set.agua && aguaAgora - entry.agua < set.agua) App.celebrate(['💧', '🎉', '✨']);
    else if (before.move < set.caminhada && after.move >= set.caminhada) App.celebrate(['🏃', '🎉', '🔥']);

    if (falar && fala) V.speak(fala);
  }

  // ===========================================================================
  // Ações (cliques) e eventos
  // ===========================================================================
  Object.assign(App.actions, {
    'voz-open': (el) => open({ meal: el.dataset.meal, hint: el.dataset.hint }),
    'voz-coach': () => open({ mode: 'coach' }),
    'vz-close': () => close(),
    'vz-stop': () => finishRecording(),
    'vz-text': () => vz && showText(vz.text),
    'vz-rec': () => vz && startRecording(),
    'vz-retry': () => vz && (vz.audio || vz.text) && process(),
    'vz-manual'() {
      if (!vz) return;
      vz.draft = blankDraft();
      vz.dayKey = ui.date;
      showReview();
    },
    'vz-del'(el) {
      if (!vz || !vz.draft) return;
      const d = vz.draft;
      const kind = el.dataset.kind;
      if (kind === 'comidas' || kind === 'treinos') d[kind].splice(Number(el.dataset.i), 1);
      else if (kind in d) d[kind] = 0;
      showReview();
    },
    'vz-add'(el) {
      if (!vz || !vz.draft) return;
      const d = vz.draft;
      if (el.dataset.kind === 'treinos') d.treinos.push({ tipo: '', min: 0, kcal: 0, obs: '' });
      else d.comidas.push({ meal: vz.meal || S.guessMeal(), nome: '', kcal: 0, p: 0, c: 0, f: 0, fora: false, motivo: '', obs: '' });
      showReview();
      const inputs = document.querySelectorAll('#vz .rv-name');
      if (inputs.length) inputs[inputs.length - 1].focus();
    },
    'vz-ok': () => vz && vz.draft && confirm(),
  });

  const root = document.getElementById('modal-root');
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('submit', onSubmit);

  window.VoiceUI = { open };
})();
