const path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'js/data.js'));
const P = globalThis.PlanData;
const req = P.MEALS.filter((m) => !m.opcional);
const sumMin = req.reduce((a, m) => a + Math.min(...m.opcoes.map((o) => P.optTotals(o).k)), 0);
const sumMax = req.reduce((a, m) => a + Math.max(...m.opcoes.map((o) => P.optTotals(o).k)), 0);
const pMin = req.reduce((a, m) => a + Math.min(...m.opcoes.map((o) => P.optTotals(o).p)), 0);
const pMax = req.reduce((a, m) => a + Math.max(...m.opcoes.map((o) => P.optTotals(o).p)), 0);
const list = (a) => a.map((x) => `- ${x}`).join('\n');
const T = P.TARGETS;
let md = `# Plano alimentar restrito

> Gerado a partir dos mesmos dados do app (\`js/data.js\`). Se mudar o plano lá, rode o gerador de novo.
> Valores aproximados (tabela TACO / rótulos). Este plano **não substitui** acompanhamento médico/nutricional.

## Resumo

| | |
|---|---|
| Meta de calorias | ~${T.kcal} kcal/dia (faixa real das 4 refeições: ${sumMin}–${sumMax} kcal) |
| Proteína | ~${T.proteina} g/dia (4 refeições: ${pMin}–${pMax} g) |
| Carboidrato | até ~${T.carbo} g/dia (café: tapioca, cuscuz ou pão carioca; almoço: cuscuz ou arroz; o resto vem de legumes, verduras e laticínios) |
| Água | ${T.agua / 1000} L/dia |
| Caminhada | ${T.caminhada} min/dia |
| Refrigerante zero | até ${T.refriMax} latas/dia |
| Cozinha fecha | ${T.cozinhaFecha} |
| Café | fora do plano |

**Horários:** ${P.MEALS.map((m) => `${m.hora} ${m.nome}`).join(' · ')}

## Como a meta foi calculada

${P.CALCULO.generico}

## Regras de ouro

${P.REGRAS.map(([t, d], i) => `${i + 1}. **${t}** ${d}`).join('\n')}

## Refeições e opções

Escolha uma opção por refeição (o app sugere uma por dia, em rodízio, e você pode trocar). Cada opção já traz calorias e proteína parecidas com as outras da mesma refeição.
`;
for (const m of P.MEALS) {
  md += `\n### ${m.icone} ${m.nome} — ${m.hora}\n\n_${m.dica}_\n`;
  m.opcoes.forEach((o, i) => {
    const t = P.optTotals(o);
    md += `\n**Opção ${String.fromCharCode(65 + i)} — ${o.nome}**${o.sc ? ' _(sem carboidrato de prato)_' : ''}\n\n${list(o.itens.map((x) => x.t))}\n\n> **${t.k} kcal** · P ${t.p} g · C ${t.c} g · G ${t.f} g\n`;
  });
}
md += `
## Alimentos

**À vontade**

${list(P.LIVRES)}

**Com limite**

${list(P.LIMITADOS)}

**Fora do plano**

${list(P.FORA)}

## Lista de compras (1 semana)

${P.COMPRAS.map((c) => `**${c.cat}**\n\n${list(c.itens)}`).join('\n\n')}

_Quantidades aproximadas para 7 dias; ajuste conforme as opções escolhidas._

## Protocolo anti-fissura

${P.PROTOCOLO.map((p, i) => `${i + 1}. ${p}`).join('\n')}

## Movimento

${list(P.MOVIMENTO)}

## Saúde

**Exames para pedir ao médico**

${list(P.SAUDE.exames)}

**Procure atendimento se houver**

${list(P.SAUDE.alertas)}

**Observações**

${list(P.SAUDE.notas)}
`;
require('fs').writeFileSync(path.join(root, 'PLANO.md'), md, 'utf8');
console.log('PLANO.md gerado,', md.length, 'caracteres');
