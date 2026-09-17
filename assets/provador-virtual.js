/* ============================================================
   PROVADOR VIRTUAL / RECOMENDADOR DE TAMANHO
   ------------------------------------------------------------
   Extensão independente da página de produto. Não substitui o
   seletor de variantes existente (snippets/product-info.liquid,
   classes .product-form__single-selector / .block-swatch-list) —
   apenas lê o JSON do produto já embutido pela própria página
   ([data-product-json], igual ao assets/custom.js) e, ao final,
   aciona a seleção de tamanho clicando no <label> real do swatch,
   para passar por qualquer lógica do tema que já esteja ouvindo
   esses cliques (nenhum sistema paralelo de variantes).

   As tabelas de medidas (SIZE_CHARTS) são os dados oficiais
   fornecidos pela loja e não devem ser alterados aqui.
   ============================================================ */

(function () {
  "use strict";

  /* ------------------------------------------------------------
     1) TABELAS DE MEDIDAS (fonte única da verdade)
     ------------------------------------------------------------ */

  var SIZE_CHARTS = {
    male: {
      P: { length: [69, 71], width: [53, 55], height: [162, 170], weight: [50, 62] },
      M: { length: [71, 73], width: [55, 57], height: [170, 176], weight: [62, 78] },
      G: { length: [73, 75], width: [57, 58], height: [176, 182], weight: [78, 83] },
      GG: { length: [75, 78], width: [58, 60], height: [182, 190], weight: [83, 90] },
      "2XL": { length: [78, 81], width: [60, 62], height: [190, 195], weight: [90, 97] },
      "3XL": { length: [81, 83], width: [62, 64], height: [192, 197], weight: [97, 104] }
    },
    female: {
      P: { length: [61, 63], width: [40, 41], height: [150, 160] },
      M: { length: [63, 66], width: [41, 44], height: [160, 165] },
      G: { length: [66, 69], width: [44, 47], height: [165, 170] },
      GG: { length: [69, 71], width: [47, 50], height: [170, 175] }
    }
  };

  var SIZE_ORDER = {
    male: ["P", "M", "G", "GG", "2XL", "3XL"],
    female: ["P", "M", "G", "GG"]
  };

  /* Equivalências conhecidas entre nomenclaturas de variantes.
     Só entram aqui apelidos confirmados; qualquer valor fora
     desta lista é tratado como "não é um tamanho reconhecido"
     e nunca é forçado a virar um tamanho por adivinhação. */
  var SIZE_ALIASES = {
    P: ["P", "PP", "S"],
    M: ["M"],
    G: ["G", "L"],
    GG: ["GG", "XL", "1XL", "XG"],
    "2XL": ["2XL", "2GG", "3G", "XXL"],
    "3XL": ["3XL", "3GG", "4G", "XXXL"]
  };

  var FEMALE_KEYWORDS = ["feminin", "baby look", "babylook", "women", "woman", "ladies"];

  var EXPLANATION_FACTORS = {
    male: [
      "Altura compatível",
      "Peso compatível",
      "Formato corporal considerado",
      "Preferência de caimento considerada"
    ],
    female: [
      "Altura considerada",
      "Formato corporal considerado",
      "Preferência de caimento considerada"
    ]
  };

  /* ------------------------------------------------------------
     2) IDENTIFICAÇÃO DO PRODUTO
     ------------------------------------------------------------ */

  function getProductGender(product) {
    var haystack = [
      (product.tags || []).join(" "),
      product.type || "",
      product.title || ""
    ]
      .join(" ")
      .toLowerCase();

    for (var i = 0; i < FEMALE_KEYWORDS.length; i++) {
      if (haystack.indexOf(FEMALE_KEYWORDS[i]) !== -1) {
        return "female";
      }
    }

    return "male";
  }

  function getSizeChart(gender) {
    return SIZE_CHARTS[gender];
  }

  function getSizeOrder(gender) {
    return SIZE_ORDER[gender];
  }

  function normalizeSizeToken(raw) {
    return String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  function canonicalizeSize(raw, gender) {
    var token = normalizeSizeToken(raw);
    var order = getSizeOrder(gender);

    for (var i = 0; i < order.length; i++) {
      var canonical = order[i];
      var aliases = SIZE_ALIASES[canonical] || [canonical];

      if (aliases.indexOf(token) !== -1) {
        return canonical;
      }
    }

    return null;
  }

  function findSizeOptionPosition(product) {
    var options = product.options || [];

    for (var i = 0; i < options.length; i++) {
      var name = String(options[i] || "").toLowerCase();

      if (name.indexOf("tamanho") !== -1 || name.indexOf("size") !== -1 || name === "tam") {
        return i + 1; // Shopify usa posições 1-based (option1, option2, option3)
      }
    }

    return null;
  }

  /* Retorna { P: { raw: 'P', available: true }, ... } apenas com os
     tamanhos que realmente existem como variante deste produto. */
  function getAvailableSizes(product, optionPosition, gender) {
    var variants = product.variants || [];
    var result = {};
    var index = optionPosition - 1;

    variants.forEach(function (variant) {
      var options = variant.options || [];
      var rawValue = options[index];

      if (rawValue === undefined || rawValue === null) {
        return;
      }

      var canonical = canonicalizeSize(rawValue, gender);

      if (!canonical) {
        return;
      }

      if (!result[canonical] || (!result[canonical].available && variant.available)) {
        result[canonical] = { raw: rawValue, available: !!variant.available };
      }
    });

    // mantém apenas tamanhos com pelo menos uma variante disponível
    var available = {};
    Object.keys(result).forEach(function (canonical) {
      if (result[canonical].available) {
        available[canonical] = result[canonical];
      }
    });

    return available;
  }

  /* ------------------------------------------------------------
     3) ALGORITMO DE PONTUAÇÃO
     ------------------------------------------------------------ */

  function continuousIndexFromValue(value, midpoints) {
    var n = midpoints.length;

    if (n === 1) {
      return 0;
    }

    if (value <= midpoints[0]) {
      var slopeStart = midpoints[1] - midpoints[0];
      return (value - midpoints[0]) / slopeStart;
    }

    if (value >= midpoints[n - 1]) {
      var slopeEnd = midpoints[n - 1] - midpoints[n - 2];
      return (n - 1) + (value - midpoints[n - 1]) / slopeEnd;
    }

    for (var i = 0; i < n - 1; i++) {
      if (value >= midpoints[i] && value <= midpoints[i + 1]) {
        var t = (value - midpoints[i]) / (midpoints[i + 1] - midpoints[i]);
        return i + t;
      }
    }

    return 0;
  }

  function midpointsFor(gender, dimension) {
    var order = getSizeOrder(gender);
    var chart = getSizeChart(gender);

    return order.map(function (size) {
      var range = chart[size][dimension];
      return (range[0] + range[1]) / 2;
    });
  }

  var BODY_SIGNAL_VALUES = { estreito: -1, fina: -1, medio: 0, largo: 1, larga: 1 };

  function bodyShapeAdjustment(bodyShape) {
    if (!bodyShape) {
      return 0;
    }

    var signals = [bodyShape.chest, bodyShape.belly, bodyShape.hip]
      .filter(function (v) {
        return typeof v === "number";
      });

    if (!signals.length) {
      return 0;
    }

    var avg =
      signals.reduce(function (a, b) {
        return a + b;
      }, 0) / signals.length;

    return avg * 0.5; // ajuste fino: no máximo ±0.5 "tamanho"
  }

  var FIT_ADJUSTMENT = { ajustada: -0.3, normal: 0, folgada: 0.3 };

  function computeIdealIndex(gender, inputs) {
    var heightIdx = continuousIndexFromValue(inputs.height, midpointsFor(gender, "height"));
    var baseIndex = heightIdx;

    if (gender === "male") {
      var weightIdx = continuousIndexFromValue(inputs.weight, midpointsFor(gender, "weight"));
      baseIndex = heightIdx * 0.55 + weightIdx * 0.45;
    }

    var bodyAdj = bodyShapeAdjustment(inputs.bodyShape);
    var fitAdj = FIT_ADJUSTMENT[inputs.fit] || 0;

    return baseIndex + bodyAdj + fitAdj;
  }

  /* Pontuação "crua" (pode ficar negativa) — usada só para RANKING, para que
     o tamanho mais próximo do ideal continue vencendo mesmo quando todos os
     tamanhos disponíveis estão longe do ideal (ex.: só há P/M/G em estoque,
     mas o ideal seria 3XL). */
  function calculateSizeScoreRaw(canonicalSize, gender, idealIndex) {
    var order = getSizeOrder(gender);
    var sizeIndex = order.indexOf(canonicalSize);

    if (sizeIndex === -1) {
      return -Infinity;
    }

    return 100 - Math.abs(sizeIndex - idealIndex) * 30;
  }

  /* Pontuação para EXIBIÇÃO (0-100), nunca negativa. */
  function calculateSizeScore(canonicalSize, gender, idealIndex) {
    var raw = calculateSizeScoreRaw(canonicalSize, gender, idealIndex);
    if (raw === -Infinity) return 0;
    return Math.max(0, Math.min(100, Math.round(raw)));
  }

  function calculateSizeRecommendation(product, inputs) {
    var gender = getProductGender(product);
    var optionPosition = findSizeOptionPosition(product);

    if (!optionPosition) {
      return { error: "no-size-option", gender: gender };
    }

    var availableSizes = getAvailableSizes(product, optionPosition, gender);
    var availableCanonicals = Object.keys(availableSizes);

    if (!availableCanonicals.length) {
      return { error: "no-available-sizes", gender: gender, optionPosition: optionPosition };
    }

    var idealIndex = computeIdealIndex(gender, inputs);
    var order = getSizeOrder(gender);

    // melhor tamanho teórico, ignorando disponibilidade (para poder avisar
    // quando o ideal existe na tabela mas não está disponível neste produto)
    var idealScores = order.map(function (size) {
      return { size: size, raw: calculateSizeScoreRaw(size, gender, idealIndex) };
    });
    idealScores.sort(function (a, b) {
      return b.raw - a.raw;
    });
    var idealCanonical = idealScores[0].size;

    var scores = {};
    availableCanonicals.forEach(function (size) {
      scores[size] = calculateSizeScore(size, gender, idealIndex);
    });

    var ranked = availableCanonicals
      .map(function (size) {
        return { size: size, score: scores[size], raw: calculateSizeScoreRaw(size, gender, idealIndex) };
      })
      .sort(function (a, b) {
        return b.raw - a.raw;
      });

    var recommended = ranked[0].size;
    var betweenTwo =
      ranked.length > 1 && Math.abs(ranked[0].raw - ranked[1].raw) <= 8;

    var alternatives = getAlternativeSizes(gender, availableCanonicals, recommended);

    return {
      gender: gender,
      optionPosition: optionPosition,
      availableSizes: availableSizes,
      recommended: recommended,
      recommendedRaw: availableSizes[recommended].raw,
      scores: scores,
      ranked: ranked,
      betweenTwo: betweenTwo,
      secondBest: betweenTwo ? ranked[1].size : null,
      idealCanonical: idealCanonical,
      recommendedIsIdeal: idealCanonical === recommended,
      alternatives: alternatives
    };
  }

  function getAlternativeSizes(gender, availableCanonicals, recommendedCanonical) {
    var order = getSizeOrder(gender);
    var recIndex = order.indexOf(recommendedCanonical);
    var alternatives = [];

    var smallerCandidate = order[recIndex - 1];
    if (smallerCandidate && availableCanonicals.indexOf(smallerCandidate) !== -1) {
      alternatives.push({ size: smallerCandidate, label: "Mais ajustado" });
    }

    alternatives.push({ size: recommendedCanonical, label: "Melhor opção" });

    var largerCandidate = order[recIndex + 1];
    if (largerCandidate && availableCanonicals.indexOf(largerCandidate) !== -1) {
      alternatives.push({ size: largerCandidate, label: "Mais folgado" });
    }

    return alternatives;
  }

  /* ------------------------------------------------------------
     4) VALIDAÇÃO DE ENTRADA
     ------------------------------------------------------------ */

  function validateHeight(value) {
    var n = parseFloat(value);
    if (!value || isNaN(n)) return "Informe uma altura válida.";
    if (n < 100 || n > 230) return "Informe uma altura válida.";
    return null;
  }

  function validateWeight(value) {
    var n = parseFloat(value);
    if (!value || isNaN(n)) return "Informe seu peso.";
    if (n < 30 || n > 250) return "Informe um peso válido.";
    return null;
  }

  function validateAge(value) {
    var n = parseFloat(value);
    if (!value || isNaN(n)) return "Informe uma idade válida.";
    if (n < 5 || n > 110) return "Informe uma idade válida.";
    return null;
  }

  /* ------------------------------------------------------------
     5) PERSISTÊNCIA DURANTE O FLUXO (sessão do navegador)
     ------------------------------------------------------------ */

  var PROFILE_KEY = "provadorVirtual:profile";

  function loadProfile() {
    try {
      var raw = window.sessionStorage.getItem(PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveProfile(profile) {
    try {
      window.sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch (e) {
      /* sessionStorage indisponível (modo privado etc.) — segue sem persistir */
    }
  }

  function resultKey(productId) {
    return "provadorVirtual:result:" + productId;
  }

  function saveLastResult(productId, canonicalSize) {
    try {
      window.sessionStorage.setItem(resultKey(productId), canonicalSize);
    } catch (e) {}
  }

  function loadLastResult(productId) {
    try {
      return window.sessionStorage.getItem(resultKey(productId));
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------
     6) SELEÇÃO DA VARIANTE REAL (reaproveita o seletor existente)
     ------------------------------------------------------------ */

  function selectRecommendedVariant(scope, optionPosition, rawValue) {
    var inputs = scope.querySelectorAll(
      '.product-form__single-selector[data-option-position="' + optionPosition + '"]'
    );

    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];

      if (input.tagName === "SELECT") {
        var hasOption = Array.prototype.some.call(input.options, function (opt) {
          return opt.value === rawValue;
        });
        if (hasOption) {
          input.value = rawValue;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        continue;
      }

      if (input.value === rawValue && !input.disabled) {
        var label = null;
        if (input.id) {
          label = document.querySelector('label[for="' + cssEscape(input.id) + '"]');
        }

        if (label) {
          label.click();
        } else {
          input.checked = true;
          input.dispatchEvent(new Event("click", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }

        return true;
      }
    }

    return false;
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) {
      return window.CSS.escape(value);
    }
    return String(value).replace(/([^a-zA-Z0-9_-])/g, "\\$1");
  }

  /* ------------------------------------------------------------
     7) INTERFACE — ESTILOS
     ------------------------------------------------------------ */

  function injectStylesOnce() {
    if (document.getElementById("provador-virtual-styles")) {
      return;
    }

    var style = document.createElement("style");
    style.id = "provador-virtual-styles";
    style.textContent = [
      ".pv-trigger-row{display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin-top:12px;font-family:inherit;}",
      ".pv-recommend-line{flex-basis:100%;font-size:13px;color:#3a3a3a;margin:0 0 2px;}",
      ".pv-recommend-line strong{color:#111;}",
      ".pv-trigger{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#111;background:none;border:none;padding:6px 2px;cursor:pointer;letter-spacing:.01em;line-height:1.2;-webkit-tap-highlight-color:transparent;}",
      ".pv-trigger svg{width:16px;height:16px;flex:none;}",
      ".pv-trigger:hover{color:#000;text-decoration:underline;text-underline-offset:3px;}",
      ".pv-trigger:focus-visible{outline:2px solid #111;outline-offset:3px;border-radius:4px;}",
      "@media (max-width:480px){.pv-trigger{padding:13px 4px;font-size:14px;min-height:44px;}}",

      ".pv-overlay{position:fixed;inset:0;background:rgba(20,20,20,.55);display:flex;align-items:center;justify-content:center;z-index:99999;opacity:0;visibility:hidden;transition:opacity .18s ease;padding:20px;box-sizing:border-box;}",
      ".pv-overlay.pv-open{opacity:1;visibility:visible;}",
      ".pv-modal{background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);width:100%;max-width:880px;max-height:92vh;overflow:hidden;display:grid;grid-template-columns:300px 1fr;transform:scale(.97);transition:transform .18s ease;font-family:inherit;color:#111;}",
      ".pv-overlay.pv-open .pv-modal{transform:scale(1);}",
      ".pv-modal-image{background:#f6f6f7;display:flex;align-items:center;justify-content:center;padding:24px;}",
      ".pv-modal-image img{max-width:100%;max-height:420px;object-fit:contain;border-radius:8px;}",
      ".pv-modal-body{display:flex;flex-direction:column;min-width:0;min-height:0;max-height:92vh;}",
      ".pv-modal-header{display:flex;align-items:flex-start;justify-content:space-between;padding:24px 24px 0;}",
      ".pv-modal-heading h2{font-size:20px;margin:0 0 4px;font-weight:700;}",
      ".pv-modal-heading p{margin:0;font-size:13px;color:#666;}",
      ".pv-close{background:none;border:none;cursor:pointer;padding:6px;margin:-6px -6px 0 0;color:#333;border-radius:8px;}",
      ".pv-close:hover{background:#f0f0f0;}",
      ".pv-close:focus-visible{outline:2px solid #111;outline-offset:2px;}",
      ".pv-steps{display:flex;gap:10px;padding:16px 24px 0;font-size:12px;color:#999;font-weight:600;letter-spacing:.02em;}",
      ".pv-step{display:flex;align-items:center;gap:6px;}",
      ".pv-step.pv-step-active{color:#111;}",
      ".pv-step .pv-dot{width:7px;height:7px;border-radius:50%;background:#ddd;display:inline-block;}",
      ".pv-step.pv-step-active .pv-dot{background:#111;}",
      ".pv-modal-content{padding:20px 24px;overflow-y:auto;flex:1;min-height:0;}",
      ".pv-field{margin-bottom:16px;}",
      ".pv-field label{display:block;font-size:13px;font-weight:600;margin-bottom:6px;}",
      ".pv-field input[type=number]{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #ddd;border-radius:10px;font-size:15px;font-family:inherit;}",
      ".pv-field input[type=number]:focus{outline:none;border-color:#111;box-shadow:0 0 0 3px rgba(17,17,17,.08);}",
      ".pv-field-error{color:#c0392b;font-size:12px;margin-top:6px;}",
      ".pv-question{margin-bottom:20px;}",
      ".pv-question > p.pv-question-title{font-weight:600;font-size:14px;margin:0 0 10px;}",
      ".pv-option-list{display:flex;gap:8px;flex-wrap:wrap;}",
      ".pv-option-btn{flex:1 1 auto;min-width:96px;border:1px solid #ddd;background:#fff;border-radius:10px;padding:10px 12px;font-size:13px;cursor:pointer;font-family:inherit;transition:border-color .12s,background .12s;}",
      ".pv-option-btn:hover{border-color:#999;}",
      ".pv-option-btn.pv-selected{border-color:#111;background:#111;color:#fff;}",
      ".pv-option-btn:focus-visible{outline:2px solid #111;outline-offset:2px;}",
      ".pv-hint{font-size:12px;color:#888;margin:2px 0 18px;}",
      ".pv-result-size{text-align:center;padding:20px 0 6px;}",
      ".pv-result-size .pv-size-value{font-size:52px;font-weight:800;line-height:1;margin:6px 0;}",
      ".pv-result-size .pv-size-check{color:#1a7f37;font-size:13px;font-weight:600;}",
      ".pv-result-text{text-align:center;font-size:13px;color:#555;margin:6px 0 18px;}",
      ".pv-between{background:#fff8ec;border:1px solid #f1d9a8;border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:16px;}",
      ".pv-explain{border-top:1px solid #eee;padding-top:14px;margin-top:6px;}",
      ".pv-explain h3{font-size:13px;margin:0 0 8px;}",
      ".pv-explain ul{margin:0;padding:0;list-style:none;font-size:13px;color:#333;}",
      ".pv-explain li{padding:3px 0;}",
      ".pv-alt-title{font-size:13px;font-weight:600;margin:18px 0 8px;}",
      ".pv-alt-list{display:flex;gap:10px;}",
      ".pv-alt-card{flex:1;border:1px solid #ddd;border-radius:10px;padding:12px 8px;text-align:center;}",
      ".pv-alt-card.pv-alt-main{border-color:#111;box-shadow:0 0 0 1px #111 inset;}",
      ".pv-alt-card .pv-alt-size{font-size:18px;font-weight:700;}",
      ".pv-alt-card .pv-alt-label{font-size:11px;color:#777;margin-top:2px;}",
      ".pv-unavailable{background:#fdecea;border:1px solid #f3c1bb;border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:16px;color:#7a2b22;}",
      ".pv-modal-footer{display:flex;justify-content:space-between;gap:10px;padding:16px 24px 24px;border-top:1px solid #f0f0f0;}",
      ".pv-btn{border-radius:999px;padding:12px 20px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid transparent;}",
      ".pv-btn-primary{background:#111;color:#fff;}",
      ".pv-btn-primary:hover{background:#000;}",
      ".pv-btn-primary:disabled{background:#ccc;cursor:not-allowed;}",
      ".pv-btn-secondary{background:#fff;color:#111;border-color:#ddd;}",
      ".pv-btn-secondary:hover{border-color:#999;}",
      ".pv-btn:focus-visible{outline:2px solid #111;outline-offset:2px;}",

      "@media (max-width:680px){",
      ".pv-overlay{padding:0;align-items:flex-end;}",
      ".pv-modal{max-width:100%;max-height:100dvh;height:100dvh;border-radius:16px 16px 0 0;grid-template-columns:1fr;grid-template-rows:auto 1fr;}",
      ".pv-modal-image{padding:12px;}",
      ".pv-modal-image img{max-height:140px;}",
      ".pv-modal-body{max-height:none;}",
      ".pv-alt-list{flex-direction:row;}",
      "}",

      /* Modal da Tabela de Medidas */
      ".pv-chart-table{width:100%;border-collapse:collapse;font-size:13px;}",
      ".pv-chart-table th,.pv-chart-table td{border:1px solid #eee;padding:8px 10px;text-align:center;}",
      ".pv-chart-table th{background:#fafafa;font-weight:700;}",
      ".pv-chart-table tr.pv-chart-unavailable{opacity:.4;}",
      ".pv-chart-note{font-size:12px;color:#888;margin-top:10px;}"
    ].join("\n");

    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------
     8) ÍCONES (inline, sem dependência externa)
     ------------------------------------------------------------ */

  var ICON_HANGER =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a1.5 1.5 0 1 1 1.5 1.5"/><path d="M12 4.5V7"/><path d="M12 7l8.5 6.2c1 .7.5 2.3-.7 2.3H4.2c-1.2 0-1.7-1.6-.7-2.3L12 7Z"/><path d="M5 19h14"/></svg>';

  var ICON_RULER =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="7" width="19" height="10" rx="1.5"/><path d="M6 7v3M9.5 7v2M13 7v3M16.5 7v2M20 7v3"/></svg>';

  var ICON_CLOSE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  /* ------------------------------------------------------------
     9) MODAL — TABELA DE MEDIDAS
     ------------------------------------------------------------ */

  function openSizeChartModal(product, gender, availableSizes) {
    injectStylesOnce();

    var order = getSizeOrder(gender);
    var chart = getSizeChart(gender);
    var isMale = gender === "male";

    var rows = order
      .map(function (size) {
        var data = chart[size];
        var available = !!availableSizes[size];
        return (
          '<tr class="' +
          (available ? "" : "pv-chart-unavailable") +
          '"><td><strong>' +
          size +
          "</strong></td><td>" +
          data.length[0] +
          "–" +
          data.length[1] +
          " cm</td><td>" +
          data.width[0] +
          "–" +
          data.width[1] +
          " cm</td><td>" +
          data.height[0] +
          "–" +
          data.height[1] +
          " cm</td>" +
          (isMale ? "<td>" + data.weight[0] + "–" + data.weight[1] + " kg</td>" : "") +
          "</tr>"
        );
      })
      .join("");

    var html =
      '<div class="pv-modal-header"><div class="pv-modal-heading"><h2>Tabela de Medidas</h2><p>' +
      escapeHtml(product.title) +
      '</p></div><button type="button" class="pv-close" data-pv-close aria-label="Fechar">' +
      ICON_CLOSE +
      "</button></div>" +
      '<div class="pv-modal-content"><table class="pv-chart-table"><thead><tr><th>Tamanho</th><th>Comprimento</th><th>Largura</th><th>Altura</th>' +
      (isMale ? "<th>Peso</th>" : "") +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table>" +
      '<p class="pv-chart-note">Medidas aproximadas da peça. Tamanhos esmaecidos não estão disponíveis para este produto.</p></div>';

    var overlay = createOverlay("pv-chart-overlay");
    overlay.innerHTML = '<div class="pv-modal" style="grid-template-columns:1fr" role="dialog" aria-modal="true" aria-label="Tabela de medidas">' + html + "</div>";
    mountOverlay(overlay);
  }

  /* ------------------------------------------------------------
     10) MODAL — PROVADOR VIRTUAL (fluxo em 3 etapas)
     ------------------------------------------------------------ */

  function createOverlay(id) {
    var existing = document.getElementById(id);
    if (existing) {
      existing.parentNode.removeChild(existing);
    }
    var overlay = document.createElement("div");
    overlay.id = id;
    overlay.className = "pv-overlay";
    return overlay;
  }

  function mountOverlay(overlay) {
    document.body.appendChild(overlay);
    requestAnimationFrame(function () {
      overlay.classList.add("pv-open");
    });

    var lastFocused = document.activeElement;

    function close() {
      overlay.classList.remove("pv-open");
      document.removeEventListener("keydown", onKeydown);
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (lastFocused && lastFocused.focus) lastFocused.focus();
      }, 180);
    }

    function onKeydown(evt) {
      if (evt.key === "Escape") close();
    }

    overlay.addEventListener("click", function (evt) {
      if (evt.target === overlay) close();
    });

    overlay.addEventListener("click", function (evt) {
      if (evt.target.closest("[data-pv-close]")) close();
    });

    document.addEventListener("keydown", onKeydown);

    var focusable = overlay.querySelector("button, input, [tabindex]");
    if (focusable) focusable.focus();

    return close;
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function openFittingRoom(context) {
    injectStylesOnce();

    var product = context.product;
    var profile = loadProfile() || {
      height: "",
      weight: "",
      age: "",
      chest: null,
      belly: null,
      hip: null,
      fit: "normal"
    };

    var state = {
      step: 1,
      height: profile.height || "",
      weight: profile.weight || "",
      age: profile.age || "",
      chest: profile.chest,
      belly: profile.belly,
      hip: profile.hip,
      fit: profile.fit || "normal",
      result: null
    };

    var overlay = createOverlay("pv-fitting-overlay");
    var modal = document.createElement("div");
    modal.className = "pv-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Provador Virtual");

    var imageSrc = product.featured_image || (product.images && product.images[0]) || "";

    modal.innerHTML =
      '<div class="pv-modal-image">' +
      (imageSrc ? '<img src="' + escapeHtml(imageSrc) + '" alt="' + escapeHtml(product.title) + '">' : "") +
      '</div><div class="pv-modal-body" data-pv-body></div>';

    overlay.appendChild(modal);
    var close = mountOverlay(overlay);
    var bodyEl = modal.querySelector("[data-pv-body]");

    function persistProfile() {
      saveProfile({
        height: state.height,
        weight: state.weight,
        age: state.age,
        chest: state.chest,
        belly: state.belly,
        hip: state.hip,
        fit: state.fit
      });
    }

    function render() {
      if (state.step === 1) renderStep1();
      else if (state.step === 2) renderStep2();
      else renderStep3();
    }

    function stepsHtml(active) {
      var labels = ["Dados", "Corpo", "Resultado"];
      return (
        '<div class="pv-steps">' +
        labels
          .map(function (label, i) {
            return (
              '<span class="pv-step' +
              (i + 1 === active ? " pv-step-active" : "") +
              '"><span class="pv-dot"></span>' +
              (i + 1) +
              " " +
              label +
              "</span>"
            );
          })
          .join("") +
        "</div>"
      );
    }

    function renderStep1() {
      bodyEl.innerHTML =
        '<div class="pv-modal-header"><div class="pv-modal-heading"><h2>Provador Virtual</h2><p>Descubra o tamanho ideal para você</p></div><button type="button" class="pv-close" data-pv-close aria-label="Fechar">' +
        ICON_CLOSE +
        "</button></div>" +
        stepsHtml(1) +
        '<div class="pv-modal-content">' +
        '<p class="pv-hint" style="margin-bottom:18px;">Preencha seus dados e vamos encontrar a melhor opção para você.</p>' +
        '<div class="pv-field"><label for="pv-height">Altura (cm)</label><input type="number" id="pv-height" inputmode="numeric" min="100" max="230" value="' +
        escapeHtml(state.height) +
        '"><div class="pv-field-error" data-error="height"></div></div>' +
        '<div class="pv-field"><label for="pv-weight">Peso (kg)</label><input type="number" id="pv-weight" inputmode="numeric" min="30" max="250" value="' +
        escapeHtml(state.weight) +
        '"><div class="pv-field-error" data-error="weight"></div></div>' +
        '<div class="pv-field"><label for="pv-age">Idade (anos)</label><input type="number" id="pv-age" inputmode="numeric" min="5" max="110" value="' +
        escapeHtml(state.age) +
        '"><div class="pv-field-error" data-error="age"></div></div>' +
        "</div>" +
        '<div class="pv-modal-footer"><span></span><button type="button" class="pv-btn pv-btn-primary" data-pv-next>Próximo</button></div>';

      bindClose();

      var nextBtn = bodyEl.querySelector("[data-pv-next]");
      nextBtn.addEventListener("click", function () {
        state.height = bodyEl.querySelector("#pv-height").value;
        state.weight = bodyEl.querySelector("#pv-weight").value;
        state.age = bodyEl.querySelector("#pv-age").value;

        var errors = {
          height: validateHeight(state.height),
          weight: validateWeight(state.weight),
          age: validateAge(state.age)
        };

        var hasError = false;
        Object.keys(errors).forEach(function (key) {
          var el = bodyEl.querySelector('[data-error="' + key + '"]');
          if (errors[key]) {
            el.textContent = errors[key];
            hasError = true;
          } else {
            el.textContent = "";
          }
        });

        if (hasError) return;

        persistProfile();
        state.step = 2;
        render();
      });
    }

    function optionGroup(question, key, options, values) {
      return (
        '<div class="pv-question"><p class="pv-question-title">' +
        question +
        '</p><div class="pv-option-list" data-group="' +
        key +
        '">' +
        options
          .map(function (label, i) {
            var val = values[i];
            var selected = state[key] === val;
            return (
              '<button type="button" class="pv-option-btn' +
              (selected ? " pv-selected" : "") +
              '" data-key="' +
              key +
              '" data-value="' +
              val +
              '" aria-pressed="' +
              selected +
              '">' +
              label +
              "</button>"
            );
          })
          .join("") +
        "</div></div>"
      );
    }

    function renderStep2() {
      var gender = getProductGender(product);
      var isMale = gender === "male";

      bodyEl.innerHTML =
        '<div class="pv-modal-header"><div class="pv-modal-heading"><h2>Como é o seu corpo?</h2><p>Não precisa saber suas medidas. Escolha a opção que mais se parece com você.</p></div><button type="button" class="pv-close" data-pv-close aria-label="Fechar">' +
        ICON_CLOSE +
        "</button></div>" +
        stepsHtml(2) +
        '<div class="pv-modal-content">' +
        optionGroup(
          "Como são seus ombros e peito?",
          "chest",
          ["Mais estreitos", "Médios", "Mais largos"],
          [-1, 0, 1]
        ) +
        optionGroup(
          "Como é sua região da barriga?",
          "belly",
          ["Mais fina", "Média", "Mais larga"],
          [-1, 0, 1]
        ) +
        optionGroup(
          "Como é seu quadril?",
          "hip",
          ["Mais estreito", "Médio", "Mais largo"],
          [-1, 0, 1]
        ) +
        '<p class="pv-hint">Se estiver em dúvida, escolha Médio.</p>' +
        optionGroup(
          "Como você prefere usar sua camisa?",
          "fit",
          ["Mais ajustada", "Caimento normal", "Mais folgada"],
          ["ajustada", "normal", "folgada"]
        ) +
        '<p class="pv-hint">Isso nos ajuda a escolher entre tamanhos próximos.</p>' +
        (isMale
          ? ""
          : '<p class="pv-hint">Para camisas femininas, o peso não segue uma tabela oficial — usamos altura, formato do corpo e caimento para a recomendação.</p>') +
        "</div>" +
        '<div class="pv-modal-footer"><button type="button" class="pv-btn pv-btn-secondary" data-pv-back>Voltar</button><button type="button" class="pv-btn pv-btn-primary" data-pv-next>Próximo</button></div>';

      bindClose();

      bodyEl.querySelectorAll(".pv-option-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var key = btn.getAttribute("data-key");
          var rawVal = btn.getAttribute("data-value");
          state[key] = key === "fit" ? rawVal : parseInt(rawVal, 10);

          bodyEl.querySelectorAll('[data-group="' + key + '"] .pv-option-btn').forEach(function (b) {
            b.classList.remove("pv-selected");
            b.setAttribute("aria-pressed", "false");
          });
          btn.classList.add("pv-selected");
          btn.setAttribute("aria-pressed", "true");
        });
      });

      bodyEl.querySelector("[data-pv-back]").addEventListener("click", function () {
        state.step = 1;
        render();
      });

      bodyEl.querySelector("[data-pv-next]").addEventListener("click", function () {
        if (state.chest === undefined) state.chest = 0;
        if (state.belly === undefined) state.belly = 0;
        if (state.hip === undefined) state.hip = 0;

        persistProfile();

        state.result = calculateSizeRecommendation(product, {
          height: parseFloat(state.height),
          weight: parseFloat(state.weight),
          age: parseFloat(state.age),
          bodyShape: { chest: state.chest, belly: state.belly, hip: state.hip },
          fit: state.fit
        });

        state.step = 3;
        render();
      });
    }

    function renderStep3() {
      var result = state.result;
      var gender = getProductGender(product);

      var footer =
        '<div class="pv-modal-footer"><button type="button" class="pv-btn pv-btn-secondary" data-pv-edit>Editar informações</button>';

      var contentHtml = "";

      if (result.error === "no-size-option") {
        contentHtml =
          '<p class="pv-unavailable">Não encontramos uma opção de tamanho configurada para este produto. Fale com a gente antes de comprar.</p>';
        footer += "</div>";
      } else if (result.error === "no-available-sizes") {
        contentHtml =
          '<p class="pv-unavailable">No momento não há tamanhos disponíveis em estoque para este produto.</p>';
        footer += "</div>";
      } else {
        saveLastResult(product.id, result.recommended);

        var explainList = EXPLANATION_FACTORS[gender]
          .map(function (item) {
            return "<li>✓ " + item + "</li>";
          })
          .join("");

        var unavailableNotice = "";
        if (!result.recommendedIsIdeal) {
          unavailableNotice =
            '<p class="pv-unavailable">O tamanho ' +
            result.idealCanonical +
            " seria o mais indicado, mas está indisponível. Melhor alternativa disponível: <strong>" +
            result.recommended +
            "</strong>.</p>";
        }

        var betweenNotice = "";
        if (result.betweenTwo && result.recommendedIsIdeal) {
          betweenNotice =
            '<div class="pv-between">Você está entre dois tamanhos.<br>Recomendamos <strong>' +
            result.recommended +
            "</strong> para um caimento " +
            (state.fit === "normal" ? "normal" : state.fit) +
            ".</div>";
        }

        var altHtml = result.alternatives
          .map(function (alt) {
            return (
              '<div class="pv-alt-card' +
              (alt.size === result.recommended ? " pv-alt-main" : "") +
              '"><div class="pv-alt-size">' +
              alt.size +
              '</div><div class="pv-alt-label">' +
              alt.label +
              "</div></div>"
            );
          })
          .join("");

        contentHtml =
          '<div class="pv-result-size"><div style="font-size:13px;color:#777;">SEU TAMANHO RECOMENDADO</div><div class="pv-size-value">' +
          result.recommended +
          '</div><div class="pv-size-check">✓ Melhor opção para você</div></div>' +
          '<p class="pv-result-text">Com base nas informações que você informou, o tamanho ' +
          result.recommended +
          " é a melhor correspondência para você.</p>" +
          unavailableNotice +
          betweenNotice +
          '<div class="pv-explain"><h3>Como chegamos a esse resultado?</h3><ul>' +
          explainList +
          "</ul></div>" +
          (result.alternatives.length > 1
            ? '<p class="pv-alt-title">Você também pode considerar:</p><div class="pv-alt-list">' + altHtml + "</div>"
            : "");

        footer +=
          '<button type="button" class="pv-btn pv-btn-primary" data-pv-choose>Escolher tamanho ' +
          result.recommended +
          "</button></div>";
      }

      bodyEl.innerHTML =
        '<div class="pv-modal-header"><div class="pv-modal-heading"><h2>Seu tamanho recomendado</h2><p>' +
        escapeHtml(product.title) +
        '</p></div><button type="button" class="pv-close" data-pv-close aria-label="Fechar">' +
        ICON_CLOSE +
        "</button></div>" +
        stepsHtml(3) +
        '<div class="pv-modal-content">' +
        contentHtml +
        "</div>" +
        footer;

      bindClose();

      var editBtn = bodyEl.querySelector("[data-pv-edit]");
      if (editBtn) {
        editBtn.addEventListener("click", function () {
          state.step = 1;
          render();
        });
      }

      var chooseBtn = bodyEl.querySelector("[data-pv-choose]");
      if (chooseBtn) {
        chooseBtn.addEventListener("click", function () {
          var ok = selectRecommendedVariant(context.scope, result.optionPosition, result.recommendedRaw);
          if (ok) {
            context.refreshRecommendationLine(result.recommended);
            close();
          } else {
            chooseBtn.textContent = "Não foi possível selecionar automaticamente";
            chooseBtn.disabled = true;
          }
        });
      }
    }

    function bindClose() {
      // o listener de clique já está no overlay (delegação); nada a fazer aqui.
    }

    render();
  }

  /* ------------------------------------------------------------
     11) INJEÇÃO NA PÁGINA DE PRODUTO
     ------------------------------------------------------------ */

  function buildTriggerRow(product, optionPosition, scope) {
    var row = document.createElement("div");
    row.className = "pv-trigger-row";

    var lastResult = loadLastResult(product.id);
    var recommendLine = "";
    if (lastResult) {
      recommendLine =
        '<p class="pv-recommend-line">Recomendamos o tamanho <strong>' + lastResult + "</strong></p>";
    }

    row.innerHTML =
      recommendLine +
      '<button type="button" class="pv-trigger" data-pv-open-fitting>' +
      ICON_HANGER +
      "<span>Provador Virtual</span></button>" +
      '<button type="button" class="pv-trigger" data-pv-open-chart>' +
      ICON_RULER +
      "<span>Tabela de Medidas</span></button>";

    function refreshRecommendationLine(canonicalSize) {
      var existing = row.querySelector(".pv-recommend-line");
      var html = '<p class="pv-recommend-line">Recomendamos o tamanho <strong>' + canonicalSize + "</strong></p>";
      if (existing) {
        existing.outerHTML = html;
      } else {
        row.insertAdjacentHTML("afterbegin", html);
      }
    }

    row.querySelector("[data-pv-open-fitting]").addEventListener("click", function () {
      openFittingRoom({
        product: product,
        scope: scope,
        refreshRecommendationLine: refreshRecommendationLine
      });
    });

    row.querySelector("[data-pv-open-chart]").addEventListener("click", function () {
      var gender = getProductGender(product);
      var availableSizes = getAvailableSizes(product, optionPosition, gender);
      openSizeChartModal(product, gender, availableSizes);
    });

    return row;
  }

  function mountProvador(productJsonScript) {
    var data;
    try {
      data = JSON.parse(productJsonScript.textContent);
    } catch (e) {
      return;
    }

    var product = data && data.product;
    if (!product || !product.variants || !product.variants.length) {
      return;
    }

    var optionPosition = findSizeOptionPosition(product);
    if (!optionPosition) {
      return;
    }

    var scope = productJsonScript.closest(".card") || document;

    var anchorInput = scope.querySelector(
      '.product-form__single-selector[data-option-position="' + optionPosition + '"]'
    );
    if (!anchorInput) {
      return;
    }

    var swatchList = anchorInput.closest(".block-swatch-list") || anchorInput.closest(".select-wrapper");
    if (!swatchList || swatchList.dataset.pvMounted) {
      return;
    }
    swatchList.dataset.pvMounted = "true";

    var row = buildTriggerRow(product, optionPosition, scope);
    swatchList.insertAdjacentElement("afterend", row);
  }

  function init() {
    if (!document.body.classList.contains("template-product")) {
      return;
    }

    injectStylesOnce();

    var scripts = document.querySelectorAll("[data-product-json]");
    scripts.forEach(mountProvador);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }

    /* Exposto apenas para depuração/testes manuais no console. */
    window.ProvadorVirtual = {
      SIZE_CHARTS: SIZE_CHARTS,
      getProductGender: getProductGender,
      calculateSizeRecommendation: calculateSizeRecommendation,
      getAvailableSizes: getAvailableSizes,
      canonicalizeSize: canonicalizeSize
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      getProductGender: getProductGender,
      getSizeChart: getSizeChart,
      getSizeOrder: getSizeOrder,
      canonicalizeSize: canonicalizeSize,
      findSizeOptionPosition: findSizeOptionPosition,
      getAvailableSizes: getAvailableSizes,
      calculateSizeRecommendation: calculateSizeRecommendation,
      getAlternativeSizes: getAlternativeSizes,
      validateHeight: validateHeight,
      validateWeight: validateWeight,
      validateAge: validateAge
    };
  }
})();
