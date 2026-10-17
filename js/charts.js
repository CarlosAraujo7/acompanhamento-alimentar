/* Gráficos em SVG puro (sem bibliotecas, funciona offline). */
(function (g) {
  'use strict';
  const U = g.U;
  const S = g.Store;

  /**
   * Arco de um anel. Com `key`, o app anima do valor anterior até o novo (data-fx, ver runFx em app.js).
   * Sem progresso, não desenha o arco (a ponta arredondada apareceria como um ponto).
   */
  function arc({ m, r, stroke, pct, color, key }) {
    const c = 2 * Math.PI * r;
    const p = U.clamp(pct, 0, 1);
    const off = c * (1 - p);
    const fx = key ? `class="arc" data-fx="${key}" data-prop="dash" data-from="${c.toFixed(1)}" data-to="${off.toFixed(1)}"` : '';
    return `<circle cx="${m}" cy="${m}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}" opacity=".5"/>
      <circle ${fx} cx="${m}" cy="${m}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" stroke-opacity="${p > 0.004 ? 1 : 0}" transform="rotate(-90 ${m} ${m})"/>`;
  }

  /** Anel de progresso. */
  function ring({ pct, size = 132, stroke = 12, color = 'var(--accent)', big, small, label, key }) {
    const m = size / 2;
    return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${U.esc(label || '')}">
      ${arc({ m, r: (size - stroke) / 2, stroke, pct, color, key })}
      <text x="${m}" y="${m + 2}" text-anchor="middle" class="ring-big">${U.esc(big)}</text>
      <text x="${m}" y="${m + 20}" text-anchor="middle" class="ring-small">${U.esc(small)}</text>
    </svg>`;
  }

  /** Anéis concêntricos (estilo "atividade"): items = [{ pct, color, key }] de fora para dentro. */
  function rings(items, { size = 168, stroke = 12, gap = 5, big, small, label } = {}) {
    const m = size / 2;
    const arcs = items
      .map((it, i) => arc({ m, r: m - stroke / 2 - 2 - i * (stroke + gap), stroke, pct: it.pct, color: it.color, key: it.key }))
      .join('');
    return `<svg class="ring rings" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${U.esc(label || '')}">
      ${arcs}
      <text x="${m}" y="${m + 4}" text-anchor="middle" class="ring-big">${U.esc(big)}</text>
      <text x="${m}" y="${m + 22}" text-anchor="middle" class="ring-small">${U.esc(small)}</text>
    </svg>`;
  }

  /** Calorias dos últimos 7 dias contra a meta (barra = dia; cor = pontos do dia). */
  function weekBars() {
    const hoje = U.key();
    const set = S.state.settings;
    const W = 340, H = 150, pad = { l: 8, r: 8, t: 14, b: 22 };
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const k = U.addDays(hoje, -i);
      const ok = k >= S.state.profile.inicio;
      const s = ok ? S.dayStats(k) : null;
      days.push({ k, s: s && s.hasData ? s : null });
    }
    const max = Math.max(set.kcal * 1.25, ...days.map((d) => (d.s ? d.s.kcal : 0)));
    const bw = (W - pad.l - pad.r) / 7;
    const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
    const goalY = y(set.kcal);
    let bars = '';
    days.forEach((d, i) => {
      const x = pad.l + i * bw + bw * 0.18;
      const w = bw * 0.64;
      const label = U.parse(d.k).toLocaleDateString('pt-BR', { weekday: 'narrow' }).toUpperCase();
      if (d.s) {
        const sc = d.s.score == null ? 0 : d.s.score;
        const cls = d.s.kcal > set.kcal * 1.05 ? 'r' : sc >= S.SCORE_OK ? 'g' : sc >= 50 ? 'y' : 'r';
        const top = y(d.s.kcal);
        bars += `<rect class="wb ${cls}" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${(H - pad.b - top).toFixed(1)}" rx="6"><title>${U.dateLabel(d.k)} · ${d.s.kcal} kcal · ${sc} pts</title></rect>
          <text class="wv" x="${(x + w / 2).toFixed(1)}" y="${(top - 4).toFixed(1)}" text-anchor="middle">${d.s.kcal}</text>`;
      } else {
        bars += `<rect class="wb n" x="${x.toFixed(1)}" y="${(H - pad.b - 4).toFixed(1)}" width="${w.toFixed(1)}" height="4" rx="2"/>`;
      }
      bars += `<text class="wl${d.k === hoje ? ' today' : ''}" x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${label}</text>`;
    });
    return `<svg class="wbars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calorias dos últimos 7 dias">
      <line class="wgoal" x1="${pad.l}" x2="${W - pad.r}" y1="${goalY.toFixed(1)}" y2="${goalY.toFixed(1)}"/>
      <text class="wgoal-t" x="${W - pad.r}" y="${(goalY - 4).toFixed(1)}" text-anchor="end">meta ${set.kcal}</text>
      ${bars}
    </svg>`;
  }

  /** Gráfico de peso: pontos, média de 7 dias, ritmo planejado e meta da fase 1. */
  function weightChart() {
    const st = S.state;
    const pr = st.profile;
    const W = 340, H = 220, pad = { l: 40, r: 12, t: 12, b: 26 };
    const ws = S.weightsSorted();
    const hoje = U.key();
    const lastDate = ws[ws.length - 1].date;
    const spanDays = Math.max(28, U.diffDays(pr.inicio, hoje > lastDate ? hoje : lastDate) + 14);
    const kgs = ws.map((w) => w.kg);
    const top = Math.max(pr.pesoInicial, ...kgs) + 2;
    const projEnd = pr.pesoInicial - pr.ritmo * (spanDays / 7);
    let bottom = Math.min(...kgs, pr.meta1, projEnd) - 2;
    if (top - bottom < 10) bottom = top - 10;

    const x = (d) => pad.l + (d / spanDays) * (W - pad.l - pad.r);
    const y = (kg) => pad.t + ((top - kg) / (top - bottom)) * (H - pad.t - pad.b);
    const dayOf = (k) => U.diffDays(pr.inicio, k);

    // grade horizontal em múltiplos "redondos" (5 kg; 2 kg se a faixa for curta)
    const tick = top - bottom > 20 ? 5 : 2;
    let grid = '';
    for (let kg = Math.ceil(bottom / tick) * tick; kg <= top; kg += tick) {
      grid += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(kg).toFixed(1)}" y2="${y(kg).toFixed(1)}" class="gl"/>
        <text x="${pad.l - 6}" y="${(y(kg) + 4).toFixed(1)}" text-anchor="end" class="gt">${kg}</text>`;
    }
    // eixo x: datas
    let xt = '';
    const tickEvery = spanDays > 70 ? 28 : 14;
    for (let d = 0; d <= spanDays; d += tickEvery) {
      xt += `<text x="${x(d).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="gt">${U.dateLabel(U.addDays(pr.inicio, d))}</text>`;
    }
    // ritmo planejado
    const proj = `<line x1="${x(0).toFixed(1)}" y1="${y(pr.pesoInicial).toFixed(1)}" x2="${x(spanDays).toFixed(1)}" y2="${y(projEnd).toFixed(1)}" class="proj"/>`;
    // meta da fase 1
    const meta = pr.meta1 > bottom && pr.meta1 < top
      ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(pr.meta1).toFixed(1)}" y2="${y(pr.meta1).toFixed(1)}" class="meta"/>
         <text x="${W - pad.r}" y="${(y(pr.meta1) - 4).toFixed(1)}" text-anchor="end" class="gt meta-t">meta ${U.num(pr.meta1)} kg</text>`
      : '';
    // média 7 dias
    const maPts = ws.map((w) => [dayOf(w.date), S.ma7(w.date)]).filter((p) => p[1] != null);
    const maPath = maPts.length > 1 ? `<polyline class="ma" points="${maPts.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')}"/>` : '';
    // pontos
    const dots = ws.map((w) => `<circle cx="${x(dayOf(w.date)).toFixed(1)}" cy="${y(w.kg).toFixed(1)}" r="3.2" class="dot"/>`).join('');

    return `<svg class="wchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico do peso ao longo do tempo">
      ${grid}${xt}${meta}${proj}${maPath}${dots}
    </svg>`;
  }

  /** Mapa de calor da adesão (5 semanas). */
  function heatmap() {
    const hoje = U.key();
    const end = hoje;
    const start0 = U.addDays(end, -34);
    const sunOffset = U.parse(start0).getDay(); // alinhar ao domingo
    const start = U.addDays(start0, -sunOffset);
    const head = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d) => `<span class="hm-h">${d}</span>`).join('');
    let cells = '';
    for (let k = start; k <= end; k = U.addDays(k, 1)) {
      const sc = k < S.state.profile.inicio ? null : S.dayStats(k).score;
      const cls = sc == null ? 'n' : sc >= S.SCORE_OK ? 'g' : sc >= 50 ? 'y' : 'r';
      cells += `<span class="hm-c ${cls}${k === hoje ? ' today' : ''}" title="${U.dateLabel(k)}${sc != null ? ' · ' + sc + ' pts' : ''}">${U.parse(k).getDate()}</span>`;
    }
    // preencher a última semana com células vazias
    return `<div class="hm">${head}${cells}</div>`;
  }

  g.Charts = { ring, rings, weekBars, weightChart, heatmap };
})(window);
