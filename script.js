  // ============================================================
  //  CONFIGURACOES - EDITE AQUI
  // ============================================================
  var CONFIG = {
    TOTAL: 500,                                  // Total de fichas
    PRICE: 3,                                    // Valor da ficha em reais
    PRIZE: "Cesta Cheia de Guloseimas",
    DRAW_DATE: "confira com os vendedores",      // Data do sorteio
    VISIBLE_START: 150,                          // Quantas fichas aparecem inicialmente
    VISIBLE_MIN: 42,                             // Quantas fichas ficam ao clicar em "Ver menos"
    SELLERS: [
      // Informe o nome, o numero do WhatsApp (codigo do pais + DDD + numero) e a foto de perfil
      // Coloque as fotos na mesma pasta do site (ex.: foto-mariana.jpg e foto-jeissianny.jpg)
      { name: "Mariana", whatsapp: "+553899848800", photo: "mariana.png" },
      { name: "Jeissiany", whatsapp: "+553898708244", photo: "jeiisi.jpeg" }
    ]
  };
  // ============================================================

  // ==================================================================
  //  CAMADA DE DADOS
  //  Hoje usa localStorage (dados no navegador de cada visitante).
  //  Quando for instalar o banco de dados, basta trocar as funcoes
  //  registerUser / loginUser / listReservas por chamadas a sua API.
  // ==================================================================
  var USERS_KEY = "rifa_usuarios";
  var SESSION_KEY = "rifa_sessao";
  var RESERVAS_KEY = "rifa_reservas";
  var SOLDS_KEY = "rifa_vendidas";
  var LOG_KEY = "rifa_log";
  var WINNER_KEY = "rifa_vencedora";

  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    if (key === "rifa_reservas") {
      if (typeof sbReservaUpsert === "function") {
        var _rows = [];
        for (var _f in value) {
          var _r = value[_f] || {};
          _rows.push({ ficha: Number(_f), nome_cliente: String(_r.nome || "").slice(0, 150), celular_cli: String(_r.celular || ""), status: "pendente", data_reserva: _r.data || null });
        }
        sbReservaUpsert(_rows);
      } else if (!window.__sbWarned) { window.__sbWarned = true; console.error("supabase-sync.js nao carregou — dados ficam so no localStorage."); }
      return;
    }
    if (typeof sbSyncKey === "function") { sbSyncKey(key, value); }
    else if (!window.__sbWarned) { window.__sbWarned = true; console.error("supabase-sync.js nao carregou — dados ficam so no localStorage."); }
  }

  // Baixa os dados mais recentes do banco antes de qualquer leitura
  if (typeof sbHydrate === "function") { sbHydrate(); }

  // Hash simples para nao guardar a senha em texto puro (trocar pelo backend)
  function hashPass(P) {
    var h = 5381;
    for (var i = 0; i < P.length; i++) h = ((h << 5) + h + P.charCodeAt(i)) | 0;
    return "h" + Math.abs(h).toString(36) + "_" + P.length;
  }

  function registerUser(nome, idade, celular, senha) {
    var users = loadJSON(USERS_KEY, {});
    var c = String(celular).replace(/\D/g, "");
    if (users[c]) return { ok: false, msg: "Este celular ja esta cadastrado." };
    users[c] = { nome: nome.trim(), idade: Number(idade), senha: hashPass(senha), criadoEm: new Date().toISOString() };
    saveJSON(USERS_KEY, users);
    return { ok: true };
  }

  function loginUser(celular, senha) {
    var users = loadJSON(USERS_KEY, {});
    var c = String(celular).replace(/\D/g, "");
    var u = users[c];
    if (!u) return { ok: false, msg: "Celular nao cadastrado. Faca o cadastro." };
    if (u.senha !== hashPass(senha)) return { ok: false, msg: "Senha incorreta." };
    return { ok: true, user: u, celular: c };
  }

  var reservas = loadJSON(RESERVAS_KEY, {});
  var reserved = new Set(Object.keys(reservas).map(Number));

  // Fichas vendidas (marcadas pelo administrador)
  var financeiro = loadJSON(SOLDS_KEY, {});
  var soldNumbers = new Set(Object.keys(financeiro).map(Number));

  var currentUser = null;
  (function () {
    var s = loadJSON(SESSION_KEY, null);
    var users = loadJSON(USERS_KEY, {});
    if (s && users[s.celular]) {
      currentUser = users[s.celular];
      currentUser.celular = s.celular;
    }
  })();

  // Fichas pre-vendidas (edite manualmente se quiser marcar numeros ja vendidos)
  // Ex.: var PREDEFINED_SOLD = [7, 42, 99];
  var PREDEFINED_SOLD = [];

  var grid = document.getElementById("grid");
  var overlay = document.getElementById("overlay");
  var loginOverlay = document.getElementById("loginOverlay");
  var currentNumber = null;
  var pendingFicha = null;

  var priceText = CONFIG.PRICE.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  document.getElementById("statPrice").textContent = priceText;

  // Gera as fichas no quadro
  for (var i = 1; i <= CONFIG.TOTAL; i++) {
    var cell = document.createElement("div");
    cell.className = "ficha available";
    cell.dataset.num = i;
    cell.textContent = pad(i);
    cell.addEventListener("click", function (e) {
      var n = parseInt(e.currentTarget.dataset.num, 10);
      openModal(n);
    });
    grid.appendChild(cell);
  }

  var visibleCount = CONFIG.VISIBLE_START;

  document.getElementById("btnToggle").addEventListener("click", function () {
    if (visibleCount >= CONFIG.TOTAL) {
      visibleCount = CONFIG.VISIBLE_MIN;
    } else {
      visibleCount = CONFIG.TOTAL;
    }
    applyVisible();
  });

  function applyVisible() {
    var cells = grid.querySelectorAll(".ficha");
    for (var i = 0; i < cells.length; i++) {
      cells[i].style.display = i < visibleCount ? "" : "none";
    }
    var btn = document.getElementById("btnToggle");
    btn.textContent = visibleCount >= CONFIG.TOTAL ? "Ver menos fichas" : "Ver mais fichas";
  }

  function pad(n) {
    return String(n).padStart(3, "0");
  }

  // Mostra o nome do comprador logado no ticket, abaixo da logo
  function updateTicketName() {
    var el = document.getElementById("ticketBuyerName");
    if (!el) return;
    var nome = currentUser ? currentUser.nome : "COMPRADOR";
    var size = nome.length > 22 ? 13 : nome.length > 16 ? 14 : 16;
    el.textContent = nome;
    el.setAttribute("font-size", String(size));
  }

  // Mostra no canhoto o numero da ficha e se ela esta paga ou pendente
  function updateTicketInfo(n) {
    var numEl = document.getElementById("ticketFichaNum");
    var stEl = document.getElementById("ticketStatus");
    if (numEl) numEl.textContent = n ? "#" + pad(n) : "—";
    if (!stEl) return;
    var paid = false;
    if (n && currentUser) {
      var cel = (currentUser.celular || "").replace(/\D/g, "");
      var financeiro = loadJSON(SOLDS_KEY, {});
      var s = financeiro[n];
      paid = s && (s.celular || "").replace(/\D/g, "") === cel;
    }
    stEl.textContent = paid ? "PAGO" : "PENDENTE";
    stEl.setAttribute("fill", paid ? "#22C55E" : "#F59E0B");
  }

  // Gera o SVG de um ticket preenchido para a ficha n (usado em "Meus Tickets")
  function ticketSVG(n, nome) {
    var paid = false;
    if (currentUser) {
      var cel = (currentUser.celular || "").replace(/\D/g, "");
      var financeiro = loadJSON(SOLDS_KEY, {});
      var s = financeiro[n];
      paid = s && (s.celular || "").replace(/\D/g, "") === cel;
    }
    var status = paid ? "PAGO" : "PENDENTE";
    var statusColor = paid ? "#22C55E" : "#F59E0B";
    var esc = function (t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
    var safeNome = esc(nome);
    var numText = "#" + pad(n);
    var nomeSize = safeNome.length > 22 ? 13 : safeNome.length > 16 ? 16 : 21;
    return (
      '<svg class="ticket-svg" viewBox="0 0 600 200" xmlns="http://www.w3.org/2000/svg">' +
      '<defs>' +
      '<clipPath id="ts' + n + '"><path d="M12,0 H450 A10,10 0 0 0 470,0 H588 A12,12 0 0 1 600,12 V188 A12,12 0 0 1 588,200 H470 A10,10 0 0 0 450,200 H12 A12,12 0 0 1 0,188 V12 A12,12 0 0 1 12,0 Z"/></clipPath>' +
      '<linearGradient id="tb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101010"/><stop offset=".35" stop-color="#030303"/><stop offset="1" stop-color="#070707"/></linearGradient>' +
      '<linearGradient id="td' + n + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0088FF"/><stop offset=".5" stop-color="#0066FF"/><stop offset="1" stop-color="#00AFFF"/></linearGradient>' +
      '<radialGradient id="tg' + n + '" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#0066FF" stop-opacity=".3"/><stop offset="1" stop-color="#0066FF" stop-opacity="0"/></radialGradient>' +
      '<filter id="fgl' + n + '" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="22"/></filter>' +
      '<filter id="fglS' + n + '" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="10"/></filter>' +
      '</defs>' +
      '<g clip-path="url(#ts' + n + ')">' +
      '<rect width="600" height="200" fill="url(#tb)"/>' +
      '<ellipse cx="230" cy="100" rx="215" ry="85" fill="url(#tg' + n + ')"/>' +
      '<circle cx="230" cy="100" r="45" fill="none" stroke="#0066FF" stroke-width="1" stroke-dasharray="6 4" opacity=".5"/>' +
      '<circle cx="230" cy="100" r="36" fill="none" stroke="#0088FF" stroke-width=".8" stroke-dasharray="2 5" opacity=".45"/>' +
      '<circle cx="230" cy="100" r="72" fill="url(#tg' + n + ')"/>' +
      '<image href="logo%20sala.png" x="168" y="26" width="124" height="124" preserveAspectRatio="xMidYMid meet"/>' +
      '<text x="230" y="180" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="' + nomeSize + '" letter-spacing="1" fill="#FFFFFF">' + safeNome + '</text>' +
      '</g>' +
      '<g fill="#0a0a0a" stroke="#0066FF" stroke-width=".8">' +
      '<circle cx="460" cy="12" r="5"/><circle cx="460" cy="24" r="5"/><circle cx="460" cy="36" r="5"/><circle cx="460" cy="48" r="5"/><circle cx="460" cy="60" r="5"/><circle cx="460" cy="72" r="5"/><circle cx="460" cy="84" r="5"/><circle cx="460" cy="96" r="5"/><circle cx="460" cy="108" r="5"/><circle cx="460" cy="120" r="5"/><circle cx="460" cy="132" r="5"/><circle cx="460" cy="144" r="5"/><circle cx="460" cy="156" r="5"/><circle cx="460" cy="168" r="5"/><circle cx="460" cy="180" r="5"/><circle cx="460" cy="192" r="5"/>' +
      '</g>' +
      '<line x1="460" y1="18" x2="460" y2="186" stroke="#0088FF" stroke-width=".5" stroke-dasharray="2 12" opacity=".5"/>' +
      '<g clip-path="url(#ts' + n + ')">' +
      '<rect x="460" y="0" width="140" height="200" fill="url(#tb)"/>' +
      '<text x="530" y="46" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="9" letter-spacing="3" fill="#FFFFFF">FICHA</text>' +
      '<text x="530" y="88" text-anchor="middle" font-family="Arial Black, sans-serif" font-weight="900" font-size="30" fill="url(#td' + n + ')">' + numText + '</text>' +
      '<line x1="488" y1="102" x2="572" y2="102" stroke="#0088FF" stroke-width="1" opacity=".5"/>' +
      '<text x="530" y="132" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="14" letter-spacing="3" fill="' + statusColor + '">' + status + '</text>' +
      '<line x1="478" y1="166" x2="582" y2="166" stroke="#0088FF" stroke-width=".5" opacity=".4"/>' +
      '<text x="530" y="190" text-anchor="middle" font-family="Arial, sans-serif" font-weight="400" font-size="5.5" letter-spacing="2" fill="#0066FF" opacity=".35">SÉRIE-A // 2026</text>' +
      '</g>' +
      '<path d="M12,0 H450 A10,10 0 0 0 470,0 H588 A12,12 0 0 1 600,12 V188 A12,12 0 0 1 588,200 H470 A10,10 0 0 0 450,200 H12 A12,12 0 0 1 0,188 V12 A12,12 0 0 1 12,0 Z" fill="none" stroke="' + statusColor + '" stroke-width="13" filter="url(#fgl' + n + ')" opacity=".95"/>' +
      '<path d="M12,0 H450 A10,10 0 0 0 470,0 H588 A12,12 0 0 1 600,12 V188 A12,12 0 0 1 588,200 H470 A10,10 0 0 0 450,200 H12 A12,12 0 0 1 0,188 V12 A12,12 0 0 1 12,0 Z" fill="none" stroke="' + statusColor + '" stroke-width="8" filter="url(#fglS' + n + ')" opacity=".7"/>' +
      '<path d="M12,0 H450 A10,10 0 0 0 470,0 H588 A12,12 0 0 1 600,12 V188 A12,12 0 0 1 588,200 H470 A10,10 0 0 0 450,200 H12 A12,12 0 0 1 0,188 V12 A12,12 0 0 1 12,0 Z" fill="none" stroke="' + statusColor + '" stroke-width="3.5"/>' +
      '</svg>'
    );
  }

  // Lista de tickets das fichas do usuario logado (reservadas ou pagas)
  function myTicketNumbers() {
    if (!currentUser) return [];
    var cel = (currentUser.celular || "").replace(/\D/g, "");
    var nums = [];
    var seen = {};
    var reservas = loadJSON(RESERVAS_KEY, {});
    Object.keys(reservas).forEach(function (k) {
      var r = reservas[k];
      if ((r.celular || "").replace(/\D/g, "") === cel && !seen[k]) {
        seen[k] = true;
        nums.push(Number(k));
      }
    });
    var financeiro = loadJSON(SOLDS_KEY, {});
    Object.keys(financeiro).forEach(function (k) {
      var s = financeiro[k];
      if ((s.celular || "").replace(/\D/g, "") === cel && !seen[k]) {
        seen[k] = true;
        nums.push(Number(k));
      }
    });
    nums.sort(function (a, b) { return a - b; });
    return nums;
  }

  // Renderiza a secao "Meus Tickets"
  function renderMyTickets() {
    var section = document.getElementById("myTicketsSection");
    var list = document.getElementById("myTicketsList");
    if (!section || !list) return;
    var nums = myTicketNumbers();
    if (!currentUser || nums.length === 0) {
      section.style.display = "none";
      return;
    }
    section.style.display = "";
    list.innerHTML = "";
    var nome = currentUser.nome + " • " + pad(nums[0]);
    for (var i = 0; i < nums.length; i++) {
      var card = document.createElement("div");
      card.className = "my-ticket-card";
      card.innerHTML = ticketSVG(nums[i], currentUser.nome);
      list.appendChild(card);
    }
  }

  // Botao ocultar/mostrar os tickets
  var ticketsHidden = false;
  var btnToggle = document.getElementById("btnToggleTickets");
  if (btnToggle) {
    btnToggle.addEventListener("click", function () {
      var list = document.getElementById("myTicketsList");
      if (!list) return;
      ticketsHidden = !ticketsHidden;
      list.style.display = ticketsHidden ? "none" : "";
      btnToggle.textContent = ticketsHidden ? "Mostrar tickets" : "Ocultar tickets";
    });
  }

  function openModal(n) {
    if (reserved.has(n)) return;
    if (PREDEFINED_SOLD.indexOf(n) !== -1) return;
    if (soldNumbers.has(n)) return;

    if (!currentUser) {
      pendingFicha = n;
      showLogin("Entre ou cadastre-se para reservar a ficha " + pad(n) + ".");
      return;
    }

    currentNumber = n;
    document.getElementById("modalNumber").textContent = pad(n);
    document.getElementById("modalNumberText").textContent = "#" + pad(n);
    updateTicketName();
    updateTicketInfo(n);

    var box = document.getElementById("sellerButtons");
    box.innerHTML = "";

    var msg = encodeURIComponent(
      "Olá fiquei interessado pela rifa 3° EMTI, Quero comprar a ficha número " + pad(n) + " dessa rifa."
    );

    CONFIG.SELLERS.forEach(function (s) {
      var link = document.createElement("a");
      link.className = "wa-btn";
      link.href = "https://wa.me/" + s.whatsapp + "?text=" + msg;
      link.target = "_blank";
      link.rel = "noopener";
      link.innerHTML =
        '<span class="seller-avatar">' +
        (s.photo ? '<img src="' + s.photo + '" alt="" onerror="this.remove()" />' : "") +
        '<span class="seller-init">' + s.name.charAt(0) + "</span>" +
        "</span>" +
        "<span>" + s.name + "</span>";
      box.appendChild(link);
    });

    overlay.classList.add("show");
  }

  // Reserva a ficha ao confirmar a compra (links abrem o WhatsApp)
  function reserveNumber(n) {
    if (!currentUser) return;
    reservas[n] = { nome: currentUser.nome, celular: currentUser.celular, data: new Date().toISOString() };
    saveJSON(RESERVAS_KEY, reservas);
    reserved.add(n);
    updateTicketName();
    updateTicketInfo(n);
    renderMyTickets();
    updateGrid();
  }

  // Marca a ficha como reservada quando o vendedor e contatado
  document.body.addEventListener("click", function (e) {
    var el = e.target.closest(".wa-btn");
    if (el && currentNumber) {
      reserveNumber(currentNumber);
    }
  });

  function updateGrid() {
    var cells = grid.querySelectorAll(".ficha");
    var winner = loadJSON(WINNER_KEY, null);
    var winnerNum = winner ? Number(winner.numero) : null;
    cells.forEach(function (cell) {
      var n = parseInt(cell.dataset.num, 10);
      if (PREDEFINED_SOLD.indexOf(n) !== -1 || soldNumbers.has(n)) {
        cell.className = "ficha sold";
      } else if (reserved.has(n)) {
        cell.className = "ficha reserved";
      } else {
        cell.className = "ficha available";
      }
      if (winnerNum && n === winnerNum) {
        cell.classList.add("winner-ficha-destaque");
      }
    });

    var soldCount = PREDEFINED_SOLD.length + soldNumbers.size;
    var rest = CONFIG.TOTAL - reserved.size - soldCount;
    document.getElementById("statReserved").textContent = reserved.size;
    document.getElementById("statRest").textContent = Math.max(rest, 0);
  }

  document.getElementById("closeBtn").addEventListener("click", function () {
    overlay.classList.remove("show");
  });

  // ==================================================================
  //  AUTENTICACAO / CADASTRO
  // ==================================================================
  function showLogin(msg) {
    document.getElementById("loginMsg").textContent = msg || "";
    switchTab("login");
    loginOverlay.classList.add("show");
    setTimeout(function () {
      var f = document.getElementById("loginCelular");
      if (f) f.focus();
    }, 100);
  }

  function updateAuthBar() {
    var userInfo = document.getElementById("userInfo");
    var btnLogin = document.getElementById("btnLogin");
    var adminLink = document.getElementById("adminOpenBtn");
    var delBtn = document.getElementById("deleteAccountBtn");
    if (currentUser) {
      userInfo.style.display = "";
      document.getElementById("userName").textContent = currentUser.nome;
      btnLogin.style.display = "none";
      if (delBtn) delBtn.style.display = "";
      var admins = loadJSON("rifa_admins", []);
      var isAdmin = false;
      var nomeLower = currentUser.nome.toLowerCase();
      var celClean = (currentUser.celular || "").replace(/\D/g, "");
      for (var i = 0; i < admins.length; i++) {
        var adminCel = (admins[i].celular || "").replace(/\D/g, "");
        var adminNome = (admins[i].nome || "").toLowerCase();
        if ((adminCel && adminCel === celClean) || (adminNome && adminNome === nomeLower)) {
          isAdmin = true;
          break;
        }
      }
      adminLink.style.display = isAdmin ? "" : "none";
    } else {
      userInfo.style.display = "none";
      btnLogin.style.display = "";
      adminLink.style.display = "none";
      if (delBtn) delBtn.style.display = "none";
    }
    updateTicketName();
    renderMyTickets();
  }

  // ==================================================================
  //  EXCLUIR CONTA (aguarda 10s, depois pede a senha)
  // ==================================================================
  var delModal = document.getElementById("delModal");
  var delPass = document.getElementById("delPass");
  var delYes = document.getElementById("delYes");
  var delNo = document.getElementById("delNo");
  var delMeta = document.getElementById("delMeta");
  var delError = document.getElementById("delError");
  var delTimer = null;

  document.getElementById("deleteAccountBtn").addEventListener("click", function () {
    if (!currentUser || !delModal) return;
    delMeta.textContent = currentUser.nome + " • " + (currentUser.celular || "");
    delError.textContent = "";
    delPass.value = "";
    delPass.disabled = true;
    var left = 10;
    delYes.disabled = true;
    delYes.style.opacity = ".5";
    delYes.textContent = "Aguardando " + left + "s…";
    if (delTimer) { clearInterval(delTimer); delTimer = null; }
    delTimer = setInterval(function () {
      left--;
      if (left <= 0) {
        clearInterval(delTimer);
        delTimer = null;
        delPass.disabled = false;
        delYes.disabled = false;
        delYes.style.opacity = "1";
        delYes.textContent = "Deletar conta";
        delPass.focus();
      } else {
        delYes.textContent = "Aguardando " + left + "s…";
      }
    }, 1000);
    delModal.style.display = "flex";
  });

  if (delNo) {
    delNo.addEventListener("click", function () {
      if (delTimer) { clearInterval(delTimer); delTimer = null; }
      if (delModal) delModal.style.display = "none";
    });
  }
  if (delModal) {
    delModal.addEventListener("click", function (e) {
      if (e.target === delModal && delNo) delNo.click();
    });
  }
  if (delYes) {
    delYes.addEventListener("click", function () {
      if (!currentUser || delPass.disabled) return;
      var users = loadJSON(USERS_KEY, {});
      var c = (currentUser.celular || "").replace(/\D/g, "");
      var u = users[c];
      if (!u) { delError.textContent = "Conta não encontrada."; return; }
      if (hashPass(delPass.value) !== u.senha) { delError.textContent = "Senha incorreta. Tente novamente."; return; }
      delete users[c];
      saveJSON(USERS_KEY, users);
      var resCache = loadJSON(RESERVAS_KEY, {});
      Object.keys(resCache).forEach(function (k) {
        var r = resCache[k] || {};
        if ((r.celular || "").replace(/\D/g, "") === c) {
          delete resCache[k];
        }
      });
      saveJSON(RESERVAS_KEY, resCache);
      reserved = new Set(Object.keys(resCache).map(Number));
      localStorage.removeItem(SESSION_KEY);
      currentUser = null;
      if (delTimer) { clearInterval(delTimer); delTimer = null; }
      if (delModal) delModal.style.display = "none";
      updateAuthBar();
      updateGrid();
      if (typeof sbToast === "function") { sbToast("Sessão encerrada — seus dados permanecem no banco", "ok"); }
    });
  }

  function switchTab(which) {
    var lf = document.getElementById("loginForm");
    var rf = document.getElementById("registerForm");
    var tl = document.getElementById("tabLogin");
    var tr = document.getElementById("tabRegister");
    if (which === "register") {
      rf.style.display = "";
      lf.style.display = "none";
      tr.classList.add("active");
      tl.classList.remove("active");
    } else {
      lf.style.display = "";
      rf.style.display = "none";
      tl.classList.add("active");
      tr.classList.remove("active");
    }
  }

  document.getElementById("tabLogin").addEventListener("click", function () { switchTab("login"); });
  document.getElementById("tabRegister").addEventListener("click", function () { switchTab("register"); });
  document.getElementById("btnLogin").addEventListener("click", function () { showLogin(""); });

  var toggleRegBtn = document.getElementById("toggleRegSenha");
  if (toggleRegBtn) {
    toggleRegBtn.addEventListener("click", function () {
      var input = document.getElementById("regSenha");
      var mostrar = input.type === "password";
      input.type = mostrar ? "text" : "password";
      toggleRegBtn.textContent = mostrar ? "🙈" : "👁";
      input.focus();
    });
  }

  var toggleLoginBtn = document.getElementById("toggleLoginSenha");
  if (toggleLoginBtn) {
    toggleLoginBtn.addEventListener("click", function () {
      var input = document.getElementById("loginSenha");
      var mostrar = input.type === "password";
      input.type = mostrar ? "text" : "password";
      toggleLoginBtn.textContent = mostrar ? "🙈" : "👁";
      input.focus();
    });
  }

  document.getElementById("logoutBtn").addEventListener("click", function () {
    currentUser = null;
    localStorage.removeItem(SESSION_KEY);
    updateAuthBar();
  });

  document.getElementById("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var cel = document.getElementById("loginCelular").value;
    var senha = document.getElementById("loginSenha").value;
    var r = loginUser(cel, senha);
    var err = document.getElementById("loginError");
    if (!r.ok) { err.textContent = r.msg; return; }
    err.textContent = "";
    currentUser = r.user;
    currentUser.celular = r.celular;
    saveJSON(SESSION_KEY, { celular: r.celular });
    if (typeof sbRegLog === "function") { sbRegLog("usuario", r.celular); }
    loginOverlay.classList.remove("show");
    updateAuthBar();
    checkForWin();
    if (pendingFicha) {
      var f = pendingFicha;
      pendingFicha = null;
      openModal(f);
    }
  });

  document.getElementById("registerForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var nome = document.getElementById("regNome").value;
    var idade = document.getElementById("regIdade").value;
    var cel = document.getElementById("regCelular").value;
    var senha = document.getElementById("regSenha").value;
    var err = document.getElementById("regError");
    if (nome.trim().length < 3) { err.textContent = "Digite o nome completo."; return; }
    if (!idade || Number(idade) < 1 || Number(idade) > 120) { err.textContent = "Digite uma idade valida."; return; }
    if (cel.replace(/\D/g, "").length < 10) { err.textContent = "Digite um numero de celular valido."; return; }
    var celClean = cel.replace(/\D/g, "");
    var ddd = parseInt(celClean.substring(0, 2), 10);
    if (ddd < 11 || ddd > 99) { err.textContent = "DDD invalido (deve ser entre 11 e 99)."; return; }
    if (celClean.length === 11 && celClean[2] !== "9") { err.textContent = "Celular invalido: numeros com 11 digitos devem comecar com 9."; return; }
    if (celClean.length < 10 || celClean.length > 11) { err.textContent = "Numero invalido: use DDD + telefone (10 digitos) ou DDD + celular (11 digitos)."; return; }
    if (/^(\d)\1+$/.test(celClean)) { err.textContent = "Numero invalido: todos os digitos sao iguais."; return; }
    if (senha.length < 4) { err.textContent = "A senha deve ter ao menos 4 caracteres."; return; }
    var r = registerUser(nome, idade, cel, senha);
    if (!r.ok) { err.textContent = r.msg; return; }
    err.textContent = "";
    var lr = loginUser(cel, senha);
    currentUser = lr.user;
    currentUser.celular = lr.celular;
    saveJSON(SESSION_KEY, { celular: lr.celular });
    if (typeof sbRegLog === "function") { sbRegLog("usuario", lr.celular); }
    loginOverlay.classList.remove("show");
    document.getElementById("registerForm").reset();
    updateAuthBar();
    checkForWin();
    if (pendingFicha) {
      var f = pendingFicha;
      pendingFicha = null;
      openModal(f);
    }
  });

  document.getElementById("closeLoginBtn").addEventListener("click", function () {
    loginOverlay.classList.remove("show");
    pendingFicha = null;
  });

  loginOverlay.addEventListener("click", function (e) {
    if (e.target === loginOverlay) {
      loginOverlay.classList.remove("show");
      pendingFicha = null;
    }
  });

  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) overlay.classList.remove("show");
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      overlay.classList.remove("show");
      loginOverlay.classList.remove("show");
      pendingFicha = null;
    }
  });

  // Registra a data no "banco" (localStorage) a cada 2 dias
  function recordOpen() {
    try {
      var log = loadJSON(LOG_KEY, []);
      var lastTs = log.length ? new Date(log[log.length - 1].data).getTime() : 0;
      if (!log.length || Date.now() - lastTs >= 2 * 24 * 60 * 60 * 1000) {
        log.push({ data: new Date().toISOString() });
        saveJSON(LOG_KEY, log);
      }
    } catch (e) {}
  }

  // ==================================================================
  //  TELA DE VENCEDOR (confete + "VOCÊ GANHOU")
  // ==================================================================
  function userOwnsFicha(n) {
    if (!currentUser) return false;
    var cel = (currentUser.celular || "").replace(/\D/g, "");
    // confere reservas
    var reservas = loadJSON(RESERVAS_KEY, {});
    var r = reservas[n];
    if (r && (r.celular || "").replace(/\D/g, "") === cel) return true;
    // confere vendas
    var financeiro = loadJSON(SOLDS_KEY, {});
    var s = financeiro[n];
    if (s && (s.celular || "").replace(/\D/g, "") === cel) return true;
    return false;
  }

  var celebrationShown = false;

  function fireConfetti() {
    var container = document.getElementById("winnerConfetti");
    if (!container) return;
    container.innerHTML = "";
    var colors = ["#fbbf24", "#f59e0b", "#4ade80", "#60a5fa", "#f87171", "#f472b6", "#a78bfa", "#fff"];
    for (var i = 0; i < 320; i++) {
      var piece = document.createElement("div");
      piece.className = "confetti-piece";
      var size = 7 + Math.random() * 8;
      piece.style.width = size + "px";
      piece.style.height = (size * (0.8 + Math.random() * 0.8)) + "px";
      piece.style.left = (Math.random() * 100) + "%";
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = (2 + Math.random() * 3) + "s";
      piece.style.animationDelay = (Math.random() * 2.5) + "s";
      piece.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
      container.appendChild(piece);
    }
  }

  function showCelebration(winnerNum) {
    if (celebrationShown) return;
    celebrationShown = true;
    document.getElementById("winnerNumText").textContent = "#" + pad(winnerNum);
    document.getElementById("winnerCelebration").classList.add("show");
    fireConfetti();
    // destaca a ficha vencedora
    var cells = grid.querySelectorAll(".ficha");
    cells.forEach(function (cell) {
      if (parseInt(cell.dataset.num, 10) === winnerNum) {
        cell.classList.add("winner-ficha-destaque");
        // rola até a ficha para o usuário ver
        setTimeout(function () { cell.scrollIntoView({ behavior: "smooth", block: "center" }); }, 800);
      }
    });
  }

  function checkForWin() {
    if (!currentUser) return;
    var winner = loadJSON(WINNER_KEY, null);
    if (winner && winner.numero) {
      var n = Number(winner.numero);
      if (userOwnsFicha(n)) {
        setTimeout(function () { showCelebration(n); }, 800);
      }
    }
  }

  document.getElementById("winnerCloseBtn").addEventListener("click", function () {
    document.getElementById("winnerCelebration").classList.remove("show");
    celebrationShown = false;
  });

  // ==================================================================
  //  AUTENTICACAO / CADASTRO (final)
  // ==================================================================
  updateGrid();
  applyVisible();
  updateAuthBar();
  recordOpen();
  checkForWin();
