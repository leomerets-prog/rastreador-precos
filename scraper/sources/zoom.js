import { criarFonteComparador } from "./comparador.js";

const fonte = criarFonteComparador({
  fonte: "zoom",
  base: "https://www.zoom.com.br",
  urlBusca: (q) => `https://www.zoom.com.br/search?q=${encodeURIComponent(q)}`,
});

export const buscar = fonte.buscar;
