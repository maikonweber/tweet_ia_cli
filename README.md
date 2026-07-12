# tweet-ia-cli

CLI pessoal para **gerar**, **revisar** e **publicar** posts no X (Twitter) pelo PowerShell.

- Gera texto com **OpenRouter** (IA)
- Publica na sua conta com **Playwright** (automação do navegador)
- Não depende da API oficial do X

> Uso pessoal. Automação de navegador pode quebrar se o X mudar o layout e pode conflitar com os Termos de Serviço da plataforma.

---

## Requisitos

- Node.js **18+**
- Conta no [OpenRouter](https://openrouter.ai/) (API key)
- Conta no X
- Windows + PowerShell (também funciona em outros SO com Node)

---

## Instalação

```powershell
cd c:\Users\plugify\tweet_ia_cli
npm install
```

O `postinstall` baixa o Chromium do Playwright automaticamente.

Copie o exemplo de ambiente e preencha a key:

```powershell
Copy-Item .env.example .env
```

Edite o `.env`:

```env
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_MAX_TOKENS=280

# false = mostra o navegador | true = headless
X_HEADLESS=false
```

### Usar de qualquer pasta (`tweet` global)

```powershell
cd c:\Users\plugify\tweet_ia_cli
npm run link:global
```

Depois, em **qualquer** terminal:

```powershell
tweet login
tweet whoami
tweet generate "tema"
tweet post "texto"
tweet --help
```

O `.env` e a sessão (`.auth/`) são sempre lidos da pasta do projeto, não do diretório atual.

Para remover o comando global:

```powershell
npm run unlink:global
```

---

## Primeiro uso

```powershell
# Com comando global (após npm run link:global):
tweet login
tweet whoami
tweet post "Olá do terminal"

# Ou ainda pelo npm, dentro do projeto:
npm run tweet -- login
```

A sessão fica em `.auth/` na pasta do projeto (não versionar). Se expirar, rode `login` de novo.

---

## Comandos

| Comando | Descrição |
|---------|-----------|
| `login` | Abre o navegador; você entra no X; sessão é salva |
| `logout` | Apaga a sessão local |
| `whoami` | Mostra se há sessão salva |
| `generate <tema>` | Gera tweet com IA e **pede permissão** para publicar |
| `transform <texto>` | Aplica modo/prompt em texto existente (não publica) |
| `post <texto>` | Publica no X (opcional: revisar antes com `--mode` / `--prompt`) |
| `ai-post <tema>` | Gera com IA e publica (`--yes` pula a confirmação) |

### Atalhos

```powershell
tweet p "texto"           # post
tweet p "texto" -r        # post + revisão
tweet p "texto" -e        # post + inglês
tweet p "texto" -r -e     # post + revisado em inglês
tweet p "texto" -r -e -y  # publica sem perguntar
tweet g "tema"            # generate
tweet t "texto" -s        # transform + ortografia
```

| Atalho | Significado |
|--------|-------------|
| `p` | `post` |
| `g` | `generate` |
| `t` | `transform` |
| `a` | `ai-post` |
| `-r` | revisão (`revise`) |
| `-e` | inglês (`english`) |
| `-r -e` | revisado em inglês |
| `-s` | ortografia (`spelling`) |
| `-y` | `--yes` |

---

## Opções

| Opção | Descrição |
|-------|-----------|
| `--mode <modo>` | Preset de prompt |
| `--prompt <texto>` | Injeta instrução extra (pode combinar com `--mode`) |
| `--tone <tom>` | Tom do texto (padrão: `direto e natural`) — `generate` / `ai-post` |
| `--lang <idioma>` | Idioma base (padrão: `pt-BR`) — `generate` / `ai-post` |
| `--yes` / `-y` | Confirma publicação sem perguntar |
| `-h` / `--help` | Mostra a ajuda |

### Modos (`--mode`)

| Modo | Aliases | Função |
|------|---------|--------|
| `english` | `en`, `ingles` | Reescreve em inglês |
| `spelling` | `ortografia`, `ortho` | Revisão ortográfica |
| `revise` | `revisao`, `review`, `texto` | Revisão de texto (clareza/estilo) |

---

## Exemplos

```powershell
# Gerar
npm run tweet -- generate "produtividade sem burnout"

# Gerar em inglês
npm run tweet -- generate "dica de carreira" --mode english

# Prompt livre
npm run tweet -- generate "lançamento" --prompt "tom irônico, sem hashtag, 1 emoji no máximo"

# Ortografia
npm run tweet -- transform "vc precisa reveer isso amanha" --mode spelling

# Revisão de texto
npm run tweet -- transform "texto meio confuso" --mode revise

# Traduzir rascunho
npm run tweet -- transform "quero postar isso em ingles" --mode english

# Revisar e publicar
npm run tweet -- post "texto com eroo ortografico" --mode spelling --yes

# Gerar + publicar
npm run tweet -- ai-post "IA no trabalho" --mode english --yes
```

Mais exemplos em [`examples.ps1`](./examples.ps1).

---

## Estrutura do projeto

```
tweet_ia_cli/
├── bin/tweet.js          # Entrada do CLI
├── src/
│   ├── config.js         # .env / OpenRouter / Playwright
│   ├── openrouter.js     # Geração e transformação via IA
│   ├── prompts.js        # Presets (--mode) e injeção de --prompt
│   └── twitter.js        # Login + publicação com Playwright
├── .auth/                # Sessão do X (local, gitignored)
├── .env                  # Credenciais (gitignored)
├── .env.example
├── examples.ps1
└── package.json
```

---

## Fluxo

```
Tema / texto
    │
    ▼
OpenRouter (generate / transform / --mode / --prompt)
    │
    ▼
Prévia no terminal
    │
    ▼
Playwright (sessão .auth/) → x.com → Postar
```

---

## Modelos OpenRouter (custo)

O CLI tenta **gratuito primeiro** e cai para o **pago mais barato**:

| Ordem | Modelo | Custo (prompt / completion por 1M tokens) |
|------|--------|---------------------------------------------|
| 1 | `openrouter/free` | **$0** (router free) |
| 2 | `meta-llama/llama-3.2-3b-instruct:free` | **$0** |
| 3 | `openai/gpt-oss-20b:free` | **$0** |
| 4 | `meta-llama/llama-3.3-70b-instruct:free` | **$0** |
| 5 | `inclusionai/ling-2.6-flash` | **$0.01 / $0.03** |
| 6 | `meta-llama/llama-3.1-8b-instruct` | **$0.02 / $0.03** |
| 7 | `mistralai/mistral-nemo` | **$0.02 / $0.03** |

Referência: `openai/gpt-4o-mini` custa **$0.15 / $0.60** (~20× mais caro que o fallback pago).

Free no OpenRouter: limite diário baixo (sem créditos ≈ 50 req/dia). Se o free falhar (429/503), o CLI usa o pago barato.

```env
OPENROUTER_VERBOSE=true          # mostra qual modelo respondeu
OPENROUTER_SKIP_FREE=true        # pula free e vai direto ao pago barato
```

Na geração e na publicação o CLI respeita o tier da conta (`X_ACCOUNT_TIER`):

| Tier | Caracteres | Articles |
|------|------------|----------|
| **Free** | **280** | Não |
| **Premium** | até **25.000** (longer posts) | Sim (editor no site) |

- Timeline ainda corta ~280 + **Show more**
- Longer posts ≠ Articles
- Use `--long` para orientar texto longo
- Hashtags/emojis off por padrão (`--hashtags` / `--emojis`)

Se a IA passar do teto, o CLI encurta automaticamente.

- **OpenRouter** cuida só do texto; **Playwright** publica como usuário no site.
- Mantenha `X_HEADLESS=false` no início para acompanhar o navegador.
- Não commite `.env` nem `.auth/`.
- Se o layout do X mudar, os seletores em `src/twitter.js` podem precisar de ajuste.

---

## Licença

Uso pessoal / interno do projeto.
