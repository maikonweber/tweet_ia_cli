# Gerar
npm run tweet -- generate "produtividade sem burnout"

# Gerar já em inglês
npm run tweet -- generate "produtividade sem burnout" --mode english

# Prompt livre injetado
npm run tweet -- generate "lançamento" --prompt "tom irônico, sem hashtag, 1 emoji no máximo"

# Transformar texto existente
npm run tweet -- transform "vc precisa reveer isso amanha" --mode spelling
npm run tweet -- transform "texto meio confuso e longo demais mesmo" --mode revise
npm run tweet -- transform "quero postar isso em ingles" --mode english
npm run tweet -- transform "meu rascunho" --prompt "deixe mais curto e direto"

# Publicar com revisão antes
npm run tweet -- post "texto com eroo ortografico" --mode spelling --yes

# Gerar + publicar em inglês
npm run tweet -- ai-post "dica de carreira" --mode english --yes
