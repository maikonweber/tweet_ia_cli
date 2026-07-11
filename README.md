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

---

## Primeiro uso

```powershell
# 1) Login no X (abre o navegador — entre na conta e aguarde salvar a sessão)
npm run tweet -- login

# 2) Confirmar sessão
npm run tweet -- whoami

# 3) Publicar
npm run tweet -- post "Olá do terminal"
```

A sessão fica em `.auth/` (não versionar). Se expirar, rode `login` de novo.

---

## Comandos

| Comando | Descrição |
|---------|-----------|
| `login` | Abre o navegador; você entra no X; sessão é salva |
| `logout` | Apaga a sessão local |
| `whoami` | Mostra se há sessão salva |
| `generate <tema>` | Gera tweet com IA (não publica) |
| `transform <texto>` | Aplica modo/prompt em texto existente (não publica) |
| `post <texto>` | Publica no X (opcional: revisar antes com `--mode` / `--prompt`) |
| `ai-post <tema>` | Gera com IA e publica |

Ajuda:

```powershell
npm run tweet -- --help
```

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

## Observações

- **OpenRouter** cuida só do texto; **Playwright** publica como usuário no site.
- Mantenha `X_HEADLESS=false` no início para acompanhar o navegador.
- Não commite `.env` nem `.auth/`.
- Se o layout do X mudar, os seletores em `src/twitter.js` podem precisar de ajuste.

---

## Licença

Uso pessoal / interno do projeto.
