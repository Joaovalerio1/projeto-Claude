/* ============================================================
   CORREÇÃO DEFINITIVA DAS VARIANTES SHOPIFY
   Corrige o problema em que G/GG visualmente selecionado
   continua enviando o ID da variante M.

   Diferente da versão anterior, esta não depende de uma
   chamada de rede (fetch) para descobrir a variante certa —
   ela lê o JSON do produto que a própria página já embute,
   então a correção é instantânea e não perde a corrida contra
   um clique rápido em "Comprar".

   Também corrige um segundo bug: em produtos com várias opções
   (ex: Tamanho + Personalizar), o campo que vai pro carrinho
   não é um <input>, é um <select name="id"> escondido. O código
   nativo do tema só atualizava o atributo "selected" desse
   select, o que não muda o valor realmente enviado ao carrinho.
   Por isso buscamos qualquer elemento [name='id'] (input OU
   select) e ajustamos a propriedade .value diretamente.
   ============================================================ */

(function () {
  "use strict";

  function encontrarDadosDoProduto(form) {
    var container = form.closest(".card") || document;
    var script =
      container.querySelector("[data-product-json]") ||
      document.querySelector("[data-product-json]");

    if (!script) {
      return null;
    }

    try {
      return JSON.parse(script.textContent);
    } catch (erro) {
      return null;
    }
  }

  function sincronizarVariante(form) {
    if (!form) {
      return;
    }

    var radiosSelecionados = Array.from(
      form.querySelectorAll(".product-form__single-selector:checked")
    );

    if (!radiosSelecionados.length) {
      radiosSelecionados = Array.from(
        form.querySelectorAll("input[type='radio'][data-option-position]:checked")
      );
    }

    if (!radiosSelecionados.length) {
      return;
    }

    radiosSelecionados.sort(function (a, b) {
      return (
        parseInt(a.dataset.optionPosition || "1", 10) -
        parseInt(b.dataset.optionPosition || "1", 10)
      );
    });

    var valoresSelecionados = radiosSelecionados.map(function (radio) {
      return radio.value.trim();
    });

    var campoVariante = form.querySelector("[name='id']");

    if (!campoVariante) {
      return;
    }

    var dados = encontrarDadosDoProduto(form);

    if (!dados || !dados.product || !dados.product.variants) {
      return;
    }

    var varianteCorreta = dados.product.variants.find(function (variante) {
      if (!variante.options) {
        return false;
      }

      return variante.options.every(function (valorDaVariante, indice) {
        return valoresSelecionados[indice] === String(valorDaVariante).trim();
      });
    });

    if (!varianteCorreta) {
      campoVariante.value = "";
      return;
    }

    campoVariante.value = varianteCorreta.id;

    campoVariante.dispatchEvent(new Event("input", { bubbles: true }));
    campoVariante.dispatchEvent(new Event("change", { bubbles: true }));

    var textoSelecionado = form.querySelector(".product-form__selected-value");

    if (textoSelecionado) {
      textoSelecionado.textContent = valoresSelecionados.join(" / ");
    }
  }

  document.addEventListener("change", function (evento) {
    var radio = evento.target.closest(
      ".product-form__single-selector, input[type='radio'][data-option-position]"
    );

    if (!radio) {
      return;
    }

    var form = radio.closest("form") || radio.closest(".product-form");
    sincronizarVariante(form);
  });

  document.addEventListener("click", function (evento) {
    var label = evento.target.closest("label");

    if (!label) {
      return;
    }

    var radioId = label.getAttribute("for");

    if (!radioId) {
      return;
    }

    var radio = document.getElementById(radioId);

    if (!radio) {
      return;
    }

    var form = radio.closest("form") || radio.closest(".product-form");
    sincronizarVariante(form);
  });

  /*
   * Rede de segurança final: o botão "Comprar" adiciona ao carrinho
   * via fetch() e chama preventDefault()/stopPropagation() no clique,
   * então o evento "submit" do form abaixo NUNCA chega a disparar
   * nesse fluxo. Sem isto, a última correção de fato aplicada é a do
   * "change"/"click" anterior — que já deveria estar certa, mas não
   * há garantia caso algo mude a ordem de scripts no futuro. Usamos
   * a fase de captura para rodar ANTES de qualquer handler de clique
   * do tema que esteja preso ao próprio formulário (fase de bolha).
   */
  document.addEventListener(
    "click",
    function (evento) {
      var gatilho = evento.target.closest(
        "[data-action='add-to-cart'], .product-form__add-button, .botaoaddcarrinho"
      );

      if (!gatilho) {
        return;
      }

      var form = gatilho.closest("form") || gatilho.closest(".product-form");
      sincronizarVariante(form);
    },
    true
  );

  document.addEventListener(
    "submit",
    function (evento) {
      var form = evento.target;

      if (!form || !form.querySelector) {
        return;
      }

      sincronizarVariante(form);
    },
    true
  );
})();
