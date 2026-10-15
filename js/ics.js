/*
 * Lembretes em arquivo .ics (calendário). Importado no Google Agenda / Calendário do celular,
 * os alarmes tocam mesmo com o app fechado — notificações de PWA sem servidor não são confiáveis.
 */
(function (g) {
  'use strict';
  const U = g.U;
  const S = g.Store;
  const P = g.PlanData;

  const ymd = (k) => k.replace(/-/g, '');
  const hms = (hhmm) => hhmm.replace(':', '') + '00';
  const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

  function addMinutes(hhmm, delta) {
    const t = ((U.minutes(hhmm) + delta) % 1440 + 1440) % 1440;
    return `${U.pad(Math.floor(t / 60))}:${U.pad(t % 60)}`;
  }

  // RFC 5545: escapar \ ; , e quebras de linha em campos TEXT
  const txt = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

  // RFC 5545: linhas com no máx. 75 bytes; continuação começa com um espaço (sem cortar caractere UTF-8)
  function fold(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const out = [];
    let cur = '';
    let bytes = 0;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > 75) {
        out.push(cur);
        cur = ' ';
        bytes = 1;
      }
      cur += ch;
      bytes += b;
    }
    out.push(cur);
    return out.join('\r\n');
  }

  function event(uid, title, hhmm, desc, dur = 20) {
    const k = U.key();
    return [
      'BEGIN:VEVENT',
      `UID:${uid}@plano-emagrecer`,
      `DTSTAMP:${stamp()}`,
      `DTSTART:${ymd(k)}T${hms(hhmm)}`,
      `DURATION:PT${dur}M`,
      'RRULE:FREQ=DAILY',
      `SUMMARY:${txt(title)}`,
      `DESCRIPTION:${txt(desc)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${txt(title)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
    ]
      .map(fold)
      .join('\r\n');
  }

  function build() {
    const set = S.state.settings;
    const ev = [];
    for (const m of P.MEALS) {
      const t = S.mealTime(m);
      ev.push(event(`meal-${m.id}`, `${m.icone} ${m.nome}`, t, `Hora de comer. ${m.dica}`));
    }
    ev.push(event('agua-1', '💧 Água: 500 ml', addMinutes(S.mealTime(P.MEALS[0]), -30), 'Antes da primeira refeição.', 5));
    ev.push(event('agua-2', '💧 Água: 500 ml', '15:00', 'Meta do dia: ' + set.agua + ' ml.', 5));
    ev.push(event('agua-3', '💧 Água: 500 ml', '18:00', 'Meta do dia: ' + set.agua + ' ml.', 5));
    ev.push(event('walk', '🚶 Caminhada', '17:30', 'Meta: ' + set.caminhada + ' min em ritmo de conversa.', set.caminhada));
    ev.push(event('close', '🔒 Cozinha fechada', set.cozinhaFecha, 'Depois disso: só água, chá ou gelatina zero. Feche o dia no app.', 5));
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Plano Emagrecer//PT-BR//', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Plano alimentar', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
  }

  g.ICS = { build, download: () => U.download('plano-lembretes.ics', 'text/calendar;charset=utf-8', build()) };
})(window);
