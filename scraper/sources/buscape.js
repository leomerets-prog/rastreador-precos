import { criarFonteComparador } from "./comparador.js";

const fonte = criarFonteComparador({
  fonte: "buscape",
  base: "https://www.buscape.com.br",
  urlBusca: (q) => `https://www.buscape.com.br/search?q=${encodeURIComponent(q)}`,
});

export const buscar = fonte.buscar;
