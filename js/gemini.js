/*
 * Cliente do Gemini (chamado direto do navegador, com a SUA chave).
 * A chave fica só no localStorage deste aparelho e vai no cabeçalho x-goog-api-key.
 *
 * Por que isto é mais elaborado do que um fetch:
 *  - o app descobre (models.list) quais modelos a SUA chave enxerga e escolhe o melhor, em vez de
 *    depender de um nome fixo que pode sair do ar;
 *  - erros passageiros (503 "sobrecarregado", 429, rede) têm nova tentativa com espera;
 *  - se um modelo falha de vez (404, sem cota), passa para o próximo da lista;
 *  - cada falha é registrada para a tela de diagnóstico mostrar o motivo real.
 */
(function (g) {
  'use strict';
  const U = g.U;
  const S = g.Store;
  const P = g.PlanData;

  const BASE = 'https://generativelanguage.googleapis.com/v1beta';
  const CACHE_KEY = 'plano-emagrecer-modelos';
  const DAY_MS = 24 * 3600 * 1000;
  // fora desta lista ficam modelos de imagem, voz, embeddings, agentes etc.
  const SKIP = /tts|image|live|embed|robotics|transcribe|omni|computer|deep-research|antigravity|lyria|veo|imagen|banana|audio|aqa|learnlm|gemma|customtools/i;

  class GeminiError extends Error {
    constructor(code, message, status, extra) {
      super(message);
      this.code = code;
      this.status = status || 0;
      if (extra) Object.assign(this, extra);
    }
  }

  const sleep = (ms, signal) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new GeminiError('aborted', 'Cancelado.', 0, { fatal: true })); }, { once: true });
    });

  // ---- Cache de modelos (fora do backup: vale só para esta chave/aparelho) ----
  const cache = {
    read() {
      try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (e) { return {}; }
    },
    write(o) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ }
    },
    patch(fn) {
      const c = cache.read();
      fn(c);
      cache.write(c);
    },
  };
  const resetCache = () => cache.write({});

  // ===========================================================================
  // Contexto do coach
  // ===========================================================================
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
      const t = S.mealTime(m);
      const foods = S.foodsOf(d, m.id);
      const done = S.mealDone(d, m.id);
      const status = done ? 'feita' : U.nowMin() > U.minutes(t) + 45 ? 'atrasada/pendente' : 'pendente';
      const base = { refeicao: m.nome, horario: t, status, opcional: m.opcional };
      if (foods.length) return { ...base, comeu: foods.map((f) => ({ item: f.nome, kcal: f.kcal, fora_do_plano: f.fora || undefined })) };
      const o = m.opcoes[S.optIndex(hoje, m)];
      return { ...base, opcao_do_plano: o.nome, kcal: P.optTotals(o).k };
    });
    const foraDeHora = S.foodsOf(d, 'ex');

    const ultimos = [];
    for (let i = 6; i >= 0; i--) {
      const k = U.addDays(hoje, -i);
      if (k < pr.inicio) continue;
      const s = S.dayStats(k);
      const dd = S.peekDay(k);
      ultimos.push({
        data: k, pontos: s.score, kcal: s.kcal, proteina_g: s.p, refeicoes: `${s.done}/${s.req}`,
        extras_kcal: s.extrasK, agua_ml: dd.agua, movimento_min: s.move, treino_min: s.treinoMin, refri_latas: dd.refri,
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
        movimento_min: set.caminhada, refri_zero_max: set.refriMax, cozinha_fecha: set.cozinhaFecha,
        modo_low_carb_estrito: set.lowcarb,
      },
      hoje: {
        refeicoes, fora_de_hora: foraDeHora.map((f) => ({ item: f.nome, kcal: f.kcal })),
        kcal: dTotals.kcal, proteina_g: dTotals.p, carbo_g: dTotals.c, agua_ml: d.agua,
        caminhada_min: d.caminhada, treinos: d.treinos.map((t) => ({ tipo: t.tipo, min: t.min, kcal_gastas_estimadas: t.kcal })),
        refri_latas: d.refri, pontos: dTotals.score,
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
- As refeições "comeu" foram contadas pela própria pessoa (por voz ou texto) e as calorias são ESTIMATIVAS da IA: trate como aproximação, não como medida exata.
- Treinos e caminhada contam como movimento. As "kcal gastas" são estimativas e NÃO devem ser usadas para comer mais: o déficit vem do prato.
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

  function buildInterpretSystem() {
    const set = S.state.settings;
    const pr = S.state.profile;
    const now = new Date();
    const hoje = U.key();
    const d = S.peekDay(hoje);
    const cur = S.currentWeight();
    const ctx = {
      agora: `${hoje} ${U.pad(now.getHours())}:${U.pad(now.getMinutes())} (${now.toLocaleDateString('pt-BR', { weekday: 'long' })})`,
      cozinha_fecha: set.cozinhaFecha,
      refeicoes: [...P.MEALS.map((m) => ({ id: m.id, nome: m.nome, horario: S.mealTime(m), ja_registrada_hoje: S.mealDone(d, m.id) })), { id: 'ex', nome: 'Fora de hora / beliscada' }],
      ja_contado_hoje: d.foods.slice(-12).map((f) => `${f.nome} (${f.kcal} kcal, ${f.meal})`),
      peso_atual_kg: cur ? cur.kg : pr.pesoInicial,
    };
    return `Você é o assistente de REGISTRO do app "Plano de Emagrecimento" (dieta low-carb, rica em proteína, ~${set.kcal} kcal/dia). A pessoa fala (áudio) ou escreve, em português do Brasil, o que comeu, bebeu ou treinou. Sua tarefa: entender o relato e devolver SOMENTE um JSON com os registros e uma estimativa honesta de calorias e macros. Nada de texto fora do JSON, nem markdown.

COMO ESTIMAR
- Use porções brasileiras comuns e a tabela TACO. Os valores de cada item já devem estar multiplicados pela quantidade dita (ex.: "dois ovos" = kcal dos dois).
- Se a quantidade não foi dita, assuma a porção típica e escreva a suposição em "obs" (ex.: "assumi 2 colheres de sopa de Nescau, 20 g"). Se a pessoa corrigir algo no meio da fala, vale a versão final.
- Não subestime: na dúvida, use a estimativa média para alta. Medidas: copo americano = 200 ml, lata = 350 ml, colher de sopa cheia de arroz = 25 g, ovo médio = 50 g.
- Um alimento/bebida por item. Preencha kcal, proteina_g, carbo_g e gordura_g de TODOS os itens.
- "refeicao": r1 café da manhã, r2 almoço, r3 lanche da tarde, r4 jantar, r5 ceia, ex = fora de hora/beliscada. Se a pessoa disser a refeição, use-a. Se não disser, escolha a refeição cujo horário esteja mais perto de "agora" (prefira uma que ainda não tenha registro). Depois que a cozinha fecha, ou se for claramente uma beliscada, use "ex".
- "fora_do_plano": true quando o item não é permitido pelo plano: açúcar e achocolatado (Nescau, Toddy), doces, sorvete, biscoito, refrigerante comum, suco, álcool, café, frituras, embutidos, macarrão, feijão, batata, fast-food, pizza, pão além de 1 pão carioca no café. Água, ovos, carnes magras, peixe, frango, laticínios magros, legumes, verduras, whey, cuscuz/tapioca/arroz em dose pequena e 1 laranja são do plano. Em "motivo", diga em poucas palavras por que está fora (ex.: "achocolatado tem açúcar"). Se estiver no plano: false e motivo vazio.
- Água e chá sem açúcar contam em "agua_ml" (copo = 200 ml, garrafa pequena = 500 ml). Leite, suco e refrigerante NÃO são água. Refrigerante ZERO conta em "refri_zero_latas" (lata = 1). Refrigerante comum vai em "comidas" (~140 kcal/lata, fora_do_plano true).
- Treinos em casa (flexão, agachamento, prancha, bicicleta, yoga, alongamento etc.) vão em "treinos", com "minutos" e "kcal" gastas estimadas pelo peso da pessoa (use MET; seja moderado). Caminhada (e corrida leve) vai em "caminhada_min". Se não disse a duração, assuma um valor razoável e escreva em "obs".
- "quando": "ontem" só se a pessoa disser claramente que foi ontem (ou de madrugada/ontem à noite); senão "hoje".
- "peso_kg": só se a pessoa disse que se pesou.
- Não invente nada que não foi dito. Se não entender, ou o relato não tiver nada para registrar, devolva listas vazias e explique em "resposta". Não repita itens de "ja_contado_hoje" a menos que a pessoa diga que comeu de novo.
- "resposta": 1 ou 2 frases curtas e diretas, em pt-BR, confirmando o que registrou e o total de kcal. Se algo estiver fora do plano, diga em uma frase que a próxima refeição é normal (sem pular nem compensar). Sem sermão.
- "duvidas": até 2 perguntas curtas, só se uma informação faltante mudar muito a estimativa (senão []).

FORMATO (JSON puro):
{"transcricao":"o que você ouviu/leu, corrigido","quando":"hoje","comidas":[{"refeicao":"r1","nome":"2 ovos mexidos","kcal":160,"proteina_g":13,"carbo_g":1,"gordura_g":11,"fora_do_plano":false,"motivo":"","obs":"assumi ovos médios e 1 colher de chá de óleo"}],"agua_ml":0,"refri_zero_latas":0,"caminhada_min":0,"treinos":[{"tipo":"agachamento e flexão","minutos":20,"kcal":150,"obs":""}],"peso_kg":null,"resposta":"","duvidas":[]}

CONTEXTO (JSON):
${JSON.stringify(ctx)}`;
  }

  // ===========================================================================
  // Transporte: erros classificados, nova tentativa e troca de modelo
  // ===========================================================================
  async function rawFetch(url, init, timeoutMs, outer) {
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    if (outer) {
      if (outer.aborted) ctl.abort();
      else outer.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctl.signal });
      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        /* corpo vazio ou não-JSON */
      }
      return { res, data };
    } catch (e) {
      if (outer && outer.aborted) throw new GeminiError('aborted', 'Cancelado.', 0, { fatal: true });
      if (ctl.signal.aborted) throw new GeminiError('timeout', 'O Gemini demorou demais para responder.', 0, { retry: true });
      throw new GeminiError('network', 'Sem conexão com o Gemini (ou o app foi para segundo plano durante o envio).', 0, { retry: true });
    } finally {
      clearTimeout(timer);
      if (outer) outer.removeEventListener('abort', onAbort);
    }
  }

  function classify(status, data) {
    const err = (data && data.error) || {};
    const msg = String(err.message || '');
    const details = Array.isArray(err.details) ? err.details : [];
    const reason = String((details.find((d) => d && d.reason) || {}).reason || '');
    const retryInfo = details.find((d) => d && /RetryInfo/.test(d['@type'] || ''));
    const retryAfter = retryInfo && retryInfo.retryDelay ? Math.round(parseFloat(retryInfo.retryDelay) * 1000) || 0 : 0;
    const mk = (code, text, extra) => new GeminiError(code, text, status, { raw: msg, ...extra });

    if (reason === 'API_KEY_INVALID' || /api key not valid|api key expired|invalid api key/i.test(msg)) {
      return mk('key', 'Chave de API inválida ou expirada. Confira em Ajustes.', { fatal: true });
    }
    if (/leaked/i.test(msg)) {
      return mk('key', 'O Google bloqueou esta chave (marcada como vazada). Gere outra em aistudio.google.com/apikey.', { fatal: true });
    }
    if (/REFERRER|API_KEY_.*BLOCKED|IP_ADDRESS_BLOCKED/i.test(reason) || /referer .* are blocked|referrer/i.test(msg)) {
      return mk('referer', 'A chave tem restrição de site e este endereço não está liberado. No Google Cloud (Credenciais), libere este site ou remova a restrição.', { fatal: true });
    }
    if (/SERVICE_DISABLED/i.test(reason) || /has not been used in project|is disabled/i.test(msg)) {
      return mk('service', 'A API Generative Language está desativada no projeto desta chave. Ative-a no Google Cloud ou gere uma chave nova no AI Studio.', { fatal: true });
    }
    if (/location is not supported/i.test(msg)) {
      return mk('region', 'O Gemini não está disponível na sua região para esta chave.', { fatal: true });
    }
    if (status === 400 && /thinking/i.test(msg)) return mk('thinking', msg);
    if (status === 401) return mk('key', 'A chave foi recusada (401). Confira em Ajustes.', { fatal: true });
    if (status === 403) return mk('denied', 'Sua chave não tem permissão para este modelo.');
    if (status === 404) return mk('model', 'Modelo indisponível para a sua chave.');
    if (status === 429) {
      const zero = /limit: ?0/i.test(msg);
      const daily = /per ?day|daily/i.test(msg);
      const text = zero ? 'Este modelo não está liberado no plano gratuito da sua chave.' : daily ? 'A cota diária deste modelo acabou.' : 'Limite de uso do Gemini atingido por agora.';
      return mk('quota', text, { retry: !zero && !daily && retryAfter <= 10000, retryAfter });
    }
    if (status === 408 || status >= 500) return mk('server', 'O Gemini está sobrecarregado agora.', { retry: true, retryAfter });
    if (status === 400) return mk('bad', `Pedido recusado pelo modelo: ${msg || 'sem detalhe'}`);
    return mk('http', `Erro do Gemini (${status}): ${msg || 'sem detalhe'}`);
  }

  function extractText(data) {
    const cand = data && data.candidates && data.candidates[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    const text = parts
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('')
      .trim();
    return { text, finish: cand && cand.finishReason, block: data && data.promptFeedback && data.promptFeedback.blockReason };
  }

  async function callOnce(model, apiKey, body, opts) {
    const { res, data } = await rawFetch(
      `${BASE}/models/${encodeURIComponent(model)}:generateContent`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) },
      opts.timeoutMs || 45000,
      opts.signal
    );
    if (!res.ok) throw classify(res.status, data);
    const { text, finish, block } = extractText(data);
    if (text) return { text, finish };
    if (block) throw new GeminiError('blocked', 'O Gemini bloqueou essa mensagem. Reformule e tente de novo.', 200, { fatal: true });
    if (finish === 'MAX_TOKENS') throw new GeminiError('truncated', 'A resposta foi cortada antes de terminar.', 200, { retry: true });
    if (finish && finish !== 'STOP') throw new GeminiError('blocked', `O Gemini não respondeu (${finish}).`, 200);
    throw new GeminiError('empty', 'O Gemini devolveu uma resposta vazia.', 200, { retry: true });
  }

  // ---- Descoberta de modelos ------------------------------------------------
  function rank(id) {
    const i = P.MODEL_PREF.indexOf(id);
    if (i >= 0) return i;
    const m = id.match(/^gemini-(\d+(?:\.\d+)?)-(flash-lite|flash|pro)/);
    if (!m) return 500;
    const tier = { flash: 0, 'flash-lite': 3, pro: 12 }[m[2]];
    return 100 + (10 - parseFloat(m[1])) * 5 + tier + (/preview|exp/.test(id) ? 2 : 0);
  }

  async function listModels(apiKey, signal) {
    const out = [];
    let token = '';
    for (let page = 0; page < 4; page++) {
      const url = `${BASE}/models?pageSize=200${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
      const { res, data } = await rawFetch(url, { method: 'GET', headers: { 'x-goog-api-key': apiKey } }, 15000, signal);
      if (!res.ok) throw classify(res.status, data);
      for (const m of (data && data.models) || []) {
        const id = String(m.name || '').replace(/^models\//, '');
        if (/^gemini-/.test(id) && !SKIP.test(id) && (m.supportedGenerationMethods || []).includes('generateContent')) out.push(id);
      }
      token = data && data.nextPageToken;
      if (!token) break;
    }
    return out;
  }

  /** Modelos a tentar, em ordem: o que você escolheu, o último que funcionou, depois os melhores disponíveis. */
  async function candidates(apiKey, opts) {
    const set = S.state.settings;
    const c = cache.read();
    const bad = c.bad || {};
    const isBad = (m) => bad[m] && Date.now() - bad[m] < 6 * 3600 * 1000;
    const list = [];
    const add = (m) => {
      if (m && !list.includes(m) && !isBad(m)) list.push(m);
    };
    if (set.model && set.model !== 'auto') add(set.model);
    add(c.ok);
    let avail = c.list && c.ts && Date.now() - c.ts < DAY_MS ? c.list : null;
    if (!avail) {
      try {
        avail = await listModels(apiKey, opts.signal);
        cache.patch((x) => {
          x.list = avail;
          x.ts = Date.now();
        });
      } catch (e) {
        if (e instanceof GeminiError && e.fatal) throw e; // chave inválida/bloqueada: não adianta seguir
        avail = null; // lista indisponível: cai na lista padrão
      }
    }
    const pool = avail && avail.length ? avail.slice().sort((a, b) => rank(a) - rank(b)) : P.MODEL_PREF.slice();
    pool.forEach(add);
    if (!list.length) {
      // todos marcados como ruins (ex.: soluço temporário do Google): esquece as marcas e tenta a lista padrão
      cache.patch((x) => {
        x.bad = {};
      });
      P.MODEL_PREF.slice(0, 4).forEach((m) => list.push(m));
    }
    return list.slice(0, 5);
  }

  const noThink = new Set(); // modelos que recusaram thinkingConfig nesta sessão

  function bodyFor(model, body, thinking, tokens) {
    const b = { ...body, generationConfig: { ...(body.generationConfig || {}), maxOutputTokens: tokens } };
    // raciocínio curto: respostas mais rápidas e sem gastar o limite de saída "pensando"
    if (thinking && !noThink.has(model)) b.generationConfig.thinkingConfig = { thinkingLevel: thinking };
    return b;
  }

  const backoff = (attempt, hint) => (hint ? Math.min(hint, 8000) : attempt === 1 ? 1200 : 3000) + Math.random() * 600;

  function summarize(tried) {
    const codes = tried.map((t) => t.code);
    const has = (c) => codes.includes(c);
    const last = tried[tried.length - 1];
    let msg;
    if (!tried.length) msg = 'Nenhum modelo disponível para tentar. Confira a chave em Ajustes.';
    else if (codes.every((c) => c === 'network' || c === 'timeout')) msg = 'Sem conexão com o Gemini. Verifique a internet e tente de novo.';
    else if (has('server')) msg = `O Gemini está sobrecarregado agora (tentei ${new Set(tried.map((t) => t.model)).size} modelo(s)). Tente de novo em instantes.`;
    else if (codes.every((c) => c === 'quota')) msg = 'Limite de uso do Gemini atingido nos modelos testados. Espere alguns minutos e tente de novo.';
    else if (codes.every((c) => c === 'model' || c === 'denied' || c === 'quota')) msg = 'Nenhum dos modelos testados está liberado para a sua chave. Abra Ajustes → Diagnóstico para ver o motivo de cada um.';
    else msg = `Não consegui falar com o Gemini. Último erro: ${last.message}`;
    const detail = tried.map((t) => `${t.model} · ${t.code}${t.status ? ' ' + t.status : ''} · ${String(t.message).slice(0, 160)}`).join('\n');
    return new GeminiError('all', msg, 0, { tried, detail });
  }

  /**
   * Chama o Gemini com nova tentativa e troca de modelo.
   * opts: { onStatus(texto), signal, thinking:'low'|…|null, timeoutMs, budgetMs }
   */
  async function generate(body, opts = {}) {
    const apiKey = S.state.settings.apiKey;
    if (!apiKey) throw new GeminiError('nokey', 'Cole sua chave do Gemini em Ajustes para usar o coach.', 0, { fatal: true });
    const status = opts.onStatus || (() => {});
    const deadline = Date.now() + (opts.budgetMs || 75000);
    const tried = [];
    const thinking = opts.thinking === undefined ? 'low' : opts.thinking;
    let tokens = (body.generationConfig && body.generationConfig.maxOutputTokens) || 4096;

    status('Preparando…');
    const chain = await candidates(apiKey, opts);

    for (const model of chain) {
      let attempt = 0;
      while (attempt < 3 && Date.now() < deadline) {
        status(attempt ? `Tentando de novo (${model})…` : `Consultando ${model}…`);
        try {
          const r = await callOnce(model, apiKey, bodyFor(model, body, thinking, tokens), opts);
          cache.patch((c) => {
            c.ok = model;
          });
          return { text: r.text, model, tried };
        } catch (e) {
          if (!(e instanceof GeminiError)) throw e;
          tried.push({ model, code: e.code, status: e.status, message: e.raw || e.message });
          if (e.fatal) throw Object.assign(e, { tried, detail: summarize(tried).detail });
          if (e.code === 'thinking' && !noThink.has(model)) {
            noThink.add(model); // este modelo não aceita o ajuste: repete sem ele (não conta como tentativa)
            continue;
          }
          if (e.code === 'truncated' && tokens < 16384) {
            tokens *= 2;
            attempt++;
            continue;
          }
          if (e.code === 'model') {
            cache.patch((c) => {
              c.bad = { ...(c.bad || {}), [model]: Date.now() };
              if (c.list) c.list = c.list.filter((m) => m !== model);
            });
            break;
          }
          if (e.retry) {
            attempt++;
            if (attempt < 3) {
              await sleep(backoff(attempt, e.retryAfter), opts.signal);
              continue;
            }
          }
          break;
        }
      }
    }
    throw summarize(tried);
  }

  // ===========================================================================
  // Operações
  // ===========================================================================
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
  async function ask(history, opts = {}) {
    const out = await generate(
      { systemInstruction: { parts: [{ text: buildSystem() }] }, contents: toContents(history), generationConfig: { maxOutputTokens: 6144 } },
      opts
    );
    return { text: out.text, model: out.model };
  }

  /** Transcreve um áudio (WAV em base64). */
  async function transcribe(audio, opts = {}) {
    const out = await generate(
      {
        systemInstruction: { parts: [{ text: 'Transcreva fielmente o áudio em português do Brasil. Responda SOMENTE com a transcrição, sem comentários, sem aspas.' }] },
        contents: [{ role: 'user', parts: [{ text: 'Transcreva este áudio.' }, { inline_data: { mime_type: audio.mime, data: audio.b64 } }] }],
        generationConfig: { maxOutputTokens: 2048 },
      },
      { timeoutMs: 60000, ...opts }
    );
    return out.text.replace(/^["“]|["”]$/g, '').trim();
  }

  function parseJSON(text) {
    const t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      return JSON.parse(t);
    } catch (e) {
      /* tenta recortar o objeto */
    }
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch (e) {
        /* cai no erro abaixo */
      }
    }
    throw new GeminiError('parse', 'Não consegui entender a resposta da IA.', 200, { retry: true, raw: t.slice(0, 160) });
  }

  /** Número tolerante: aceita "150", "1,5", "150-200" (média) e texto com unidade. */
  function toNum(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const m = String(v == null ? '' : v).match(/\d+(?:[.,]\d+)?/g);
    if (!m) return 0;
    const n = m.slice(0, 2).map((x) => parseFloat(x.replace(',', '.')));
    return n.reduce((a, b) => a + b, 0) / n.length;
  }

  /** Valida e limpa o JSON do modelo: nada que venha dele entra no app sem passar por aqui. */
  function normalize(raw, nowMin) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const num = (v, lo, hi, dec = 0) => {
      const m = Math.pow(10, dec);
      return Math.round(U.clamp(toNum(v), lo, hi) * m) / m;
    };
    const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
    const slots = new Set([...P.MEALS.map((m) => m.id), 'ex']);

    const comidas = (Array.isArray(o.comidas) ? o.comidas : [])
      .slice(0, 20)
      .map((x) => {
        x = x && typeof x === 'object' ? x : {};
        const p = num(x.proteina_g, 0, 300, 1);
        const c = num(x.carbo_g, 0, 400, 1);
        const f = num(x.gordura_g, 0, 300, 1);
        let kcal = num(x.kcal, 0, 4000);
        if (!kcal && (p || c || f)) kcal = Math.round(p * 4 + c * 4 + f * 9);
        return {
          meal: slots.has(x.refeicao) ? x.refeicao : S.guessMeal(nowMin),
          nome: str(x.nome, 70),
          kcal, p, c, f,
          fora: x.fora_do_plano === true || x.fora_do_plano === 'true',
          motivo: str(x.motivo, 90),
          obs: str(x.obs, 140),
        };
      })
      .filter((x) => x.nome);

    const treinos = (Array.isArray(o.treinos) ? o.treinos : [])
      .slice(0, 6)
      .map((t) => {
        t = t && typeof t === 'object' ? t : {};
        return { tipo: str(t.tipo, 50) || 'Treino', min: num(t.minutos, 0, 300), kcal: num(t.kcal, 0, 2500), obs: str(t.obs, 140) };
      })
      .filter((t) => t.min > 0);

    const peso = num(o.peso_kg, 0, 400, 1);
    const out = {
      transcricao: str(o.transcricao, 400),
      quando: /ontem/i.test(String(o.quando || '')) ? 'ontem' : 'hoje',
      comidas,
      treinos,
      agua: num(o.agua_ml, 0, 6000),
      refri: Math.round(num(o.refri_zero_latas, 0, 12)),
      caminhada: num(o.caminhada_min, 0, 300),
      peso: peso >= 40 ? peso : 0,
      resposta: str(o.resposta, 260),
      duvidas: (Array.isArray(o.duvidas) ? o.duvidas : []).slice(0, 2).map((d) => str(d, 120)).filter(Boolean),
    };
    out.vazio = !out.comidas.length && !out.treinos.length && !out.agua && !out.refri && !out.caminhada && !out.peso;
    return out;
  }

  /**
   * Entende um relato (áudio WAV em base64 e/ou texto) e devolve os registros estimados.
   * input = { audio?: { b64, mime }, text?: string }
   */
  async function interpret(input, opts = {}) {
    const parts = [];
    // a pessoa tocou no botão de uma refeição (ou de treino): vale como dica, a fala tem prioridade
    if (input.meal && P.SLOT_NOMES[input.meal]) {
      parts.push({ text: `A pessoa abriu o registro pela refeição "${P.SLOT_NOMES[input.meal]}" (id ${input.meal}). Use essa refeição para os alimentos, a menos que ela diga claramente outra.` });
    } else if (input.hint === 'treino') {
      parts.push({ text: 'A pessoa abriu o registro para contar um treino. Se ela também falar de comida ou água, registre.' });
    }
    if (input.text) parts.push({ text: `Relato escrito pela pessoa:\n"""${String(input.text).slice(0, 1500)}"""` });
    if (input.audio) {
      parts.push({ text: 'Registre o que a pessoa disse neste áudio.' });
      parts.push({ inline_data: { mime_type: input.audio.mime, data: input.audio.b64 } });
    }
    if (!parts.length) throw new GeminiError('empty', 'Nada para interpretar.', 0, { fatal: true });
    const body = {
      systemInstruction: { parts: [{ text: buildInterpretSystem() }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4096 },
    };
    const nowMin = U.nowMin();
    let lastErr;
    for (let i = 0; i < 2; i++) {
      const out = await generate(body, { timeoutMs: 60000, ...opts });
      try {
        const res = normalize(parseJSON(out.text), nowMin);
        res.model = out.model;
        return res;
      } catch (e) {
        if (!(e instanceof GeminiError) || e.code !== 'parse') throw e;
        lastErr = e; // JSON malformado: pede de novo uma vez
      }
    }
    throw lastErr;
  }

  const PING = { contents: [{ role: 'user', parts: [{ text: 'Responda apenas com a palavra: ok' }] }], generationConfig: { maxOutputTokens: 1024 } };

  /** Teste rápido: mostra qual modelo respondeu. */
  async function test(opts = {}) {
    const t0 = performance.now();
    const out = await generate(PING, { budgetMs: 40000, ...opts });
    return { model: out.model, ms: Math.round(performance.now() - t0) };
  }

  /** Diagnóstico: testa cada modelo candidato (uma tentativa só) e devolve o motivo de cada falha. */
  async function diagnose(onUpdate) {
    const apiKey = S.state.settings.apiKey;
    if (!apiKey) throw new GeminiError('nokey', 'Cole a chave primeiro.', 0, { fatal: true });
    const res = { listed: null, listError: null, rows: [] };
    let avail = null;
    try {
      avail = await listModels(apiKey);
      res.listed = avail.length;
      cache.patch((x) => {
        x.list = avail;
        x.ts = Date.now();
        x.bad = {};
      });
    } catch (e) {
      res.listError = e.message;
      if (e.fatal) {
        if (onUpdate) onUpdate(res);
        return res;
      }
    }
    const models = (avail && avail.length ? avail.slice().sort((a, b) => rank(a) - rank(b)) : P.MODEL_PREF).slice(0, 6);
    for (const model of models) {
      const row = { model, ok: false, ms: 0, code: '', message: '' };
      res.rows.push(row);
      if (onUpdate) onUpdate(res);
      const t0 = performance.now();
      for (const thinking of ['low', null]) {
        const b = { ...PING, generationConfig: { ...PING.generationConfig } };
        if (thinking) b.generationConfig.thinkingConfig = { thinkingLevel: thinking };
        try {
          await callOnce(model, apiKey, b, { timeoutMs: 25000 });
          row.ok = true;
          row.code = '';
          row.message = thinking ? '' : 'funciona (sem ajuste de raciocínio)';
          break;
        } catch (e) {
          row.code = e.code || 'erro';
          row.message = e.raw || e.message;
          if (e.code === 'truncated') {
            row.ok = true; // respondeu; só cortou pelo limite minúsculo do teste
            row.message = 'funciona';
            break;
          }
          if (e.code !== 'thinking') break;
        }
      }
      row.ms = Math.round(performance.now() - t0);
      row.done = true;
      if (row.ok) cache.patch((c) => { c.ok = c.ok || model; });
      if (onUpdate) onUpdate(res);
    }
    return res;
  }

  g.Gemini = { ask, transcribe, interpret, test, diagnose, resetCache, buildContext, buildSystem, buildInterpretSystem, toContents, normalize, parseJSON, GeminiError };
})(typeof window !== 'undefined' ? window : globalThis);
