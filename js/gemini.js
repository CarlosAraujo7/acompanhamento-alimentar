/*
 * Cliente do Gemini (chamado direto do navegador, com a SUA chave).
 * A chave fica só no localStorage deste aparelho e vai no cabeçalho x-goog-api-key.
 */
(function (g) {
  'use strict';
  const U = g.U;
  const S = g.Store;
  const P = g.PlanData;

  const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
  const FALLBACK_MODEL = 'gemini-2.5-flash';

  class GeminiError extends Error {
    constructor(code, message, status) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  // ---- Contexto enviado ao modelo (dados mínimos, sem nome nem remédios) ---
  function buildContext() {
    const st = S.state;
    const set = st.settings;
    const pr = st.profile;
    const hoje = U.key();
    const now = new Date();
    const cur = S.currentWeight();
    const dTotals = S.dayStats(hoje);
    const d = S.peekDay(hoje);

    const refeicoes = P.MEALS.map((m) => {
      const md = d.meals[m.id];
      const t = S.mealTime(m);
      const done = !!(md && md.done);
      const status = done ? 'feita' : U.nowMin() > U.minutes(t) + 45 ? 'atrasada/pendente' : 'pendente';
      const o = m.opcoes[S.optIndex(hoje, m)];
      return { refeicao: m.nome, horario: t, status, opcao: o.nome, kcal: P.optTotals(o).k, opcional: m.opcional };
    });

    const ultimos = [];
    for (let i = 6; i >= 0; i--) {
      const k = U.addDays(hoje, -i);
      if (k < pr.inicio) continue;
      const s = S.dayStats(k);
      const dd = S.peekDay(k);
      ultimos.push({
        data: k, pontos: s.score, kcal: s.kcal, proteina_g: s.p, refeicoes: `${s.done}/${s.req}`,
        extras_kcal: s.extrasK, agua_ml: dd.agua, caminhada_min: dd.caminhada, refri_latas: dd.refri,
        fissuras_vencidas: s.venci, fissuras_cedeu: s.cedi,
      });
    }

    return {
      agora: `${hoje} ${U.pad(now.getHours())}:${U.pad(now.getMinutes())}`,
      dia_do_plano: S.planDay(hoje),
      perfil: {
        idade: pr.idade, altura_cm: pr.altura, peso_inicial_kg: pr.pesoInicial,
        peso_atual_kg: cur ? cur.kg : pr.pesoInicial, imc: Number(S.bmi(cur ? cur.kg : pr.pesoInicial).toFixed(1)),
        meta_fase1_kg: pr.meta1, meta_final_kg: pr.metaFinal, ritmo_planejado_kg_sem: pr.ritmo,
        tendencia_real_kg_sem: S.trend() == null ? null : Number(S.trend().toFixed(2)),
      },
      metas_diarias: {
        kcal: set.kcal, proteina_g: set.proteina, carbo_max_g: set.carbo, agua_ml: set.agua,
        caminhada_min: set.caminhada, refri_zero_max: set.refriMax, cozinha_fecha: set.cozinhaFecha,
        modo_low_carb_estrito: set.lowcarb,
      },
      hoje: {
        refeicoes, kcal: dTotals.kcal, proteina_g: dTotals.p, carbo_g: dTotals.c, agua_ml: d.agua,
        caminhada_min: d.caminhada, refri_latas: d.refri, pontos: dTotals.score,
        extras: d.extras.map((e) => ({ item: e.label, kcal: e.kcal })), dia_encerrado: d.fechou,
      },
      ultimos_7_dias: ultimos,
      pesos_recentes: S.weightsSorted().slice(-10).map((w) => ({ data: w.date, kg: w.kg })),
    };
  }

  function buildSystem() {
    const set = S.state.settings;
    const ctx = buildContext();
    const sobre = String(set.sobreMim || '').trim().slice(0, 300);
    return `Você é o Coach do app "Plano de Emagrecimento", falando com um adulto de ${ctx.perfil.idade} anos, ${ctx.perfil.altura_cm} cm, IMC ${ctx.perfil.imc}, que escolheu seguir uma dieta restrita, low-carb e rica em proteína (~${set.kcal} kcal, ~${set.proteina} g de proteína, até ${set.carbo} g de carboidrato, 4 refeições fixas + ceia opcional, sem café, refrigerante zero permitido até ${set.refriMax} latas). A pessoa quer uma abordagem rígida e estruturada, não flexível: seja firme e objetivo.${sobre ? `
Sobre a pessoa (escrito por ela mesma): ${sobre}` : ''}

ESTILO: direto, firme, respeitoso e prático. Sem sermão, sem culpa, sem eufemismo, sem tom de pena. Português do Brasil, frases curtas, no máximo ~150 palavras (a menos que peçam mais). Listas curtas quando ajudar. Emojis com muita moderação.

REGRAS:
- Baseie-se SEMPRE nos dados do app (JSON abaixo). Não invente números nem refeições que não estão lá. Se faltar dado, diga o que falta.
- Nunca recomende menos de 1.500 kcal/dia, jejum prolongado, laxantes, diuréticos, "detox", compensar comida com exercício extremo ou qualquer prática de risco.
- Ao sugerir trocas, mantenha calorias e proteína da refeição parecidas e cite valores aproximados. Respeite a lista de alimentos do plano (sem macarrão, feijão, batata, açúcar, suco, álcool, café; pão carioca e arroz só nas doses do plano).
- Não prescreva nem ajuste remédios; não mande começar suplemento além do whey que já está no plano. Para isso, mande falar com o médico.
- Se a pessoa escorregar: sem drama. Diga o que fazer na PRÓXIMA refeição (voltar ao plano, sem pular nem compensar) e uma ação para não repetir.
- Em fissura/vontade de comer fora de hora: dê 1–3 ações imediatas e concretas (500 ml de água, esperar 10 min, mudar de ambiente, pepino/tomate/gelatina zero) e lembre da regra: fome física real perto do horário → antecipar a refeição planejada, nunca um extra.
- Se a pessoa relatar tontura forte, desmaio, palpitação, dor no peito, falta de ar, vômitos persistentes, urina muito escura, câimbras fortes, confusão, ou piora importante do humor/pensamentos de se machucar: oriente buscar atendimento médico agora (SAMU 192; CVV 188 para apoio emocional).
- Se pedirem para mudar metas calóricas ou fugir do plano de forma estrutural, explique em 1–2 frases e sugira conversar com médico/nutricionista.
- Ao dar feedback do dia: 1) o que foi bem, 2) o que falhou (com números), 3) UMA ação concreta para a próxima refeição.

DADOS ATUAIS DO APP (JSON):
${JSON.stringify(ctx)}`;
  }

  // ---- Chamada à API --------------------------------------------------------
  async function call(model, apiKey, body) {
    let res;
    try {
      res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new GeminiError('network', 'Sem conexão com o Gemini. Verifique sua internet e tente de novo.');
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* corpo vazio */
    }
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || res.statusText || 'erro desconhecido';
      if (res.status === 400 && /api key|API_KEY/i.test(msg)) throw new GeminiError('key', 'Chave de API inválida. Confira em Ajustes.', 400);
      if (res.status === 401 || res.status === 403) throw new GeminiError('key', 'A chave não tem permissão (ou a região não é suportada). Confira em Ajustes.', res.status);
      if (res.status === 404) throw new GeminiError('model', `Modelo "${model}" indisponível para sua chave.`, 404);
      if (res.status === 429) throw new GeminiError('quota', 'Limite de uso do Gemini atingido. Espere um pouco e tente de novo.', 429);
      if (res.status >= 500) throw new GeminiError('server', 'O Gemini está instável agora. Tente de novo em instantes.', res.status);
      throw new GeminiError('http', `Erro do Gemini (${res.status}): ${msg}`, res.status);
    }
    const cand = data && data.candidates && data.candidates[0];
    const text = ((cand && cand.content && cand.content.parts) || [])
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join('')
      .trim();
    if (!text) {
      if (data && data.promptFeedback && data.promptFeedback.blockReason) {
        throw new GeminiError('blocked', 'O Gemini bloqueou essa mensagem. Reformule e tente de novo.');
      }
      if (cand && cand.finishReason === 'MAX_TOKENS') throw new GeminiError('empty', 'A resposta estourou o limite antes de terminar. Tente de novo.');
      throw new GeminiError('empty', 'O Gemini não devolveu texto. Tente de novo.');
    }
    return text;
  }

  /** Junta mensagens consecutivas do mesmo papel e garante que comece com "user". */
  function toContents(history) {
    const out = [];
    for (const m of history.filter((x) => x.role === 'user' || x.role === 'model').slice(-14)) {
      const last = out[out.length - 1];
      if (last && last.role === m.role) last.parts[0].text += '\n' + m.text;
      else out.push({ role: m.role, parts: [{ text: m.text }] });
    }
    while (out.length && out[0].role !== 'user') out.shift();
    return out;
  }

  /** Conversa com o coach. Retorna { text, model }. */
  async function ask(history) {
    const set = S.state.settings;
    if (!set.apiKey) throw new GeminiError('nokey', 'Cole sua chave do Gemini em Ajustes para usar o coach.');
    const body = {
      systemInstruction: { parts: [{ text: buildSystem() }] },
      contents: toContents(history),
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    };
    const models = [set.model, FALLBACK_MODEL].filter((m, i, a) => m && a.indexOf(m) === i);
    let lastErr;
    for (const model of models) {
      try {
        return { text: await call(model, set.apiKey, body), model };
      } catch (e) {
        lastErr = e;
        if (e.code !== 'model') throw e;
      }
    }
    throw lastErr;
  }

  /** Teste rápido da chave/modelo. */
  async function test() {
    const set = S.state.settings;
    if (!set.apiKey) throw new GeminiError('nokey', 'Cole a chave primeiro.');
    const text = await call(set.model, set.apiKey, {
      contents: [{ role: 'user', parts: [{ text: 'Responda apenas com a palavra: ok' }] }],
      generationConfig: { maxOutputTokens: 256, temperature: 0 },
    });
    return text;
  }

  g.Gemini = { ask, test, buildContext, buildSystem, toContents, GeminiError };
})(window);
