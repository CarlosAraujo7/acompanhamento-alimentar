/* Gráficos em SVG puro (sem bibliotecas, funciona offline). */
(function (g) {
  'use strict';
  const U = g.U;
  const S = g.Store;

  /** Anel de progresso. */
  function ring({ pct, size = 132, stroke = 12, color = 'var(--accent)', big, small, label }) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const off = c * (1 - U.clamp(pct, 0, 1));
    const m = size / 2;
    return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${U.esc(label || '')}">
      <circle cx="${m}" cy="${m}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/>
      <circle cx="${m}" cy="${m}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${m} ${m})"/>
      <text x="${m}" y="${m + 2}" text-anchor="middle" class="ring-big">${U.esc(big)}</text>
      <text x="${m}" y="${m + 20}" text-anchor="middle" class="ring-small">${U.esc(small)}</text>
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

  g.Charts = { ring, weightChart, heatmap };
})(window);
