# Plano de Emagrecimento (PWA)

App instalável no celular para seguir o plano alimentar restrito: diário com horários, **registro por voz** (comida, água, treino, peso), água/movimento/refri zero, botão de fissura, gráfico de peso, previsão de metas, pontos e sequência, e um coach com IA (Gemini).

O plano completo está em [PLANO.md](PLANO.md). Tudo roda no navegador, sem servidor e sem build: são só arquivos estáticos.

Navegação: **Hoje · Progresso · 🎙️ (registro por voz) · Plano · Coach**. Os **Ajustes** ficam na engrenagem do canto superior direito de cada tela.

## Instalar no celular

O celular só instala PWA e ativa o modo offline se o site estiver em **HTTPS**. Hospede a pasta em um destes (todos gratuitos):

**GitHub Pages (recomendado)**
1. Crie um repositório (pode ser só `plano`) e envie o conteúdo desta pasta. O arquivo `.gitignore` já deixa de fora `.claude/` (configuração local do editor).
2. No repositório: *Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)` → Save*.
3. Em ~1 minuto o app fica em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`. Abra esse endereço no celular.

> O plano gratuito do Pages exige repositório **público**. Isso é seguro aqui: o código não tem dado pessoal (veja abaixo). Todos os caminhos são relativos, então funciona em subpasta (`/NOME-DO-REPO/`) sem ajuste.
>
> Para atualizar depois: envie os arquivos novos. O service worker busca a versão nova ao abrir o app com internet (se o celular insistir na antiga, feche e abra de novo).

Alternativas: Netlify Drop (<https://app.netlify.com/drop>, arrastar a pasta) ou Cloudflare Pages, sem comando de build.

Depois de abrir no celular:
- **Android (Chrome):** menu ⋮ → *Instalar app* (ou use o botão em Ajustes).
- **iPhone (Safari):** Compartilhar → *Adicionar à Tela de Início*.

## Privacidade: o que fica no repositório público

O código **não** contém peso, altura, idade, nome, medicação nem a chave do Gemini. Na primeira abertura o app pede esses dados e os guarda **só no armazenamento do aparelho** (`localStorage`). Quem abrir o mesmo endereço vê um app vazio, pedindo os próprios dados.

O que é público: o plano alimentar (calorias, receitas, regras) e o código. Se isso já for demais para você, use repositório privado (Pages privado exige plano pago) ou outro host.

## Ativar a IA (Gemini)

1. Crie uma chave em <https://aistudio.google.com/apikey>.
2. No app: **Ajustes → Coach (Gemini) → cole a chave → Testar conexão**.

**Modelo:** deixe em `auto`. O app pergunta ao Google quais modelos a *sua* chave enxerga e usa o melhor disponível; se um falhar (sobrecarga, sem cota, saiu do ar), tenta de novo e passa para o próximo sozinho. Os nomes de modelo mudam com frequência (o antigo padrão `gemini-3.7-flash` não existe na API e fazia o coach falhar), por isso não há mais um nome fixo. Se algo falhar, **Ajustes → Diagnóstico** testa cada modelo e mostra o motivo exato.

- A chave é guardada no `localStorage` do aparelho e enviada no cabeçalho `x-goog-api-key`. **Nunca coloque a chave no código nem em repositório.** Ela não entra no backup exportado.
- Se você restringir a chave no Google Cloud, **não use restrição de "referenciador HTTP" sem liberar o endereço do seu GitHub Pages** (`https://SEU-USUARIO.github.io/*`): senão toda chamada dá 403. Restringir por API (só *Generative Language API*) e definir cota/alerta de gasto é seguro.
- Ao usar a IA, são enviados ao Google: metas, idade, altura, IMC, o que você registrou hoje, resumo dos últimos 7 dias, pesos recentes, o texto de *Sobre você* e, no registro por voz, **o áudio gravado** (ele não fica salvo no app). **Não** é enviado o nome.

## Registro por voz

Toque no 🎙️ (botão central da barra, ou **Contar por voz** na tela Hoje) e fale, por exemplo:

- “Hoje comi dois ovos e um copo de 200 ml de leite com Nescau”
- “No almoço: 150 g de frango, salada e 4 colheres de arroz”
- “Bebi 500 ml de água e fiz 20 minutos de agachamento e flexão”
- “Tomei uma lata de refri zero” · “Me pesei agora: 92,4”

A IA transcreve, separa em itens, estima calorias e macros e sugere a refeição pelo horário. Antes de gravar você **confere e edita** (nome, refeição, calorias, “fora do plano”), e depois do registro há **Desfazer**.

- Itens que o plano não permite (ex.: achocolatado) vêm marcados como **fora do plano** com o motivo; contam nas calorias e tiram os pontos de “cozinha fechada”. Você pode desmarcar.
- O que você conta **substitui** o plano marcado naquela refeição (não soma os dois). Remover os itens (✕) volta ao plano.
- Treinos somam no **movimento** (junto com a caminhada) para a meta e os pontos. As calorias gastas são só estimativa e **não** viram crédito para comer.
- Sem microfone (ou sem permissão), use **Prefiro digitar**. Se a IA falhar, o áudio fica na tela: **Tentar de novo** sem regravar. Também dá para **Registrar manualmente**.
- Em **Ajustes → Voz** dá para ligar a leitura das respostas em voz alta (voz do aparelho, funciona offline).
- Estimativas de calorias são aproximadas: ajuste os números quando souber melhor.

## Lembretes

Notificações de PWA sem servidor não são confiáveis com o app fechado. O jeito seguro: **Ajustes → Baixar lembretes (.ics)** e abrir o arquivo no calendário do celular. Ele cria alarmes diários para cada refeição, água, caminhada e cozinha fechada (horários seguem os que você configurou). Se mudar os horários, baixe e importe de novo.

## Seus dados

- Ficam no `localStorage` do aparelho. Limpar dados do navegador **apaga tudo**: use *Ajustes → Exportar* de vez em quando.
- No iPhone, o app instalado e o Safari têm armazenamento separado: comece a usar direto pelo app instalado.

## Testar no computador

```bash
python -m http.server 5173
```

Abra <http://localhost:5173>. (`localhost` conta como seguro, então o service worker funciona. O IP da rede local via `http://` não instala no celular: use um dos hosts acima.)

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html`, `css/style.css` | Casca e temas de cor (troque em *Ajustes → Aparência*) |
| `js/data.js` | **Plano**: refeições, opções, macros, regras, listas |
| `js/store.js` | Estado, pontos do dia, sequência, tendência de peso |
| `js/app.js` | Telas e ações |
| `js/charts.js` | Gráficos em SVG (anéis, calorias da semana, peso; sem bibliotecas) |
| `js/gemini.js` | Cliente do Gemini (descoberta de modelos, tentativas, diagnóstico), coach e interpretação do registro por voz |
| `js/voice.js` | Gravação do microfone (WAV 16 kHz) e leitura em voz alta |
| `js/voiceui.js` | Painel de voz: gravar, conferir/editar, registrar e desfazer |
| `js/ics.js` | Gerador dos lembretes `.ics` |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA (offline e instalação) |

Para mudar o plano, edite `js/data.js` (os totais são calculados sozinhos) e, se quiser o documento atualizado, gere o `PLANO.md` de novo com `node tools/gerar-plano.js`.
