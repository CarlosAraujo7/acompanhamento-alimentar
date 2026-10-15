/*
 * Dados do plano alimentar.
 * Valores aproximados (base: tabela TACO / rótulos). Cada item: F(texto, kcal, proteína g, carbo g, gordura g).
 * O total de cada opção é calculado pelo código — para mudar o plano, mude os itens.
 */
(function (g) {
  'use strict';

  const F = (t, k, p, c, f) => ({ t, k, p, c, f });

  // ---- Itens reutilizáveis -------------------------------------------------
  const I = {
    salada: F('Salada ampla: folhas, pepino, tomate e cenoura ralada (~250 g) + limão ou vinagre', 55, 2, 10, 0.3),
    legumes: F('Legumes cozidos ou refogados: abobrinha, chuchu, brócolis (150 g)', 40, 2, 7, 0.3),
    legumes250: F('Legumes refogados ou assados: brócolis, couve-flor, abobrinha (250 g)', 66, 3.5, 12, 0.5),
    azeite: F('Azeite: 1 colher de chá', 40, 0, 0, 4.5),
    cuscuz: F('Cuscuz de milho cozido: 100 g (½ xícara cheia)', 113, 2.2, 25, 0.7),
    tapioca: F('Tapioca pequena: 2 colheres de sopa de goma hidratada (~50 g)', 110, 0, 27, 0),
    paoCarioca: F('Pão carioca: 1 unidade (~50 g)', 150, 4, 29, 1.5),
    arroz: F('Arroz cozido, branco ou integral: 100 g (4 colheres de sopa cheias)', 128, 2.5, 28, 0.2),
    laranja: F('Laranja: 1 unidade média (~150 g)', 56, 1.4, 13.4, 0.2),
    queijo: F('Queijo minas frescal: 30 g', 80, 5, 1, 6),
    tomPep: F('Tomate e pepino à vontade (~150 g)', 25, 1, 5, 0),
    atum: F('Atum em água: 1 lata (~120 g drenado)', 120, 26, 0, 1),
    iogurte: F('Iogurte natural desnatado: 170 g', 70, 6.5, 10, 0.2),
    whey: F('Whey protein: 1 scoop (30 g) misturado no iogurte', 120, 24, 3, 1.5),
    frango150: F('Peito de frango grelhado: 150 g', 240, 48, 0, 4),
    frangoDesf100: F('Frango desfiado: 100 g', 160, 32, 0, 3),
    frangoDesf120: F('Frango desfiado: 120 g', 192, 38, 0, 3.6),
    patinho120: F('Patinho moído ou em bife, grelhado/refogado: 120 g', 263, 43, 0, 9),
    peixe200: F('Tilápia ou pescada grelhada: 200 g', 260, 52, 0, 4),
    ovoCozido: F('1 ovo cozido', 75, 6.3, 0.4, 5),
  };

  // ---- Refeições -----------------------------------------------------------
  // sc = "sem carboidrato de prato" (usado no modo low-carb estrito)
  const MEALS = [
    {
      id: 'r1',
      nome: 'Café da manhã',
      icone: '🍳',
      hora: '10:30',
      opcional: false,
      dica: 'Antes de comer: 500 ml de água. Proteína primeiro, tapioca, cuscuz ou pão por último.',
      opcoes: [
        { nome: 'Omelete + tapioca', itens: [F('Omelete: 2 ovos + 3 claras', 201, 23.4, 1.2, 10), I.azeite, I.tapioca, I.queijo, I.tomPep] },
        { nome: 'Cuscuz com ovos', itens: [I.cuscuz, F('2 ovos mexidos + 2 claras', 184, 19.8, 1.4, 10), I.azeite, I.queijo, I.tomPep] },
        { nome: 'Tapioca de atum', itens: [I.tapioca, I.atum, I.ovoCozido, F('Tomate, pepino e cebola (~100 g)', 25, 1, 5, 0), F('2 claras mexidas', 34, 7.2, 0.5, 0), I.queijo] },
        { nome: 'Cuscuz com frango', itens: [I.cuscuz, I.frangoDesf100, I.ovoCozido, I.queijo, I.tomPep] },
        { nome: 'Pão carioca com ovos', itens: [I.paoCarioca, F('Omelete: 2 ovos + 3 claras (frigideira antiaderente)', 201, 23.4, 1.2, 10), I.queijo, I.tomPep] },
        { nome: 'Sem carboidrato: iogurte + ovos', sc: true, itens: [I.iogurte, I.whey, F('2 ovos cozidos', 150, 12.6, 0.8, 10), F('Pepino em palitos (100 g)', 10, 0.5, 2, 0), I.queijo] },
      ],
    },
    {
      id: 'r2',
      nome: 'Almoço',
      icone: '🍗',
      hora: '13:30',
      opcional: false,
      dica: 'Ordem: salada, proteína, por último o cuscuz ou o arroz. Monte o prato antes de sentar e não repita.',
      opcoes: [
        { nome: 'Frango grelhado', itens: [I.salada, I.legumes, I.azeite, I.cuscuz, I.frango150] },
        { nome: 'Carne moída (patinho)', itens: [I.salada, I.legumes, I.azeite, I.cuscuz, I.patinho120] },
        { nome: 'Peixe grelhado', itens: [I.salada, I.legumes, I.azeite, I.cuscuz, I.peixe200] },
        { nome: 'Frango com arroz', itens: [I.salada, I.legumes, I.azeite, I.arroz, I.frango150] },
        { nome: 'Sem carboidrato: frango + ovo', sc: true, itens: [I.salada, F('Legumes cozidos ou refogados (250 g)', 66, 3.5, 12, 0.5), I.azeite, I.frango150, I.ovoCozido] },
      ],
    },
    {
      id: 'r3',
      nome: 'Lanche da tarde',
      icone: '🥛',
      hora: '16:30',
      opcional: false,
      dica: 'Quem pula o lanche chega com fome ao jantar. Não pule.',
      opcoes: [
        { nome: 'Iogurte proteico', sc: true, itens: [I.iogurte, I.whey, I.laranja] },
        { nome: 'Atum com palitos', sc: true, itens: [I.atum, I.ovoCozido, F('Cenoura em palitos (100 g)', 34, 0.9, 7.7, 0.2), F('Pepino em palitos (100 g)', 10, 0.7, 2, 0)] },
        { nome: 'Ovos e claras', sc: true, itens: [F('2 ovos cozidos + 2 claras cozidas', 184, 19.8, 1.2, 10), F('Tomate-cereja (100 g)', 18, 0.9, 3.9, 0.2)] },
        { nome: 'Frango desfiado', sc: true, itens: [I.frangoDesf120, F('Cenoura e pepino em palitos (150 g)', 35, 1.2, 8, 0.1)] },
      ],
    },
    {
      id: 'r4',
      nome: 'Jantar',
      icone: '🐟',
      hora: '19:30',
      opcional: false,
      dica: 'Sem carboidrato de prato. Comeu o prato, acabou. Depois, só água ou chá.',
      opcoes: [
        { nome: 'Frango + legumes', sc: true, itens: [I.frango150, I.legumes250, I.salada, I.azeite] },
        { nome: 'Peixe + legumes', sc: true, itens: [I.peixe200, I.legumes250, I.salada, I.azeite] },
        { nome: 'Carne + legumes', sc: true, itens: [I.patinho120, I.legumes250, I.salada, I.azeite] },
        { nome: 'Omelete + legumes', sc: true, itens: [F('Omelete: 2 ovos + 3 claras', 201, 23.4, 1.2, 10), I.queijo, I.legumes250, I.salada, I.azeite] },
      ],
    },
    {
      id: 'r5',
      nome: 'Ceia (opcional)',
      icone: '🌙',
      hora: '21:30',
      opcional: true,
      dica: 'Só se tiver fome de verdade. Sem fome real: chá e pronto — a cozinha fecha depois disso.',
      opcoes: [
        { nome: 'Iogurte com canela', sc: true, itens: [I.iogurte] },
        { nome: 'Claras cozidas', sc: true, itens: [F('3 claras cozidas com sal e pimenta', 51, 10.8, 0.8, 0)] },
        { nome: 'Gelatina zero', sc: true, itens: [F('Gelatina zero: 1 porção', 10, 2, 0, 0)] },
      ],
    },
  ];

  const _cache = new WeakMap();
  function optTotals(o) {
    if (_cache.has(o)) return _cache.get(o);
    const t = o.itens.reduce(
      (a, i) => ({ k: a.k + i.k, p: a.p + i.p, c: a.c + i.c, f: a.f + i.f }),
      { k: 0, p: 0, c: 0, f: 0 }
    );
    const r = { k: Math.round(t.k), p: Math.round(t.p), c: Math.round(t.c), f: Math.round(t.f) };
    _cache.set(o, r);
    return r;
  }

  // ---- Metas padrão --------------------------------------------------------
  const TARGETS = { kcal: 1650, proteina: 170, carbo: 130, agua: 3000, caminhada: 30, refriMax: 3, cozinhaFecha: '22:00' };

  // ---- Conteúdo de apoio ---------------------------------------------------
  const REGRAS = [
    ['Horário é lei.', 'Coma nos horários do app (tolerância de 30 min). Não pule refeição para “economizar”: é isso que gera a fome descontrolada à noite.'],
    ['Proteína primeiro.', 'Em toda refeição, comece pela proteína. Ela segura a fome e protege o músculo enquanto você perde gordura.'],
    ['Prato montado antes de sentar.', 'Comeu o prato, acabou. Sem repetir, sem beliscar enquanto cozinha. Nas primeiras semanas, use balança de cozinha.'],
    ['Carboidrato de prato só 2 vezes ao dia.', 'No café da manhã (tapioca, cuscuz ou pão carioca) e no almoço (cuscuz ou arroz). Lanche e jantar sem carboidrato de prato (legumes e verduras à vontade).'],
    ['A cozinha fecha às 22h.', 'Depois do horário: água, chá sem açúcar ou gelatina zero. Sem exceção, sem “só um pouquinho”.'],
    ['Zero líquidos calóricos.', 'Sem suco, refrigerante comum, álcool ou café com açúcar. Refrigerante zero é permitido até o limite diário.'],
    ['Água: 3 litros.', 'Comece o dia com 500 ml antes da primeira refeição. Distribua o resto, sem passar de ~4 L/dia.'],
    ['Café fora.', 'Cafeína em excesso pode aumentar a inquietação e atrapalhar o sono em algumas pessoas. Mantenha o café fora. Refrigerante cola zero tem um pouco de cafeína: prefira versões sem cafeína (guaraná, limão, laranja zero) a partir das 15h.'],
    ['Escorregou? Não compense.', 'Registre o extra no app e volte ao plano na próxima refeição. Nada de pular refeição ou “limpar” depois — compensar é o que vira bola de neve.'],
    ['Sem dia livre.', 'A flexibilidade que não funcionou antes não volta agora. Se quiser mudar o plano, mude pelo app/nutricionista, não no impulso.'],
  ];

  const LIVRES = [
    'Pepino, tomate, folhas (alface, rúcula, agrião), rabanete, repolho',
    'Abobrinha, chuchu, couve-flor, brócolis, berinjela, vagem',
    'Limão, vinagre, mostarda, pimenta, ervas e temperos secos, alho, cebola',
    'Chá sem açúcar, água com gás, caldo caseiro de legumes (sem óleo)',
    'Gelatina zero',
  ];
  const LIMITADOS = [
    'Tapioca, cuscuz, pão carioca e arroz: só nas doses do plano (café e almoço)',
    'Cenoura: até 150 g/dia',
    'Fruta: 1 laranja por dia (no lanche da tarde)',
    'Azeite: até 3 colheres de chá por dia (já estão nas refeições)',
    'Queijos: só o minas frescal/ricota nas porções do plano',
    'Refrigerante zero: até 3 latas por dia',
    'Whey protein: 1 scoop por dia (lanche; também no café, na opção sem carboidrato)',
  ];
  const FORA = [
    'Açúcar, doces, sorvete, chocolate, biscoitos, bolos',
    'Macarrão, feijão, batata, inhame, macaxeira, farofa e qualquer pão além do carioca do plano (nesta fase)',
    'Frituras, embutidos (salsicha, linguiça, presunto), molhos prontos, maionese',
    'Suco (mesmo natural), refrigerante comum, energético, álcool',
    'Fast-food, pizza, lanches',
    'Café e outras fontes fortes de cafeína (escolha deste plano)',
  ];

  const COMPRAS = [
    { cat: 'Proteínas', itens: ['Ovos: 30 unidades (2 cartelas)', 'Peito de frango: 1,5 kg', 'Patinho (moído ou bife): 500 g', 'Tilápia ou pescada: 800 g', 'Atum em água: 5 latas', 'Queijo minas frescal: 300 g', 'Iogurte natural desnatado: 7 potes de 170 g', 'Claras líquidas pasteurizadas (opcional)', 'Whey protein: 1 pote'] },
    { cat: 'Carboidratos do plano', itens: ['Goma de tapioca hidratada: 500 g', 'Flocão de milho (cuscuz): 500 g', 'Pão carioca: 7 unidades (1 por dia, se for a opção do café)', 'Arroz branco ou integral: 500 g'] },
    { cat: 'Hortifruti', itens: ['Tomate: 1,5 kg', 'Pepino: 1,5 kg', 'Cenoura: 1 kg', 'Folhas (alface, rúcula, agrião): 4 maços', 'Abobrinha e chuchu: 1,5 kg', 'Brócolis e couve-flor: 1,5 kg', 'Limão: 8', 'Cebola e alho', 'Laranja: 4 a 7 unidades (opção do lanche com iogurte e whey)'] },
    { cat: 'Despensa', itens: ['Azeite extra virgem (use colher de chá para medir)', 'Vinagre, mostarda, sal, pimenta, orégano, páprica', 'Gelatina zero', 'Chás sem açúcar', 'Refrigerante zero (dentro do limite)'] },
  ];

  const PROTOCOLO = [
    'Pare e nomeie: é fome física (você comeria frango com salada agora?) ou vontade de algo específico?',
    'Beba 500 ml de água gelada agora.',
    'Mude de ambiente por 10 minutos: banho, escovar os dentes ou uma volta a pé.',
    'Passou 10 min, é fome física e faltam menos de 60 min para a próxima refeição? Antecipe a refeição planejada (nunca um extra).',
    'Ainda quer mastigar? Pepino, tomate, cenoura, gelatina zero ou chá.',
    'Registre no app: venci ou cedi. Cedeu? Não compense: a próxima refeição é normal.',
  ];

  const MOVIMENTO = [
    'Meta: caminhar 30 min por dia, em ritmo que ainda permita conversar. Se joelho/tornozelo reclamarem, divida em 3 × 10 min.',
    'A partir da semana 5: 40–45 min. Prefira baixo impacto (caminhada, bicicleta, natação, elíptico).',
    'Se tiver acesso a academia: musculação 2–3×/semana (corpo inteiro). Preserva músculo e acelera o resultado.',
    'Não use exercício para “pagar” comida. O déficit vem do prato; o exercício melhora saúde e manutenção.',
  ];

  const SAUDE = {
    exames: [
      'Glicemia de jejum e hemoglobina glicada (HbA1c)',
      'Perfil lipídico (colesterol total, LDL, HDL, triglicerídeos)',
      'TGO/TGP e gama-GT (gordura no fígado)',
      'Creatinina e ureia (rins — importante com dieta mais rica em proteína)',
      'Sódio e potássio; TSH; vitamina D e B12; hemograma',
      'Vale perguntar ao médico sobre avaliação de apneia do sono (comum nesse peso e piora fome/energia)',
    ],
    alertas: [
      'Tontura forte, desmaio ou visão escurecendo',
      'Palpitação, dor no peito ou falta de ar fora do normal',
      'Vômitos persistentes, câimbras fortes, urina muito escura, confusão',
      'Piora importante do humor, desânimo intenso ou pensamentos de se machucar (SAMU 192; CVV 188)',
    ],
    notas: [
      'Este plano não substitui acompanhamento profissional. Se você usa remédios (pressão, diabetes, etc.), avise o médico antes: com a perda de peso a dose pode precisar de ajuste.',
      'Não pare nem altere remédios de uso contínuo (por exemplo, antidepressivos) por causa da dieta. Qualquer mudança é decisão do seu médico.',
      'Com pouco carboidrato o corpo perde sódio: sal na comida é permitido. Se sentir dor de cabeça/fraqueza nos primeiros dias, caldo de legumes salgado costuma ajudar.',
    ],
  };

  // Mifflin-St Jeor (fórmula para homens) x 1,2 (pouca atividade). Os números vêm do perfil digitado no aparelho.
  const fmt = (n) => Math.round(n).toLocaleString('pt-BR');
  const CALCULO = {
    generico:
      'Gasto basal estimado pela fórmula de Mifflin-St Jeor para homens (10 × peso em kg + 6,25 × altura em cm − 5 × idade + 5), multiplicado por 1,2 (pouca atividade) para chegar ao gasto total. A meta calórica fica cerca de metade do gasto total estimado: um déficit grande, que na prática rende 1,0–1,4 kg/semana, com queda maior nas 2 primeiras semanas por perda de água. Conforme o peso cai, o gasto cai: revise a meta a cada 10 kg perdidos. Abaixo de 1.500 kcal/dia, só com acompanhamento médico.',
    texto(kg, altura, idade, kcalMeta) {
      const bmr = 10 * kg + 6.25 * altura - 5 * idade + 5;
      const tdee = bmr * 1.2;
      const deficit = tdee - kcalMeta;
      const kgSem = (deficit * 7) / 7700;
      return `Gasto basal estimado (Mifflin-St Jeor, ${kg.toLocaleString('pt-BR')} kg / ${altura} cm / ${idade} anos): ~${fmt(bmr)} kcal. Com pouca atividade, o gasto total fica em ~${fmt(tdee)} kcal. A meta de ~${fmt(kcalMeta)} kcal cria um déficit de ~${fmt(deficit)} kcal/dia (teórico ~${kgSem.toFixed(1).replace('.', ',')} kg de gordura/semana; na prática, espere 1,0–1,4 kg/semana, com queda maior nas 2 primeiras semanas por perda de água). Conforme o peso cai, o gasto cai: revise a meta a cada 10 kg perdidos. Abaixo de 1.500 kcal/dia, só com acompanhamento médico.`;
    },
  };

  const QUICK_PROMPTS = [
    'Analise meu dia e diga o que ajustar nas próximas refeições.',
    'Estou com muita vontade de comer fora do horário. Me ajude agora.',
    'Faça o resumo da minha semana e diga o que melhorar.',
    'Sugira uma troca para o meu almoço de hoje com calorias parecidas.',
    'Escorreguei hoje. O que faço na próxima refeição?',
  ];

  const EXTRAS_PRESETS = [
    ['Beliscada', 150],
    ['Lanche, pão ou doce', 350],
    ['Refeição extra', 700],
    ['Fast-food ou pizza', 1100],
  ];

  const MODELS = ['gemini-3.7-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

  g.PlanData = { MEALS, optTotals, TARGETS, REGRAS, LIVRES, LIMITADOS, FORA, COMPRAS, PROTOCOLO, MOVIMENTO, SAUDE, CALCULO, QUICK_PROMPTS, EXTRAS_PRESETS, MODELS };
})(typeof window !== 'undefined' ? window : globalThis);
