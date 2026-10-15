# Plano de Emagrecimento (PWA)

App instalável no celular para seguir o plano alimentar restrito: checklist diário com horários, água/caminhada/refri zero, botão de fissura, registro de peso com gráfico, previsão de metas, pontos e sequência, e um coach com IA (Gemini).

O plano completo está em [PLANO.md](PLANO.md). Tudo roda no navegador, sem servidor e sem build: são só arquivos estáticos.

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

## Ativar o coach (Gemini)

1. Crie uma chave em <https://aistudio.google.com/apikey>.
2. No app: **Ajustes → Coach (Gemini) → cole a chave → Testar conexão**.

Modelo padrão: `gemini-3.7-flash` (com fallback para `gemini-2.5-flash`). Dá para trocar em Ajustes. Em *Sobre você, para o coach* você pode escrever contexto pessoal (ex.: sensibilidade à cafeína); ele fica só no aparelho.

- A chave é guardada no `localStorage` do aparelho e enviada no cabeçalho `x-goog-api-key`. **Nunca coloque a chave no código nem em repositório.** Ela não entra no backup exportado.
- Para limitar estrago se a chave vazar, restrinja-a no Google AI Studio / Cloud Console (cota baixa, alerta de gasto).
- Ao usar o coach, são enviados ao Google: metas, idade, altura, IMC, refeições marcadas hoje, resumo dos últimos 7 dias, pesos recentes e o texto de *Sobre você*. **Não** é enviado o nome.

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
| `js/charts.js` | Gráficos em SVG (sem bibliotecas) |
| `js/gemini.js` | Cliente do Gemini e contexto enviado ao coach |
| `js/ics.js` | Gerador dos lembretes `.ics` |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA (offline e instalação) |

Para mudar o plano, edite `js/data.js` (os totais são calculados sozinhos) e, se quiser o documento atualizado, gere o `PLANO.md` de novo com `node tools/gerar-plano.js`.
