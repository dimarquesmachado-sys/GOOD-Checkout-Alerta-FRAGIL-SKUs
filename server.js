// ================= BUSCAR MULTI (autocomplete para painel SKUs frágeis) =================
app.get("/buscar-multi", (req, res) => {
  try {
    const { key, q, limite } = req.query;
    if (!key || key !== API_KEY) return res.status(401).json({ ok: false, erro: "API key inválida" });

    const termo = String(q || "").trim();
    const cacheStatus = {
      listagemCarregada,
      eansCarregados,
      skusIndexados: indiceSku.size,
      detalhesEmCache: cacheDetalhes.size
    };

    if (!termo) return res.json({ ok: true, total: 0, resultados: [], cacheStatus });

    const limiteResp = Math.min(parseInt(limite, 10) || 50, 200);
    const termoNorm = normalize(termo);
    const termoDigits = onlyDigits(termo);
    const idsVistos = new Set();
    const resultados = [];

    function adicionar(item) {
      const id = String(item.id);
      if (idsVistos.has(id)) return;
      idsVistos.add(id);
      resultados.push(item);
    }

    // 1. Busca por SKU (índice tem TODOS os ~1062 produtos desde ~30s após boot)
    for (const [skuNorm, id] of indiceSku) {
      if (resultados.length >= limiteResp) break;
      if (skuNorm.includes(termoNorm)) {
        const p = cacheDetalhes.get(String(id));
        if (p) {
          adicionar(formatarProduto(p));
        } else {
          adicionar({
            id, codigo: skuNorm.toUpperCase(),
            nome: "(detalhes ainda carregando...)",
            imagem: "", ean: "", estoque: 0, localizacao: ""
          });
        }
      }
    }

    // 2. Busca por EAN (se a query for numérica com 8+ dígitos)
    if (termoDigits.length >= 8 && resultados.length < limiteResp) {
      for (const [ean, id] of indiceEan) {
        if (resultados.length >= limiteResp) break;
        if (ean.includes(termoDigits)) {
          const p = cacheDetalhes.get(String(id));
          if (p) adicionar(formatarProduto(p));
        }
      }
    }

    // 3. Busca por NOME do produto (apenas no cacheDetalhes — após detalhes carregarem)
    if (resultados.length < limiteResp) {
      for (const [, p] of cacheDetalhes) {
        if (resultados.length >= limiteResp) break;
        if (normalize(p.nome).includes(termoNorm)) {
          adicionar(formatarProduto(p));
        }
      }
    }

    // Ordena: matches exatos por SKU primeiro, depois alfabético
    resultados.sort((a, b) => {
      const aExact = normalize(a.codigo) === termoNorm ? 0 : 1;
      const bExact = normalize(b.codigo) === termoNorm ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return (a.codigo || "").localeCompare(b.codigo || "", "pt-BR", { numeric: true });
    });

    return res.json({ ok: true, total: resultados.length, resultados, cacheStatus });
  } catch (e) {
    console.error("[/buscar-multi] ERRO:", e.message);
    return res.status(500).json({ ok: false, erro: e.message });
  }
});
