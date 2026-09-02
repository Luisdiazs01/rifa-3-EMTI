// ============================================================
//  SINCRONIZACAO COM SUPABASE (TABELAS NORMALIZADAS)
//  Cada tipo de dado vai para a sua propria tabela:
//   - cadastros  <-  usuarios cadastrados no site
//   - reservas   <-  pedidos de ficha (data_reserva = horario do
//                    pedido; data_venda = horario da aprovacao)
//   - vendas     <-  vendas confirmadas pelo admin
//   - admins     <-  administradores do painel
//   - logins     <-  um registro por login feito
//  O localStorage continua sendo o cache sincrono (a interface
//  usa ele), e tudo que e gravado tambem e espelhado no banco.
// ============================================================
var SUPABASE_URL = "https://zzqyxvsxzewwcggmzsrg.supabase.co";
var SUPABASE_KEY = "sb_publishable_N01NcOg0AN1y6wALHzCpDg_7AEBiybI";
var SB_RELOAD_FLAG = "rifa_sb_reload";

// Mapa: chave do localStorage -> tabela + nome amigavel
var SB_CHAVES = {
  rifa_usuarios: { tabela: "cadastros", nome: "cadastros" },
  rifa_reservas: { tabela: "reservas",   nome: "reservas" },
  rifa_vendidas: { tabela: "vendas",     nome: "vendas" },
  rifa_admins:   { tabela: "admins",     nome: "admins" }
};

// Coluna unica de cada tabela (usada no upsert, sem apagar os outros)
var SB_UNIQUE = {
  rifa_usuarios: "celular",
  rifa_vendidas: "ficha",
  rifa_admins: "celular"
};

function sbAuthHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: "Bearer " + SUPABASE_KEY
  };
}

// Aviso visual na tela (toast) para acompanhar a sincronizacao
function sbToast(msg, tipo) {
  try {
    if (tipo === "err" && window.SB_SILENT) {
      console.error("Supabase (modo silencioso): " + msg);
      return;
    }
    var el = document.getElementById("sbToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "sbToast";
      el.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;padding:12px 20px;border-radius:12px;font:700 14px/1.4 'Segoe UI',system-ui,sans-serif;color:#fff;box-shadow:0 8px 30px rgba(0,0,0,.4);transition:opacity .3s ease;opacity:0;pointer-events:none;max-width:92vw;text-align:center;";
      document.body.appendChild(el);
    }
    el.style.background = tipo === "ok" ? "rgba(22,163,74,.95)" : "rgba(220,38,38,.95)";
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.style.opacity = "0"; }, 2500);
  } catch (e) {}
}

function sbFingerprint() {
  try {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k.indexOf("rifa_") === 0) keys.push(k + "=" + localStorage.getItem(k));
    }
    keys.sort();
    return keys.join("|");
  } catch (e) {
    return "";
  }
}

// Converte a chave do localStorage em linhas para a tabela correspondente
function sbLinhas(key, value) {
  var rows = [];
  var i, k;
  if (key === "rifa_usuarios") {
    for (k in value) {
      var u = value[k] || {};
      rows.push({
        nome: String(u.nome || ""),
        idade: (u.idade !== undefined && u.idade !== null) ? Number(u.idade) : null,
        celular: String(k),
        senha_hash: String(u.senha || ""),
        criado_em: u.criadoEm || null
      });
    }
  } else if (key === "rifa_vendidas") {
    for (k in value) {
      var s = value[k] || {};
      rows.push({
        ficha: Number(k),
        nome_comprador: String(s.nome || "").slice(0, 150),
        celular_cli: String(s.celular || ""),
        data_pagamento: s.data || null,
        vendida_em: s.data || null
      });
    }
  } else if (key === "rifa_admins") {
    for (i = 0; i < value.length; i++) {
      var a = value[i] || {};
      rows.push({
        nome: String(a.nome || ""),
        celular: String(a.celular || ""),
        senha_hash: String(a.hash || ""),
        principal: !!a.principal,
        criado_em: a.criadoEm || null
      });
    }
  }
  return rows;
}

