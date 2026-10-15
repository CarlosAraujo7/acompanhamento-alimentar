/* Utilitários gerais (datas, números, escape de HTML, markdown mínimo e seguro). */
(function (g) {
  'use strict';
  const U = {};

  U.pad = (n) => String(n).padStart(2, '0');

  /** Chave de data local "AAAA-MM-DD". */
  U.key = (d = new Date()) => `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`;

  /** Converte a chave em Date ao meio-dia local (evita problemas de horário de verão). */
  U.parse = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  };

  U.addDays = (k, n) => {
    const d = U.parse(k);
    d.setDate(d.getDate() + n);
    return U.key(d);
  };

  U.diffDays = (a, b) => Math.round((U.parse(b) - U.parse(a)) / 86400000);

  U.minutes = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + (m || 0);
  };

  U.nowMin = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };

  U.fmtDur = (min) => {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    if (h && m) return `${h}h ${U.pad(m)}min`;
    if (h) return `${h}h`;
    return `${m} min`;
  };

  /** Número em pt-BR (vírgula decimal). */
  U.num = (v, dec = 1) =>
    Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: dec });

  /** Lê número digitado ("85,5" ou "85.5"). Retorna NaN se inválido. */
  U.parseNum = (s) => {
    const n = parseFloat(String(s).trim().replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  };

  U.esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  U.clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  U.uid = () => Math.random().toString(36).slice(2, 9);

  U.dateLabel = (k, opts) => U.parse(k).toLocaleDateString('pt-BR', opts || { day: '2-digit', month: '2-digit' });

  U.download = (name, mime, text) => {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  };

  /** Markdown mínimo (negrito, itálico, código, listas, títulos). Escapa HTML antes de tudo. */
  U.md = (src) => {
    const inline = (s) =>
      U.esc(s)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
    let html = '';
    let list = null;
    const close = () => {
      if (list) {
        html += `</${list}>`;
        list = null;
      }
    };
    for (const raw of String(src || '').replace(/\r/g, '').split('\n')) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) {
        close();
        continue;
      }
      if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
        if (list !== 'ul') {
          close();
          html += '<ul>';
          list = 'ul';
        }
        html += `<li>${inline(m[1])}</li>`;
        continue;
      }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        if (list !== 'ol') {
          close();
          html += '<ol>';
          list = 'ol';
        }
        html += `<li>${inline(m[1])}</li>`;
        continue;
      }
      close();
      if ((m = line.match(/^#{1,4}\s+(.*)$/))) {
        html += `<h4>${inline(m[1])}</h4>`;
        continue;
      }
      html += `<p>${inline(line)}</p>`;
    }
    close();
    return html;
  };

  g.U = U;
})(typeof window !== 'undefined' ? window : globalThis);
