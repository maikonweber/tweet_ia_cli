# Comando global (após: npm run link:global)
# Funciona em qualquer pasta do PowerShell

# Gerar
tweet generate "produtividade sem burnout"

# Gerar já em inglês
tweet generate "produtividade sem burnout" --mode english

# Prompt livre injetado
tweet generate "lançamento" --prompt "tom irônico, sem hashtag, 1 emoji no máximo"

# Transformar texto existente
tweet transform "vc precisa reveer isso amanha" --mode spelling
tweet transform "texto meio confuso e longo demais mesmo" --mode revise
tweet transform "quero postar isso em ingles" --mode english
tweet transform "meu rascunho" --prompt "deixe mais curto"

# Publicar com revisão antes
tweet post "texto com eroo ortografico" --mode spelling --yes

# Gerar + publicar em inglês
tweet ai-post "dica de carreira" --mode english --yes