// Converte linhas da tabela de volta para a chave do localStorage
function sbCache(key, rows) {
  var out;
  var i;
  if (key === "rifa_usuarios") {
    out = {};
    for (i = 0; i < rows.length; i++) {
      var u = rows[i];
      out[u.celular] = { nome: u.nome, idade: u.idade, senha: u.senha_hash, criadoEm: u.criado_em };
    }
  } else if (key === "rifa_reservas") {
    out = {};
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.status !== "pendente") continue;
      out[r.ficha] = { nome: r.nome_cliente, celular: r.celular_cli, data: r.data_reserva };
    }
  } else if (key === "rifa_vendidas") {
    out = {};
    for (i = 0; i < rows.length; i++) {
      var v = rows[i];
      out[v.ficha] = {
        nome: v.nome_comprador,
        celular: v.celular_cli || "",
        data: v.vendida_em || v.data_pagamento,
        aprovadoPor: v.aprovado_por ? ("Admin #" + v.aprovado_por) : "-"
      };
    }
  } else if (key === "rifa_admins") {
    out = [];
    for (i = 0; i < rows.length; i++) {
      var ad = rows[i];
      out.push({ nome: ad.nome, celular: ad.celular || "", hash: ad.senha_hash, principal: !!ad.principal, criadoEm: ad.criado_em });
    }
    out.sort(function (x, y) {
      var a = x.criadoEm ? String(x.criadoEm) : "";
      var b = y.criadoEm ? String(y.criadoEm) : "";
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }
  return out;
}

// Reconstroi uma tabela inteira a partir da chave do localStorage
// (apaga tudo e insere de volta - ideal para dados pequenos e sempre
//  consistentes com a interface).
function sbSyncKey(key, value) {
  try {
    var m = SB_CHAVES[key];
    if (!m) return Promise.resolve(true);
    var uniq = SB_UNIQUE[key];
    if (!uniq) return Promise.resolve(true);
    var rows = sbLinhas(key, value);
    if (!rows.length) return Promise.resolve(true);
    return fetch(SUPABASE_URL + "/rest/v1/" + m.tabela + "?on_conflict=" + uniq, {
      method: "POST",
      headers: Object.assign(sbAuthHeaders(), {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      }),
      body: JSON.stringify(rows),
      keepalive: true
    })
      .then(function (r) {
        if (r.status >= 200 && r.status < 300) {
          sbToast("Salvo em '" + m.nome + "' ✓", "ok");
          return true;
        }
        sbToast("Falha ao salvar em '" + m.nome + "' (HTTP " + r.status + ")", "err");
        r.text().then(function (t) { console.error("Supabase " + m.tabela + " falhou:", t); });
        return false;
      })
      .catch(function (err) {
        console.error("Supabase " + m.tabela + " erro:", err);
        return false;
      });
  } catch (e) {
    console.error("Supabase syncKey excecao:", e);
    return Promise.resolve(false);
  }
}

// Reserva: insere/atualiza o pedido pendente no banco
// (data_reserva = horario do pedido; data_venda fica NULL ate aprovacao)
function sbReservaUpsert(rows) {
  try {
    if (!rows || !rows.length) return Promise.resolve(true);
    return fetch(SUPABASE_URL + "/rest/v1/reservas?on_conflict=ficha", {
      method: "POST",
      headers: Object.assign(sbAuthHeaders(), {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      }),
      body: JSON.stringify(rows),
      keepalive: true
    })
      .then(function (r) {
        if (r.status >= 200 && r.status < 300) {
          sbToast("Reserva salva em 'reservas' ✓", "ok");
          return true;
        }
        sbToast("Falha ao salvar reserva (HTTP " + r.status + ")", "err");
        r.text().then(function (t) { console.error("Supabase reserva falhou:", t); });
        return false;
      })
      .catch(function (err) {
        console.error("Supabase reserva erro:", err);
        return false;
      });
  } catch (e) {
    console.error("Supabase reserva excecao:", e);
    return Promise.resolve(false);
  }
}

// Aprovacao da venda: marca a fila na tabela reservas como vendida
// e preenche data_venda com o horario da aprovacao.
// Se nao existia reserva (venda direta), cria o registro completo.
function sbAprovarVenda(n, nome, celular, dataReq, dataVen) {
  try {
    return fetch(SUPABASE_URL + "/rest/v1/reservas?on_conflict=ficha", {
      method: "POST",
      headers: Object.assign(sbAuthHeaders(), {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      }),
      body: JSON.stringify([{
        ficha: Number(n),
        nome_cliente: String(nome || "").slice(0, 150),
        celular_cli: String(celular || ""),
        status: "vendida",
        data_reserva: dataReq || new Date().toISOString(),
        data_venda: dataVen || new Date().toISOString()
      }]),
      keepalive: true
    })
      .then(function (r) {
        if (r.status >= 200 && r.status < 300) return true;
        sbToast("Falha ao aprovar reserva (HTTP " + r.status + ")", "err");
        r.text().then(function (t) { console.error("Supabase aprovar falhou:", t); });
        return false;
      })
      .catch(function (err) {
        console.error("Supabase aprovar erro:", err);
        return false;
      });
  } catch (e) {
    console.error("Supabase aprovar excecao:", e);
    return Promise.resolve(false);
  }
}

// Registra um login na tabela normalizada "logins" (um registro por entrada)
// tipo: 'usuario' (site) | 'admin' (painel)
function sbRegLog(tipo, identificador) {
  try {
    return fetch(SUPABASE_URL + "/rest/v1/logins", {
      method: "POST",
      headers: Object.assign(sbAuthHeaders(), {
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      }),
      body: JSON.stringify([{ tipo: tipo, identificador: String(identificador || ""), data_login: new Date().toISOString() }]),
      keepalive: true
    })
      .then(function (r) {
        if (r.status >= 200 && r.status < 300) {
          sbToast("Login registrado em 'logins' ✓", "ok");
          return true;
        }
        sbToast("Falha ao registrar login (HTTP " + r.status + ")", "err");
        r.text().then(function (t) { console.error("Supabase reglogin falhou (HTTP " + r.status + "):", t); });
        return false;
      })
      .catch(function (err) {
        console.error("Supabase reglogin erro:", err);
        return false;
      });
  } catch (e) {
    console.error("Supabase reglogin excecao:", e);
    return Promise.resolve(false);
  }
}

// Baixa as tabelas do banco e atualiza o localStorage (cache).
// Se mudou algo, recarrega a pagina uma vez por sessao.
function sbHydrate() {
  if (typeof localStorage === "undefined") {
    return Promise.resolve(false);
  }
  try {
    var chaves = Object.keys(SB_CHAVES);
    var antes = sbFingerprint();
    return Promise.all(chaves.map(function (key) {
      var m = SB_CHAVES[key];
      return fetch(SUPABASE_URL + "/rest/v1/" + m.tabela + "?select=*", {
        headers: sbAuthHeaders(),
        cache: "no-store"
      })
        .then(function (r) {
          if (!r.ok) {
            console.error("Supabase hydrate " + m.tabela + " HTTP " + r.status);
            return [];
          }
          return r.json();
        })
        .then(function (rows) {
          // Se a tabela no banco ainda esta vazia, NAO sobrescreve o
          // cache local (o local e a fonte e sera enviado no proximo
          // saveJSON). So o banco com dados vira a fonte da verdade.
          if (!rows || !rows.length) return true;
          var obj = sbCache(key, rows);
          try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
          return true;
        })
        .catch(function (err) {
          console.error("Supabase hydrate " + m.tabela + " erro:", err);
          return true;
        });
    }))
      .then(function () {
        var depois = sbFingerprint();
        try {
          if (depois !== antes && !sessionStorage.getItem(SB_RELOAD_FLAG)) {
            sessionStorage.setItem(SB_RELOAD_FLAG, "1");
            setTimeout(function () { window.location.reload(); }, 200);
          }
        } catch (e) {}
        return true;
      });
  } catch (e) {
    console.error("Supabase hydrate excecao:", e);
    return Promise.resolve(false);
  }
}