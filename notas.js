/* Anotações — app para o Safari do iOS 9 (ES5 puro).
 * Guarda tudo no iPad (WebSQL, ou localStorage em navegadores novos) e sincroniza
 * com o PC (notas.py) quando ele estiver acessível. Mesclagem igual à do servidor:
 * campos do caderno/página = o mais recente; elementos = união por id, vale o mais recente.
 */
(function () {
  'use strict';

  // ================================================================ utilidades
  function $(id) { return document.getElementById(id); }
  var ultimoU = 0;
  function agora() {               // relógio que nunca volta (também entre aparelhos)
    var t = Date.now();
    if (t <= ultimoU) t = ultimoU + 1;
    ultimoU = t;
    return t;
  }
  function verU(u) { if (u > ultimoU) ultimoU = u; }
  function novoId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function copia(o) { return JSON.parse(JSON.stringify(o)); }
  function chaves(o) { var r = []; for (var k in o) if (o.hasOwnProperty(k)) r.push(k); return r; }

  function xhr(metodo, url, corpo, tipo, cb, opcoes) {
    var x = new XMLHttpRequest();
    x.open(metodo, url, true);
    x.timeout = (opcoes && opcoes.timeout) || 15000;
    if (opcoes && opcoes.blob) x.responseType = 'blob';
    if (tipo) x.setRequestHeader('Content-Type', tipo);
    x.onload = function () {
      if (x.status >= 200 && x.status < 300) {
        if (opcoes && opcoes.blob) return cb(null, x.response);
        var r = null;
        try { r = JSON.parse(x.responseText); } catch (e) { return cb('resposta inválida'); }
        cb(null, r);
      } else {
        var msg = 'erro ' + x.status;
        try { msg = JSON.parse(x.responseText).erro || msg; } catch (e) {}
        cb(msg);
      }
    };
    x.onerror = function () { cb('sem conexão'); };
    x.ontimeout = function () { cb('sem conexão'); };
    x.send(corpo === undefined ? null : corpo);
  }

  function dataUrlParaBytes(url) {
    var bin = atob(url.split(',')[1]), n = bin.length, b = new Uint8Array(n);
    for (var i = 0; i < n; i++) b[i] = bin.charCodeAt(i);
    return b;
  }

  var timerAviso = null;
  function aviso(txt, ms) {
    var a = $('aviso');
    a.textContent = txt; a.hidden = false;
    clearTimeout(timerAviso);
    timerAviso = setTimeout(function () { a.hidden = true; }, ms || 2500);
  }

  // modal simples (iOS 9: confirm/prompt funcionam, mas um modal fica melhor para links)
  function modal(texto, acoes) {
    $('modal-texto').textContent = texto;
    var box = $('modal-acoes'); box.innerHTML = '';
    acoes.forEach(function (a) {
      var el = document.createElement(a.href ? 'a' : 'button');
      el.className = 'botao' + (a.primario ? ' primario' : '');
      el.textContent = a.texto;
      if (a.href) { el.href = a.href; el.target = '_blank'; }
      el.onclick = function () { $('modal').hidden = true; if (a.acao) a.acao(); };
      box.appendChild(el);
    });
    $('modal').hidden = false;
  }

  // ================================================================ mesclagem (igual ao servidor)
  function mesclar(a, b) {
    if (!a) return b;
    if (!b) return a;
    var base = copia((a.u || 0) >= (b.u || 0) ? a : b);
    if (a.tipo === 'p' || b.tipo === 'p') {
      var els = copia(a.els || {}), be = b.els || {};
      for (var k in be) if (be.hasOwnProperty(k)) {
        if (!els[k] || (be[k].u || 0) > (els[k].u || 0)) els[k] = be[k];
      }
      base.els = els;
    }
    delete base._s;
    return base;
  }

  // ================================================================ armazenamento no aparelho
  // Tabelas: e = entidades (JSON), s = pendentes de envio, a = imagens (dataURL),
  //          as = imagens pendentes, m = metadados.
  var Arm = {
    tipo: 'ls', db: null,
    iniciar: function (cb) {
      if (window.openDatabase) {
        try {
          Arm.db = window.openDatabase('anotacoes', '1.0', 'Anotações', 5 * 1024 * 1024);
          Arm.db.transaction(function (tx) {
            tx.executeSql('CREATE TABLE IF NOT EXISTS kv (t TEXT, id TEXT, v TEXT, PRIMARY KEY (t, id))');
          }, function () { Arm.tipo = 'ls'; cb(); }, function () { Arm.tipo = 'sql'; cb(); });
          return;
        } catch (e) { /* cai no localStorage */ }
      }
      Arm.tipo = 'ls'; cb();
    },
    gravar: function (t, id, v, cb) {
      cb = cb || function () {};
      if (Arm.tipo === 'sql') {
        Arm.db.transaction(function (tx) {
          tx.executeSql('INSERT OR REPLACE INTO kv (t, id, v) VALUES (?, ?, ?)', [t, id, v]);
        }, function (e) { cb(e || 'erro'); }, function () { cb(null); });
      } else {
        try { localStorage.setItem('an|' + t + '|' + id, v); cb(null); } catch (e) { cb(e); }
      }
    },
    apagar: function (t, id, cb) {
      cb = cb || function () {};
      if (Arm.tipo === 'sql') {
        Arm.db.transaction(function (tx) {
          tx.executeSql('DELETE FROM kv WHERE t = ? AND id = ?', [t, id]);
        }, function () { cb(); }, function () { cb(); });
      } else {
        try { localStorage.removeItem('an|' + t + '|' + id); } catch (e) {}
        cb();
      }
    },
    ler: function (t, id, cb) {
      if (Arm.tipo === 'sql') {
        var v = null;
        Arm.db.readTransaction(function (tx) {
          tx.executeSql('SELECT v FROM kv WHERE t = ? AND id = ?', [t, id], function (tx2, r) {
            if (r.rows.length) v = r.rows.item(0).v;
          });
        }, function () { cb(null); }, function () { cb(v); });
      } else {
        var s = null;
        try { s = localStorage.getItem('an|' + t + '|' + id); } catch (e) {}
        cb(s);
      }
    },
    todos: function (t, cb) {
      var lista = [];
      if (Arm.tipo === 'sql') {
        Arm.db.readTransaction(function (tx) {
          tx.executeSql('SELECT id, v FROM kv WHERE t = ?', [t], function (tx2, r) {
            for (var i = 0; i < r.rows.length; i++) lista.push({ id: r.rows.item(i).id, v: r.rows.item(i).v });
          });
        }, function () { cb([]); }, function () { cb(lista); });
      } else {
        var pre = 'an|' + t + '|';
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.indexOf(pre) === 0) lista.push({ id: k.slice(pre.length), v: localStorage.getItem(k) });
          }
        } catch (e) {}
        cb(lista);
      }
    }
  };

  // ================================================================ dados em memória
  var D = {
    ents: {},        // id -> caderno/página
    pend: {},        // id -> true: alterado aqui, falta enviar ao PC
    versao: {},      // id -> contador local de alterações (para não perder edição feita durante o envio)
    assetsPend: {},  // id da imagem -> true
    desde: 0,
    agendados: {}, timerGravar: null,
    erroGravar: false
  };

  function carregar(cb) {
    Arm.todos('e', function (es) {
      es.forEach(function (r) {
        try { var e = JSON.parse(r.v); D.ents[e.id] = e; observarU(e); } catch (x) {}
      });
      Arm.todos('s', function (ps) {
        ps.forEach(function (r) { D.pend[r.id] = true; });
        Arm.todos('as', function (as) {
          as.forEach(function (r) { D.assetsPend[r.id] = true; });
          Arm.ler('m', 'desde', function (v) {
            D.desde = parseInt(v || '0', 10) || 0;
            Arm.todos('fs', function (fs) {
              fs.forEach(function (r) { Sala.pend[r.id] = true; });
              Arm.todos('fa', function (fa) { fa.forEach(function (r) { Sala.assetsOk[r.id] = true; }); cb(); });
            });
          });
        });
      });
    });
  }

  function observarU(e) {
    verU(e.u || 0);
    if (e.els) for (var k in e.els) if (e.els.hasOwnProperty(k)) verU(e.els[k].u || 0);
  }

  // marca a entidade como alterada e agenda a gravação no aparelho
  function alterado(e) {
    D.ents[e.id] = e;
    D.pend[e.id] = true;
    D.versao[e.id] = (D.versao[e.id] || 0) + 1;
    agendarGravar(e.id, true);
    Sala.marcar(e);
    atualizarStatus();
  }
  function agendarGravar(id, pendente) {
    D.agendados[id] = D.agendados[id] || pendente;
    clearTimeout(D.timerGravar);
    D.timerGravar = setTimeout(gravarAgendados, 300);
  }
  function gravarAgendados() {
    var ids = chaves(D.agendados);
    var pend = D.agendados; D.agendados = {};
    ids.forEach(function (id) {
      var e = D.ents[id];
      if (!e) return;
      Arm.gravar('e', id, JSON.stringify(e), function (err) {
        if (err && !D.erroGravar) {
          D.erroGravar = true;
          modal('O iPad não deixou guardar mais anotações (espaço do Safari cheio). ' +
                'Abra o app com o PC ligado para sincronizar; as alterações continuam aqui enquanto o app estiver aberto.',
                [{ texto: 'Entendi', primario: true }]);
        }
      });
      if (pend[id]) Arm.gravar('s', id, '1');
    });
  }
  window.addEventListener('pagehide', gravarAgendados);

  function cadernos() {
    var r = [];
    for (var id in D.ents) if (D.ents.hasOwnProperty(id)) {
      var e = D.ents[id];
      if (e.tipo === 'c' && !e.d && !e.lix) r.push(e);
    }
    return r.sort(function (a, b) { return (b.u || 0) - (a.u || 0); });
  }
  function paginasDe(cid) {
    var r = [];
    for (var id in D.ents) if (D.ents.hasOwnProperty(id)) {
      var e = D.ents[id];
      if (e.tipo === 'p' && e.c === cid && !e.d && !e.lix) r.push(e);
    }
    return r.sort(function (a, b) { return (a.ord - b.ord) || (a.id < b.id ? -1 : 1); });
  }
  // folha deitada (padrão: o iPad fica na horizontal) ou em pé
  function novaPagina(cid, ord, fundo, emPe) {
    var u = agora();
    var p = { id: novoId(), tipo: 'p', c: cid, ord: ord, w: emPe ? 1000 : 1414, h: emPe ? 1414 : 1000, fundo: fundo || 'pautado',
              pdf: null, u: u, d: 0, els: {} };
    alterado(p);
    return p;
  }

  // ================================================================ imagens (assets)
  var imgs = {}, carregando = {}, falhou = {};
  function obterImagem(id, cb, temporaria) {
    if (imgs[id]) return cb(imgs[id]);
    var chave = temporaria ? id + '#t' : id;
    if (carregando[chave]) { carregando[chave].push(cb); return; }
    if (falhou[id] && Date.now() - falhou[id] < 10000) return temporaria && cb(null);
    carregando[chave] = [cb];
    function pronto(url) {
      var im = new Image();
      im.onload = function () { if (!temporaria) imgs[id] = im; var l = carregando[chave]; delete carregando[chave]; l.forEach(function (f) { f(im); }); };
      im.onerror = function () { var l = carregando[chave]; delete carregando[chave]; if (temporaria) l.forEach(function (f) { f(null); }); };
      im.src = url;
    }
    Arm.ler('a', id, function (url) {
      if (url) return pronto(url);
      function semImagem() { var l = carregando[chave]; delete carregando[chave]; falhou[id] = Date.now(); if (temporaria) l.forEach(function (f) { f(null); }); }
      function doFirebase() { Sala.baixarImagem(id, pronto, semImagem); }
      if (Sync.semPC) return doFirebase();
      xhr('GET', '/api/asset/' + id, undefined, null, function (err, blob) {
        if (err) return doFirebase();
        var fr = new FileReader();
        fr.onload = function () { Arm.gravar('a', id, fr.result); pronto(fr.result); };
        fr.readAsDataURL(blob);
      }, { blob: true, timeout: 30000 });
    });
  }
  function guardarImagem(id, dataUrl) {
    Arm.gravar('a', id, dataUrl);
    Arm.gravar('as', id, '1');
    D.assetsPend[id] = true;
  }

  // ================================================================ sincronização
  // semPC: o app foi aberto de um endereço sem o servidor do PC (ex.: GitHub Pages)
  var Sync = { ocupado: false, online: null, timer: null, semPC: false };
  function erroDeSemPC(err) { return err === 'resposta inválida' || /^erro (404|405|501)$/.test(err || ''); }

  function atualizarStatus() {
    var n = chaves(D.pend).length + chaves(D.assetsPend).length;
    var txt, cls, ns = chaves(Sala.pend).length;
    if (Sync.semPC) {
      if (ns || Sala.enviando) { txt = Sala.online === false ? ns + ' alteraç' + (ns > 1 ? 'ões' : 'ão') + ' esperando internet' : 'Enviando…'; cls = 'pendente'; }
      else if (Sala.online === false) { txt = 'Sem internet'; cls = 'offline'; }
      else { txt = 'Salvo neste aparelho' + (Sala.online ? ' e na sala' : ''); cls = 'ok'; }
    } else if (Sync.online === false) {
      txt = n ? n + ' alteraç' + (n > 1 ? 'ões' : 'ão') + ' só no iPad (PC desligado)' : 'Sem conexão com o PC';
      cls = n ? 'pendente' : 'offline';
    } else if (n) { txt = 'Sincronizando…'; cls = 'pendente'; }
    else { txt = Sync.online ? 'Sincronizado' : 'Conectando…'; cls = Sync.online ? 'ok' : 'offline'; }
    ['status-b', 'status-e'].forEach(function (id) { var s = $(id); s.textContent = txt; s.className = 'status ' + cls; });
  }

  function sincronizar(cb) {
    cb = cb || function () {};
    if (Sync.semPC) return cb('sem PC');
    if (Sync.ocupado) return cb('ocupado');
    Sync.ocupado = true;
    enviarAssets(chaves(D.assetsPend), function (errA) {
      if (errA) return fim(errA);
      var ids = chaves(D.pend), versoes = {}, itens = [];
      ids.forEach(function (id) { if (D.ents[id]) { itens.push(D.ents[id]); versoes[id] = D.versao[id] || 0; } });
      var corpo = JSON.stringify({ desde: D.desde, itens: itens });
      xhr('POST', '/api/sync', corpo, 'application/json', function (err, r) {
        if (err) return fim(err);
        ids.forEach(function (id) {   // só marca como enviado se não mudou durante o envio
          if ((D.versao[id] || 0) === versoes[id]) { delete D.pend[id]; Arm.apagar('s', id); }
        });
        var mudouAberto = false;
        (r.itens || []).forEach(function (rec) {
          delete rec._s;
          observarU(rec);
          var final = mesclar(D.ents[rec.id], rec);
          D.ents[rec.id] = final;
          agendarGravar(rec.id, !!D.pend[rec.id]);
          if (E.pagina && (rec.id === E.pagina.id || rec.c === E.cad.id || rec.id === E.cad.id)) mudouAberto = true;
        });
        D.desde = r.seq || D.desde;
        Arm.gravar('m', 'desde', String(D.desde));
        fim(null, mudouAberto, (r.itens || []).length);
      }, { timeout: 60000 });
    });
    function fim(err, mudouAberto, recebidos) {
      Sync.ocupado = false;
      if (err && erroDeSemPC(err)) { Sync.semPC = true; D.pend = {}; D.assetsPend = {}; }
      Sync.online = !err;
      atualizarStatus();
      if (!err && recebidos) {
        if (telaAtual === 'biblioteca') mostrarBiblioteca();
        else if (telaAtual === 'lixeira') Lixeira.mostrar();
        else if (mudouAberto) Editor.recarregarDoServidor();
      }
      cb(err);
    }
  }

  function enviarAssets(ids, cb) {
    if (!ids.length) return cb(null);
    var id = ids.shift();
    Arm.ler('a', id, function (url) {
      if (!url) { delete D.assetsPend[id]; Arm.apagar('as', id); return enviarAssets(ids, cb); }
      xhr('POST', '/api/asset?id=' + encodeURIComponent(id), dataUrlParaBytes(url), 'image/jpeg', function (err) {
        if (err) return cb(err);
        delete D.assetsPend[id]; Arm.apagar('as', id);
        enviarAssets(ids, cb);
      }, { timeout: 60000 });
    });
  }

  function cicloSync() {
    clearTimeout(Sync.timer);
    if (Sync.semPC) return;
    var temPend = chaves(D.pend).length || chaves(D.assetsPend).length;
    if (Editor.ocupado()) { Sync.timer = setTimeout(cicloSync, 1500); return; }
    if (Editor.recarregarDepois && telaAtual === 'editor') Editor.recarregarDoServidor();
    sincronizar(function () {
      Sync.timer = setTimeout(cicloSync, temPend ? 4000 : (Sync.online ? 10000 : 15000));
    });
  }

  // ================================================================ salas compartilhadas (Firebase)
  // Caderno compartilhado = caderno com o campo "sala" (código de 6 letras/números).
  // No Firebase (tudo dentro de "salas", que é o que as regras liberam):
  //   salas/<código>/c              dados do caderno (nome, u)
  //   salas/<código>/p/<página>     página sem os elementos
  //   salas/<código>/e/<pág>/<el>   cada traço/texto/imagem (mesclagem por elemento, vale o "u" maior)
  //   salas/<código>/pessoas/<uid>  quem está com o caderno aberto
  //   salas/<código>_a/<id>         imagens (fundo de PDF, fotos) — fora do caminho ao vivo
  //   salas/<código>_f/<id>         PDFs que o iPad antigo pede para um colega converter
  // Funciona por Wi-Fi ou dados móveis. O PC continua opcional (cópia, slides, PDF).
  var FB = { chave: 'AIzaSyAw-Wt1ITwJIlV6DHgs1FbZdZmabuyfsqA', url: 'https://lousa-4f648-default-rtdb.firebaseio.com' };
  var PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/';
  var MODERNO = (function () { try { new Function('var f = (x) => x;'); return true; } catch (e) { return false; } })();
  function lsLer(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsGravar(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var Sala = {
    token: null, uid: null, entrando: null, timerToken: null,
    R: {},              // espelho do Firebase: R[código] = {c, p, e, pessoas}
    carregado: {},      // código -> já recebeu o estado inicial
    aoCarregar: {},     // código -> funções a chamar quando carregar
    pend: {},           // id da entidade -> falta enviar
    assetsOk: {},       // imagens que já estão no Firebase
    fonte: null, filaFonte: null, aberto: null, timer: null, timerReconectar: null, timerPresenca: null,
    enviando: false, online: null, desvio: 0, nome: lsLer('an-nome') || ''
  };

  Sala.entrar = function (cb) {
    if (Sala.token) return cb(null);
    if (Sala.entrando) return Sala.entrando.push(cb);
    Sala.entrando = [cb];
    function fim(err) { var l = Sala.entrando; Sala.entrando = null; l.forEach(function (f) { f(err); }); }
    function guardar(t, u, rf) {
      Sala.token = t; Sala.uid = u; lsGravar('an-fb-refresh', rf);
      clearTimeout(Sala.timerToken);
      Sala.timerToken = setTimeout(function () {   // o token vale 1 h
        Sala.token = null;
        Sala.entrar(function (e) { if (!e && Sala.aberto) Sala.conectar(Sala.aberto); });
      }, 50 * 60000);
    }
    function novo() {
      xhr('POST', 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + FB.chave,
          JSON.stringify({ returnSecureToken: true }), 'application/json', function (err, r) {
        if (err || !r || !r.idToken) return fim(err || 'sem token');
        guardar(r.idToken, r.localId, r.refreshToken); fim(null);
      });
    }
    var refresh = lsLer('an-fb-refresh');
    if (!refresh) return novo();
    xhr('POST', 'https://securetoken.googleapis.com/v1/token?key=' + FB.chave,
        'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refresh), 'application/x-www-form-urlencoded', function (err, r) {
      if (err === 'sem conexão') return fim(err);
      if (err || !r || !r.id_token) return novo();
      guardar(r.id_token, r.user_id, r.refresh_token); fim(null);
    });
  };

  // requisição ao banco (tenta de novo uma vez com token novo)
  Sala.req = function (metodo, caminho, obj, cb, tempo, segunda) {
    Sala.entrar(function (err) {
      if (err) return cb(err);
      xhr(metodo, FB.url + '/' + caminho + '.json?auth=' + encodeURIComponent(Sala.token),
          obj === undefined ? undefined : JSON.stringify(obj), obj === undefined ? null : 'application/json', function (e2, r) {
        if (e2 === 'erro 401' && !segunda) { Sala.token = null; return Sala.req(metodo, caminho, obj, cb, tempo, true); }
        cb(e2, r);
      }, { timeout: tempo || 20000 });
    });
  };

  function codigoDe(e) {
    if (!e) return null;
    if (e.tipo === 'c') return e.sala || null;
    var c = D.ents[e.c];
    return (c && c.sala) || null;
  }
  function metaCaderno(c) { return { id: c.id, tipo: 'c', nome: c.nome || '', u: c.u || 0 }; }
  function metaPagina(p) { var m = {}; for (var k in p) if (p.hasOwnProperty(k) && k !== 'els') m[k] = p[k]; return m; }
  function assetsDe(p) {
    var r = []; if (p.pdf) r.push(p.pdf);
    for (var k in p.els) if (p.els.hasOwnProperty(k) && p.els[k].k === 'img' && !p.els[k].d && p.els[k].a) r.push(p.els[k].a);
    return r;
  }
  // em que sala está uma imagem (para baixar do lugar certo)
  function codigoDoAsset(id) {
    for (var k in D.ents) if (D.ents.hasOwnProperty(k)) {
      var p = D.ents[k];
      if (p.tipo === 'p' && assetsDe(p).indexOf(id) >= 0) { var cod = codigoDe(p); if (cod) return cod; }
    }
    return null;
  }
  // guarda localmente o que veio de fora (e manda ao PC, se houver PC)
  function recebido(id) {
    if (!Sync.semPC) { D.pend[id] = true; agendarGravar(id, true); }
    else agendarGravar(id, false);
  }

  // ---------- envio
  Sala.marcar = function (e) {
    if (!codigoDe(e)) return;
    Sala.pend[e.id] = true; Arm.gravar('fs', e.id, '1');
    Sala.agendar(400);
  };
  Sala.agendar = function (ms) { clearTimeout(Sala.timer); Sala.timer = setTimeout(Sala.enviar, ms); };
  Sala.enviar = function () {
    if (Sala.enviando) return Sala.agendar(1000);
    var ids = chaves(Sala.pend);
    if (!ids.length) return;
    Sala.enviando = true; atualizarStatus();
    ids.sort(function (a, b) {   // o caderno antes das páginas
      var ea = D.ents[a], eb = D.ents[b];
      return ((ea && ea.tipo === 'c') ? 0 : 1) - ((eb && eb.tipo === 'c') ? 0 : 1);
    });
    (function proximo(i) {
      if (i >= ids.length) {
        Sala.enviando = false; Sala.online = true; atualizarStatus();
        if (chaves(Sala.pend).length) Sala.agendar(300);
        return;
      }
      var id = ids[i], e = D.ents[id], cod = codigoDe(e);
      if (!e || !cod) { delete Sala.pend[id]; Arm.apagar('fs', id); return proximo(i + 1); }
      var versao = D.versao[id] || 0;
      Sala.enviarEnt(e, cod, function (err) {
        if (err) { Sala.enviando = false; Sala.online = false; atualizarStatus(); return Sala.agendar(8000); }
        if ((D.versao[id] || 0) === versao) { delete Sala.pend[id]; Arm.apagar('fs', id); }
        proximo(i + 1);
      });
    })(0);
  };
  Sala.enviarEnt = function (e, cod, cb) {
    var R = Sala.R[cod] || {}, up = {}, k;
    if (e.tipo === 'c') up.c = metaCaderno(e);
    else {
      up['p/' + e.id] = metaPagina(e);
      var rem = (R.e && R.e[e.id]) || {}, conhecido = Sala.carregado[cod];
      for (k in e.els) if (e.els.hasOwnProperty(k)) {
        var el = e.els[k];
        if (!conhecido || !rem[k] || (rem[k].u || 0) < (el.u || 0)) up['e/' + e.id + '/' + k] = el;
      }
    }
    Sala.enviarImagens(e.tipo === 'p' ? assetsDe(e) : [], cod, function (err) {
      if (err) return cb(err);
      Sala.req('PATCH', 'salas/' + cod, up, cb, 90000);
    });
  };
  Sala.enviarImagens = function (ids, cod, cb) {
    ids = ids.filter(function (id) { return !Sala.assetsOk[id]; });
    (function proxima(i) {
      if (i >= ids.length) return cb(null);
      var id = ids[i];
      Arm.ler('a', id, function (url) {
        if (url) return subir(url);
        // ainda não está aqui: tenta trazer do PC (iPad aberto pelo PC)
        if (Sync.semPC) return proxima(i + 1);
        obterImagem(id, function () { Arm.ler('a', id, function (u2) { if (u2) subir(u2); else proxima(i + 1); }); }, true);
      });
      function subir(url) {
        Sala.req('PUT', 'salas/' + cod + '_a/' + id, url, function (err) {
          if (err) return cb(err);
          Sala.assetsOk[id] = true; Arm.gravar('fa', id, '1');
          proxima(i + 1);
        }, 180000);
      }
    })(0);
  };
  Sala.baixarImagem = function (id, ok, falha) {
    var cod = codigoDoAsset(id);
    if (!cod) return falha();
    Sala.req('GET', 'salas/' + cod + '_a/' + id, undefined, function (err, url) {
      if (err || typeof url !== 'string') return falha();
      Arm.gravar('a', id, url); Sala.assetsOk[id] = true;
      ok(url);
    }, 120000);
  };

  // ---------- recebimento ao vivo (só do caderno aberto)
  function definirEm(raiz, partes, valor) {
    var alvo = raiz;
    for (var i = 0; i < partes.length - 1; i++) {
      if (!alvo[partes[i]] || typeof alvo[partes[i]] !== 'object') alvo[partes[i]] = {};
      alvo = alvo[partes[i]];
    }
    if (valor === null) delete alvo[partes[partes.length - 1]];
    else alvo[partes[partes.length - 1]] = valor;
  }
  Sala.conectar = function (cod) {
    Sala.fechar(true);
    Sala.aberto = cod;
    Sala.entrar(function (err) {
      if (Sala.aberto !== cod) return;
      if (err) {
        Sala.online = false; atualizarStatus();
        Sala.timerReconectar = setTimeout(function () { if (Sala.aberto === cod) Sala.conectar(cod); }, 10000);
        return;
      }
      var f = new EventSource(FB.url + '/salas/' + cod + '.json?auth=' + encodeURIComponent(Sala.token));
      Sala.fonte = f;
      function tratar(ev, patch) {
        if (Sala.fonte !== f) return;
        var d; try { d = JSON.parse(ev.data); } catch (x) { return; }
        if (!d) return;
        Sala.online = true;
        Sala.receber(cod, d.path, d.data, patch);
      }
      f.addEventListener('put', function (ev) { tratar(ev, false); }, false);
      f.addEventListener('patch', function (ev) { tratar(ev, true); }, false);
      f.addEventListener('auth_revoked', function () { f.close(); Sala.token = null; if (Sala.aberto === cod) Sala.conectar(cod); }, false);
      f.addEventListener('cancel', function () { f.close(); aviso('Sem permissão para esta sala.', 4000); }, false);
      f.onerror = function () {
        if (Sala.fonte !== f) return;
        Sala.online = false; atualizarStatus();
        if (f.readyState === 2) {   // fechou de vez (ex.: token vencido): reconecta
          Sala.token = null;
          Sala.timerReconectar = setTimeout(function () { if (Sala.aberto === cod) Sala.conectar(cod); }, 5000);
        }
      };
      Sala.presenca(cod);
      clearInterval(Sala.timerPresenca);
      Sala.timerPresenca = setInterval(function () { Sala.presenca(cod); }, 20000);
      if (MODERNO) Sala.ouvirFila(cod);
    });
  };
  Sala.fechar = function (manter) {
    if (Sala.fonte) { Sala.fonte.close(); Sala.fonte = null; }
    if (Sala.filaFonte) { Sala.filaFonte.close(); Sala.filaFonte = null; }
    clearInterval(Sala.timerPresenca); clearTimeout(Sala.timerReconectar);
    if (!manter && Sala.aberto && Sala.uid) Sala.req('DELETE', 'salas/' + Sala.aberto + '/pessoas/' + Sala.uid, undefined, function () {});
    if (!manter) Sala.aberto = null;
  };
  Sala.receber = function (cod, caminho, dados, patch) {
    var partes = caminho.split('/').filter(function (x) { return x; }), k;
    if (!partes.length && !patch) Sala.R[cod] = dados || {};
    else {
      var R = Sala.R[cod] || (Sala.R[cod] = {});
      if (patch) { for (k in dados) if (dados.hasOwnProperty(k)) definirEm(R, partes.concat(k.split('/')), dados[k]); }
      else definirEm(R, partes, dados);
    }
    var R2 = Sala.R[cod], tocadas = {}, cad = false, todas = false;
    function marcar(p) {
      if (!p.length) { todas = true; return; }
      if (p[0] === 'c') cad = true;
      else if (p[0] === 'p' || p[0] === 'e') { if (p.length > 1) tocadas[p[1]] = true; else todas = true; }
    }
    if (patch) { for (k in dados) if (dados.hasOwnProperty(k)) marcar(partes.concat(k.split('/'))); }
    else marcar(partes);
    if (todas) { cad = true; for (k in (R2.p || {})) if (R2.p.hasOwnProperty(k)) tocadas[k] = true; }
    var mudou = false;
    if (cad && R2.c) mudou = Sala.aplicarCaderno(cod, R2.c) || mudou;
    for (k in tocadas) if (tocadas.hasOwnProperty(k)) mudou = Sala.aplicarPagina(cod, k) || mudou;
    if (!Sala.carregado[cod]) {
      Sala.carregado[cod] = true;
      var l = Sala.aoCarregar[cod] || []; delete Sala.aoCarregar[cod];
      l.forEach(function (fn) { fn(); });
      if (chaves(Sala.pend).length) Sala.agendar(100);
    }
    if (mudou && telaAtual === 'editor' && E.cad && E.cad.sala === cod) Editor.recarregarDoServidor();
    Sala.atualizarBotao(); atualizarStatus();
  };
  Sala.aplicarCaderno = function (cod, rc) {
    var c = D.ents[rc.id];
    if (!c || (rc.u || 0) <= (c.u || 0)) return false;
    var n = copia(c); n.nome = rc.nome; n.u = rc.u; n.sala = cod; verU(rc.u);
    D.ents[n.id] = n; recebido(n.id);
    if (E.cad && E.cad.id === n.id) E.cad = n;
    return true;
  };
  Sala.aplicarPagina = function (cod, pid) {
    var R = Sala.R[cod], rp = R.p && R.p[pid];
    if (!rp) return false;
    var remoto = copia(rp); remoto.els = copia((R.e && R.e[pid]) || {});
    var local = D.ents[pid], final = mesclar(local, remoto);
    if (local && JSON.stringify(final) === JSON.stringify(local)) return false;
    observarU(remoto);
    D.ents[pid] = final; recebido(pid);
    return true;
  };
  // aplica alterações que chegaram enquanto a pessoa desenhava
  setInterval(function () {
    if (Editor.recarregarDepois && telaAtual === 'editor' && !Editor.ocupado()) Editor.recarregarDoServidor();
  }, 600);

  // ---------- presença
  Sala.presenca = function (cod) {
    var antes = Date.now();
    Sala.req('PUT', 'salas/' + cod + '/pessoas/' + Sala.uid, { n: Sala.nome || 'Sem nome', v: { '.sv': 'timestamp' } }, function (err, r) {
      if (!err && r && typeof r.v === 'number') Sala.desvio = r.v - (antes + Date.now()) / 2;
      Sala.atualizarBotao();
    });
  };
  Sala.pessoas = function (cod) {
    var R = Sala.R[cod] || {}, ps = R.pessoas || {}, agora2 = Date.now() + Sala.desvio, r = [];
    for (var id in ps) if (ps.hasOwnProperty(id) && ps[id] && agora2 - (ps[id].v || 0) < 60000) r.push({ id: id, n: ps[id].n || 'Sem nome' });
    return r;
  };
  Sala.atualizarBotao = function () {
    var b = $('e-sala');
    if (!b) return;
    var cod = E.cad && E.cad.sala;
    if (telaAtual !== 'editor' || !cod) { b.hidden = true; $('dica').style.display = ''; return; }
    $('dica').style.display = 'none';   // no lugar da dica, para caber no iPad
    var n = Math.max(1, Sala.pessoas(cod).length);
    b.hidden = false;
    b.textContent = cod + ' · ' + n;   // curto para caber no iPad; tocar mostra os detalhes
    b.title = 'Sala ' + cod + ': ' + n + (n === 1 ? ' pessoa' : ' pessoas') + ' agora';
  };
  setInterval(Sala.atualizarBotao, 15000);

  // ---------- compartilhar / entrar
  Sala.pedirNome = function () {
    if (Sala.nome) return true;
    var n = prompt('Seu nome (aparece para quem estuda com você):', '');
    if (!n || !n.replace(/\s/g, '')) return false;
    Sala.nome = n.replace(/^\s+|\s+$/g, '').slice(0, 20); lsGravar('an-nome', Sala.nome);
    return true;
  };
  function gerarCodigo() {
    var letras = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 6; i++) s += letras.charAt(Math.floor(Math.random() * letras.length));
    return s;
  }
  function linkDaSala(cod) {
    if (location.protocol !== 'https:') return '';
    return location.protocol + '//' + location.host + location.pathname + '?sala=' + cod;
  }
  Sala.mostrarCodigo = function (c) {
    var cod = c.sala, link = linkDaSala(cod), ps = Sala.pessoas(cod);
    var txt = 'Caderno "' + (c.nome || 'Sem nome') + '" compartilhado.\n\nCódigo da sala: ' + cod +
      '\n\nSeus amigos abrem o app, tocam em "Entrar em sala" e digitam o código' +
      (link ? ' — ou abrem este link:\n' + link : ' (use o endereço do app no GitHub, que funciona fora de casa).') +
      (ps.length ? '\n\nNa sala agora: ' + ps.map(function (p) { return p.n + (p.id === Sala.uid ? ' (você)' : ''); }).join(', ') : '');
    var acoes = [];
    if (link && navigator.share) acoes.push({ texto: 'Enviar convite', primario: true, acao: function () {
      navigator.share({ title: c.nome || 'Caderno', text: 'Estude comigo! Código da sala: ' + cod, url: link }).then(function () {}, function () {});
    } });
    acoes.push({ texto: 'Fechar', primario: !acoes.length });
    modal(txt, acoes);
  };
  Sala.compartilhar = function (c) {
    if (c.sala) return Sala.mostrarCodigo(c);
    if (!Sala.pedirNome()) return;
    var cod = gerarCodigo();
    aviso('Criando a sala…', 30000);
    Sala.req('GET', 'salas/' + cod + '/c', undefined, function (err, r) {
      if (err) return aviso(err === 'sem conexão' ? 'Para compartilhar, o aparelho precisa de internet.' : 'Não deu para criar a sala: ' + err, 4500);
      if (r) return Sala.compartilhar(c);   // código já usado: sorteia outro
      var n = copia(D.ents[c.id] || c); n.sala = cod; n.u = agora(); alterado(n);
      for (var id in D.ents) if (D.ents.hasOwnProperty(id)) {
        var p = D.ents[id];
        if (p.tipo === 'p' && p.c === n.id && !p.d) Sala.marcar(p);
      }
      Sala.carregado[cod] = false;
      $('aviso').hidden = true;
      Sala.mostrarCodigo(n);
      if (telaAtual === 'biblioteca') mostrarBiblioteca();
      if (telaAtual === 'editor' && E.cad && E.cad.id === n.id) { E.cad = n; Sala.conectar(cod); }
    });
  };
  Sala.entrarComCodigo = function (sugestao) {
    var cod = prompt('Código da sala (6 letras/números):', sugestao || '');
    if (!cod) return;
    cod = cod.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cod.length !== 6) return aviso('O código tem 6 letras/números.', 3000);
    if (!Sala.pedirNome()) return;
    var ja = cadernos().filter(function (c) { return c.sala === cod; })[0];
    if (ja) return Editor.abrir(ja);
    aviso('Procurando a sala ' + cod + '…', 30000);
    Sala.req('GET', 'salas/' + cod + '/c', undefined, function (err, rc) {
      if (err) return aviso(err === 'sem conexão' ? 'Sem internet.' : 'Não deu para entrar: ' + err, 4500);
      if (!rc || !rc.id) return aviso('A sala ' + cod + ' não existe. Confira o código.', 4500);
      var c = D.ents[rc.id] ? copia(D.ents[rc.id]) : { id: rc.id, tipo: 'c', d: 0 };
      c.nome = rc.nome; c.u = Math.max(c.u || 0, rc.u || 0); c.sala = cod; c.lix = 0; c.d = 0; verU(c.u);
      D.ents[c.id] = c; recebido(c.id);
      aviso('Baixando o caderno…', 120000);
      Sala.aoCarregar[cod] = [function () { $('aviso').hidden = true; Editor.abrir(D.ents[c.id]); }];
      Sala.carregado[cod] = false;
      Sala.conectar(cod);
    });
  };

  // ---------- PDF sem o PC
  // Navegador moderno (Android, PC): o próprio aparelho converte com o pdf.js.
  // iPad antigo num caderno compartilhado: manda o PDF para a fila da sala e um colega
  // com o caderno aberto num aparelho moderno converte; as páginas chegam sozinhas.
  var pdfjsEsperando = null;
  function carregarPdfjs(cb) {
    if (window.pdfjsLib) return cb(null);
    if (pdfjsEsperando) return pdfjsEsperando.push(cb);
    pdfjsEsperando = [cb];
    var s = document.createElement('script');
    s.src = PDFJS + 'pdf.min.js';
    s.onload = function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
      var l = pdfjsEsperando; pdfjsEsperando = null; l.forEach(function (f) { f(null); });
    };
    s.onerror = function () { var l = pdfjsEsperando; pdfjsEsperando = null; l.forEach(function (f) { f('sem leitor de PDF'); }); };
    document.getElementsByTagName('head')[0].appendChild(s);
  }
  // cria as páginas (igual ao que o PC faz em notas.py: importar)
  function criarPaginasDeImagens(jpgs, destino, nome) {
    var u = agora(), cad, apos, ate = null, n = jpgs.length, primeira = null;
    if (destino) { cad = D.ents[destino.caderno]; apos = destino.apos || 0; ate = destino.ate; }
    else { cad = { id: novoId(), tipo: 'c', nome: nome || 'Importado', u: u, d: 0 }; if (Bib.pasta) cad.pasta = Bib.pasta; alterado(cad); apos = 0; }
    jpgs.forEach(function (j, i) {
      var aid = novoId();
      guardarImagem(aid, j.url);
      var w = j.w > j.h ? 1414 : 1000;
      var ordem = ate === null || ate === undefined ? apos + (i + 1) : apos + (ate - apos) * (i + 1) / (n + 1);
      var p = { id: novoId(), tipo: 'p', c: cad.id, ord: ordem, w: w, h: Math.round(w * j.h / j.w), fundo: 'liso',
                pdf: aid, u: agora(), d: 0, els: {} };
      primeira = primeira || p.id;
      alterado(p);
    });
    return { caderno: cad.id, paginas: n, primeira: primeira };
  }
  function pdfParaImagens(dados, progresso, cb) {
    carregarPdfjs(function (err) {
      if (err) return cb(err);
      window.pdfjsLib.getDocument({ data: new Uint8Array(dados) }).promise.then(function (doc) {
        var total = Math.min(doc.numPages, 200), r = [];
        (function pagina(i) {
          if (i > total) return cb(null, r);
          progresso(i, total);
          doc.getPage(i).then(function (pg) {
            var v1 = pg.getViewport({ scale: 1 }), esc = 1600 / Math.max(v1.width, v1.height);
            var vp = pg.getViewport({ scale: esc }), c = document.createElement('canvas');
            c.width = Math.round(vp.width); c.height = Math.round(vp.height);
            var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
            pg.render({ canvasContext: x, viewport: vp }).promise.then(function () {
              r.push({ url: c.toDataURL('image/jpeg', 0.8), w: c.width, h: c.height });
              pagina(i + 1);
            }, function () { cb('página ' + i + ' não abriu'); });
          }, function () { cb('página ' + i + ' não abriu'); });
        })(1);
      }, function () { cb('esse PDF não abriu (protegido ou corrompido?)'); });
    });
  }
  function imagemParaPagina(dados, cb) {
    var b = new Blob([dados]), fr = new FileReader();
    fr.onload = function () {
      var im = new Image();
      im.onload = function () {
        var esc = Math.min(1, 1600 / Math.max(im.width, im.height));
        var c = document.createElement('canvas'); c.width = Math.round(im.width * esc); c.height = Math.round(im.height * esc);
        var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
        cb(null, { url: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height });
      };
      im.onerror = function () { cb('não consegui abrir essa imagem'); };
      im.src = fr.result;
    };
    fr.readAsDataURL(b);
  }
  function ehPdf(f) { return /pdf$/i.test(f.type || '') || /\.pdf$/i.test(f.name || ''); }
  function importarSemPC(f, dados, destino, cb) {
    function pronto(err, jpgs) {
      if (err) return aviso('Não deu para importar: ' + err, 6000);
      var r = criarPaginasDeImagens(jpgs, destino, nomeSemExtensao(f));
      aviso('Importado: ' + r.paginas + (r.paginas === 1 ? ' página.' : ' páginas.'), 3000);
      if (!destino) { mostrarBiblioteca(); Editor.abrir(D.ents[r.caderno]); }
      else if (cb) cb(r);
    }
    if (ehImagem(f)) return imagemParaPagina(dados, function (err, j) { pronto(err, j ? [j] : null); });
    if (!ehPdf(f)) return aviso('Slides e documentos só com o PC ligado (é ele que converte). PDF e imagens funcionam sem o PC.', 6000);
    if (MODERNO) return pdfParaImagens(dados, function (i, t) { aviso('Convertendo página ' + i + ' de ' + t + '…', 600000); }, pronto);
    var cad = destino && D.ents[destino.caderno];
    if (cad && cad.sala) return Sala.pedirConversao(f, dados, destino, cad.sala);
    modal('Sem o PC, este iPad não consegue converter PDF. Opções:\n\n• Ligue o PC (o app aberto pelo endereço do PC converte).\n' +
          '• Ou compartilhe um caderno (⋯ → Estudar junto), abra-o e importe por dentro dele: um colega com celular ou PC ' +
          'e o mesmo caderno aberto converte para você.', [{ texto: 'Entendi', primario: true }]);
  }
  function paraBase64(dados) {
    var b = new Uint8Array(dados), partes = [], passo = 0x8000;
    for (var i = 0; i < b.length; i += passo) partes.push(String.fromCharCode.apply(null, b.subarray(i, i + passo)));
    return btoa(partes.join(''));
  }
  function deBase64(s) {
    var bin = atob(s), b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b.buffer;
  }
  Sala.pedirConversao = function (f, dados, destino, cod) {
    if (dados.byteLength > 7 * 1024 * 1024) return aviso('PDF grande demais para enviar pela sala (máx. 7 MB). Use o PC.', 6000);
    aviso('Enviando o PDF para a sala…', 600000);
    var job = novoId();
    Sala.req('PUT', 'salas/' + cod + '_f/' + job, { cad: destino.caderno, apos: destino.apos || 0, ate: destino.ate === null ? -1 : destino.ate,
      nome: nomeSemExtensao(f), por: Sala.nome || '', t: { '.sv': 'timestamp' }, dados: paraBase64(dados) }, function (err) {
      if (err) return aviso('Não deu para enviar: ' + err, 5000);
      modal('PDF enviado para a sala. Assim que alguém com o app aberto neste caderno num celular ou PC estiver online, ' +
            'ele converte e as páginas aparecem aqui sozinhas.', [{ texto: 'Entendi', primario: true }]);
    }, 600000);
  };
  // aparelho moderno: converte os PDFs que o iPad antigo deixou na fila desta sala
  Sala.ouvirFila = function (cod) {
    var f = new EventSource(FB.url + '/salas/' + cod + '_f.json?auth=' + encodeURIComponent(Sala.token));
    Sala.filaFonte = f;
    var vistos = {};
    function considerar(id, job) {
      if (!job || !job.dados || vistos[id]) return;
      if (job.pega && job.pega.uid !== Sala.uid && Date.now() + Sala.desvio - (job.pega.t || 0) < 5 * 60000) return;
      vistos[id] = true;
      Sala.converterDaFila(cod, id, job);
    }
    f.addEventListener('put', function (ev) {
      var d; try { d = JSON.parse(ev.data); } catch (x) { return; }
      if (!d || !d.data) return;
      var partes = d.path.split('/').filter(function (x) { return x; });
      if (!partes.length) { for (var k in d.data) if (d.data.hasOwnProperty(k)) considerar(k, d.data[k]); }
      else if (partes.length === 1) considerar(partes[0], d.data);
    }, false);
  };
  Sala.converterDaFila = function (cod, id, job) {
    Sala.req('PUT', 'salas/' + cod + '_f/' + id + '/pega', { uid: Sala.uid, t: { '.sv': 'timestamp' } }, function (err) {
      if (err) return;
      setTimeout(function () {   // quem gravou por último fica com o trabalho
        Sala.req('GET', 'salas/' + cod + '_f/' + id + '/pega', undefined, function (e2, pega) {
          if (e2 || !pega || pega.uid !== Sala.uid || !D.ents[job.cad]) return;
          aviso('Convertendo o PDF "' + (job.nome || '') + '" de ' + (job.por || 'um colega') + '…', 600000);
          pdfParaImagens(deBase64(job.dados), function (i, t) { aviso('Convertendo para ' + (job.por || 'o colega') + ': página ' + i + ' de ' + t + '…', 600000); }, function (e3, jpgs) {
            if (e3) { aviso('Não deu para converter o PDF do colega: ' + e3, 5000); return Sala.req('DELETE', 'salas/' + cod + '_f/' + id, undefined, function () {}); }
            criarPaginasDeImagens(jpgs, { caderno: job.cad, apos: job.apos, ate: job.ate === -1 ? null : job.ate }, job.nome);
            Sala.req('DELETE', 'salas/' + cod + '_f/' + id, undefined, function () {});
            aviso('PDF de ' + (job.por || 'um colega') + ' convertido: ' + jpgs.length + ' páginas.', 3500);
            if (telaAtual === 'editor' && E.cad && E.cad.id === job.cad) Editor.recarregarDoServidor();
          });
        });
      }, 1500);
    });
  };

  // ---------- exportar PDF sem o PC
  function montarPdf(paginas) {
    var partes = [], offsets = [], tamanho = 0, i;
    function add(s) {
      var u;
      if (typeof s === 'string') { u = new Uint8Array(s.length); for (var k = 0; k < s.length; k++) u[k] = s.charCodeAt(k) & 255; }
      else u = s;
      partes.push(u); tamanho += u.length;
    }
    function obj(n, conteudo) { offsets[n] = tamanho; add(n + ' 0 obj\n'); conteudo.forEach(add); add('\nendobj\n'); }
    var n = paginas.length, kids = [];
    for (i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');
    add('%PDF-1.4\n');
    obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
    obj(2, ['<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>']);
    for (i = 0; i < n; i++) {
      var p = paginas[i], W = p.L > p.A ? 842 : 595, H = Math.round(W * p.A / p.L), base = 3 + i * 3, jpg = dataUrlParaBytes(p.url);
      var desenho = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im0 Do Q';
      obj(base, ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im0 ' + (base + 1) + ' 0 R >> >> /Contents ' + (base + 2) + ' 0 R >>']);
      obj(base + 1, ['<< /Type /XObject /Subtype /Image /Width ' + p.L + ' /Height ' + p.A + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n', jpg, '\nendstream']);
      obj(base + 2, ['<< /Length ' + desenho.length + ' >>\nstream\n' + desenho + '\nendstream']);
    }
    var total = 3 + n * 3, xref = tamanho, linhas = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (i = 1; i < total; i++) linhas += ('0000000000' + offsets[i]).slice(-10) + ' 00000 n \n';
    add(linhas + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
    return new Blob(partes, { type: 'application/pdf' });
  }
  function desenharPaginasParaExportar(c, cb) {
    var pgs = paginasDe(c.id), saida = [];
    (function proxima(i) {
      if (i >= pgs.length) return cb(saida);
      var pg = pgs[i], ids = assetsDe(pg), mapa = {};
      (function carregar(j) {
        if (j < ids.length) return obterImagem(ids[j], function (im) { if (im) mapa[ids[j]] = im; carregar(j + 1); }, true);
        var esc = Math.min(1, 1600 / Math.max(pg.w, pg.h)), L = Math.round(pg.w * esc), A = Math.round(pg.h * esc);
        var cv = document.createElement('canvas'); cv.width = L; cv.height = A;
        var x = cv.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, L, A);
        x.setTransform(esc, 0, 0, esc, 0, 0);
        if (pg.pdf && mapa[pg.pdf]) x.drawImage(mapa[pg.pdf], 0, 0, pg.w, pg.h);
        desenharFundo(x, pg);
        ordenados(pg).forEach(function (e) { desenharElemento(x, e, false, mapa); });
        saida.push({ url: cv.toDataURL('image/jpeg', 0.85), L: L, A: A });
        aviso('Preparando página ' + (i + 1) + ' de ' + pgs.length + '…', 60000);
        setTimeout(function () { proxima(i + 1); }, 0);
      })(0);
    })(0);
  }
  function exportarLocal(c) {
    aviso('Preparando o PDF…', 60000);
    desenharPaginasParaExportar(c, function (paginas) {
      $('aviso').hidden = true;
      var baixa = MODERNO && 'download' in document.createElement('a') && window.URL && URL.createObjectURL;
      if (!baixa) return mostrarPaginasSalvas(c, paginas);
      var blob = montarPdf(paginas), nome = (c.nome || 'Caderno'), arq = null;
      if (nome.normalize) nome = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '');   // alguns navegadores trocam nome com acento por "download"
      nome = nome.replace(/[^A-Za-z0-9 ._-]/g, '_') + '.pdf';
      try { arq = new File([blob], nome, { type: 'application/pdf' }); } catch (e) {}
      if (arq && navigator.canShare && navigator.canShare({ files: [arq] })) {
        return modal('PDF de "' + (c.nome || 'caderno') + '" pronto. No iPhone/iPad: Compartilhar → Salvar em Arquivos → iCloud Drive.', [
          { texto: 'Fechar' },
          { texto: 'Salvar / Compartilhar', primario: true, acao: function () { navigator.share({ files: [arq], title: nome }).then(function () {}, function () {}); } }
        ]);
      }
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      aviso('PDF salvo em Downloads.', 3000);
    });
  }
  // iPad antigo: o Safari 9 não baixa arquivos; mostra as páginas para salvar nas Fotos (vão ao iCloud)
  function mostrarPaginasSalvas(c, paginas) {
    var div = $('salvos'), lista = $('salvos-lista');
    lista.innerHTML = '';
    $('salvos-titulo').textContent = c.nome || 'Caderno';
    paginas.forEach(function (p) { var im = document.createElement('img'); im.src = p.url; lista.appendChild(im); });
    div.hidden = false;
  }
  $('salvos-fechar').onclick = function () { $('salvos').hidden = true; $('salvos-lista').innerHTML = ''; };
  $('b-entrar').onclick = function () { Sala.entrarComCodigo(); };
  $('e-sala').onclick = function () { if (E.cad) Sala.mostrarCodigo(E.cad); };

  // ================================================================ biblioteca
  var telaAtual = 'biblioteca';
  var CORES_CAPA = ['#2f6fde', '#2a9d4b', '#d62828', '#8e44ad', '#e08a00', '#16a2b8'];

  function mostrarBiblioteca() {
    telaAtual = 'biblioteca';
    $('editor').hidden = true; $('lixeira').hidden = true; $('biblioteca').hidden = false;
    Lixeira.limparVelhos();
    var nl = Lixeira.itens().length;
    $('b-lixeira').textContent = 'Lixeira' + (nl ? ' (' + nl + ')' : '');
    var lista = $('lista'); lista.innerHTML = '';
    var todos = cadernos(), cs, pastas = {};
    // pasta = campo "pasta" do caderno; existe enquanto tiver algum caderno dentro
    todos.forEach(function (c) { if (c.pasta) pastas[c.pasta] = (pastas[c.pasta] || 0) + 1; });
    if (Bib.pasta && !pastas[Bib.pasta]) Bib.pasta = null;
    $('b-pasta-voltar').hidden = !Bib.pasta;
    $('b-titulo').textContent = Bib.pasta || 'Anotações';
    if (Bib.pasta) cs = todos.filter(function (c) { return c.pasta === Bib.pasta; });
    else {
      cs = todos.filter(function (c) { return !c.pasta; });
      chaves(pastas).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; }).forEach(function (nome) {
        var el = document.createElement('div'); el.className = 'cartao';
        var capa = document.createElement('div'); capa.className = 'capa pasta';
        var b = document.createElement('b'); b.textContent = nome; capa.appendChild(b);
        var info = document.createElement('div'); info.className = 'info';
        var mais = document.createElement('span'); mais.className = 'mais'; mais.textContent = '⋯';
        info.appendChild(mais);
        info.appendChild(document.createTextNode('Pasta · ' + pastas[nome] + (pastas[nome] === 1 ? ' caderno' : ' cadernos')));
        el.appendChild(capa); el.appendChild(info);
        el.onclick = function (ev) {
          if (ev.target === mais) return menuPasta(nome);
          Bib.pasta = nome; mostrarBiblioteca();
        };
        lista.appendChild(el);
      });
    }
    $('vazio').hidden = todos.length > 0;
    cs.forEach(function (c, i) {
      var n = paginasDe(c.id).length;
      var el = document.createElement('div'); el.className = 'cartao';
      var capa = document.createElement('div'); capa.className = 'capa';
      var faixa = document.createElement('i'); faixa.style.background = CORES_CAPA[hash(c.id) % CORES_CAPA.length];
      var nome = document.createElement('b'); nome.textContent = c.nome || 'Sem nome';
      capa.appendChild(faixa); capa.appendChild(nome);
      var info = document.createElement('div'); info.className = 'info';
      var mais = document.createElement('span'); mais.className = 'mais'; mais.textContent = '⋯';
      info.appendChild(mais);
      info.appendChild(document.createTextNode(n + (n === 1 ? ' página' : ' páginas') + ' · ' + dataCurta(c.u)));
      if (c.sala) { var tag = document.createElement('span'); tag.className = 'tag-sala'; tag.textContent = 'Sala ' + c.sala; info.appendChild(tag); }
      el.appendChild(capa); el.appendChild(info);
      el.onclick = function (ev) {
        if (ev.target === mais) return menuCaderno(c);
        Editor.abrir(c);
      };
      lista.appendChild(el);
    });
    atualizarStatus();
  }
  // ================================================================ lixeira
  // Apagar manda para a lixeira (campo lix = quando). Depois de 30 dias vira apagado de vez.
  var DIAS_LIXEIRA = 30, DIA = 86400000;
  var Lixeira = {
    mover: function (e) { var n = copia(e); n.lix = Date.now(); n.u = agora(); alterado(n); },
    itens: function () {
      var r = [];
      for (var id in D.ents) if (D.ents.hasOwnProperty(id)) {
        var e = D.ents[id];
        if (e.d || !e.lix) continue;
        if (e.tipo === 'p') {   // página solta: só se o caderno dela ainda existe
          var c = D.ents[e.c];
          if (!c || c.d || c.lix) continue;
        }
        r.push(e);
      }
      return r.sort(function (a, b) { return b.lix - a.lix; });
    },
    limparVelhos: function () {
      Lixeira.itens().forEach(function (e) { if (Date.now() - e.lix > DIAS_LIXEIRA * DIA) Lixeira.apagarDeVez(e); });
    },
    restaurar: function (e) { var n = copia(e); n.lix = 0; n.u = agora(); alterado(n); },
    apagarDeVez: function (e) { var n = copia(e); n.d = 1; n.u = agora(); alterado(n); },
    mostrar: function () {
      telaAtual = 'lixeira';
      $('biblioteca').hidden = true; $('lixeira').hidden = false;
      var lista = $('lix-lista'), itens = Lixeira.itens();
      lista.innerHTML = '';
      $('lix-vazia').hidden = itens.length > 0;
      $('lix-esvaziar').disabled = !itens.length;
      itens.forEach(function (e) {
        var linha = document.createElement('div'); linha.className = 'lix-linha';
        var txt = document.createElement('div'); txt.className = 'lix-texto';
        var nome = document.createElement('b'), info = document.createElement('small');
        var resta = Math.max(0, Math.ceil(DIAS_LIXEIRA - (Date.now() - e.lix) / DIA));
        if (e.tipo === 'c') {
          nome.textContent = e.nome || 'Sem nome';
          var np = paginasDe(e.id).length; info.textContent = 'Caderno · ' + np + (np === 1 ? ' página' : ' páginas');
        } else {
          nome.textContent = 'Página de "' + (D.ents[e.c].nome || 'Sem nome') + '"';
          var n = 0; for (var k in e.els) if (e.els.hasOwnProperty(k) && !e.els[k].d) n++;
          info.textContent = 'Página · ' + n + (n === 1 ? ' item' : ' itens');
        }
        info.textContent += ' · apagado ' + dataCurta(e.lix) + ' · some em ' + resta + (resta === 1 ? ' dia' : ' dias');
        txt.appendChild(nome); txt.appendChild(info);
        var rest = document.createElement('button'); rest.className = 'botao primario pequeno'; rest.textContent = 'Restaurar';
        rest.onclick = function () { Lixeira.restaurar(e); Lixeira.mostrar(); aviso('Restaurado.'); };
        var fora = document.createElement('button'); fora.className = 'botao perigo pequeno'; fora.textContent = 'Apagar de vez';
        fora.onclick = function () {
          if (!confirm('Apagar de vez? Depois disso, só dá para recuperar pela cópia de segurança do PC.')) return;
          Lixeira.apagarDeVez(e); Lixeira.mostrar();
        };
        linha.appendChild(txt); linha.appendChild(rest); linha.appendChild(fora);
        lista.appendChild(linha);
      });
    }
  };
  $('b-lixeira').onclick = function () { Lixeira.mostrar(); };
  $('lix-voltar').onclick = function () { mostrarBiblioteca(); sincronizar(); };
  $('lix-esvaziar').onclick = function () {
    var itens = Lixeira.itens();
    if (!itens.length || !confirm('Apagar de vez os ' + itens.length + ' itens da lixeira?')) return;
    itens.forEach(Lixeira.apagarDeVez); Lixeira.mostrar();
  };

  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function dataCurta(u) {
    if (!u) return '';
    var d = new Date(u), m = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return d.getDate() + ' ' + m[d.getMonth()];
  }

  function menuCaderno(c) {
    modal('Caderno "' + (c.nome || 'Sem nome') + '"' + (c.sala ? ' · sala ' + c.sala : ''), [
      { texto: c.sala ? 'Convidar (código da sala)' : 'Estudar junto (compartilhar)', primario: true, acao: function () { Sala.compartilhar(c); } },
      { texto: c.sala ? 'Sair da sala (apagar daqui)' : 'Apagar', acao: function () {
        Lixeira.mover(c); mostrarBiblioteca();
        aviso('"' + (c.nome || 'Caderno') + '" foi para a lixeira (30 dias para recuperar).', 3500);
      } },
      { texto: 'Renomear', acao: function () {
        var nome = prompt('Novo nome:', c.nome || '');
        if (!nome) return;
        var n = copia(c); n.nome = nome; n.u = agora(); alterado(n); mostrarBiblioteca();
      } },
      { texto: 'Mover para pasta', acao: function () { escolherPasta(c); } },
      { texto: 'Exportar PDF', acao: function () { exportar(c); } },
      { texto: 'Fechar' }
    ]);
  }

  // ---- pastas
  var Bib = { pasta: null };
  function nomesPastas() {
    var r = {}; cadernos().forEach(function (c) { if (c.pasta) r[c.pasta] = 1; });
    return chaves(r).sort();
  }
  function colocarNaPasta(c, nome) {
    var n = copia(c); if (nome) n.pasta = nome; else n.pasta = ''; n.u = agora(); alterado(n);
  }
  function escolherPasta(c) {
    var acoes = nomesPastas().filter(function (p) { return p !== c.pasta; }).map(function (p) {
      return { texto: '📁 ' + p, acao: function () { colocarNaPasta(c, p); mostrarBiblioteca(); aviso('Movido para "' + p + '".'); } };
    });
    acoes.push({ texto: '+ Nova pasta', primario: true, acao: function () {
      var nome = prompt('Nome da pasta (ex.: Física, 2º semestre):', '');
      if (!nome || !nome.replace(/\s/g, '')) return;
      nome = nome.replace(/^\s+|\s+$/g, '');
      colocarNaPasta(c, nome); mostrarBiblioteca(); aviso('Movido para "' + nome + '".');
    } });
    if (c.pasta) acoes.push({ texto: 'Tirar da pasta', acao: function () { colocarNaPasta(c, ''); mostrarBiblioteca(); } });
    acoes.push({ texto: 'Cancelar' });
    modal('Mover "' + (c.nome || 'Sem nome') + '" para:', acoes);
  }
  function menuPasta(nome) {
    var dentro = cadernos().filter(function (c) { return c.pasta === nome; });
    modal('Pasta "' + nome + '"', [
      { texto: 'Renomear', acao: function () {
        var novo = prompt('Novo nome da pasta:', nome);
        if (!novo || !novo.replace(/\s/g, '')) return;
        novo = novo.replace(/^\s+|\s+$/g, '');
        dentro.forEach(function (c) { colocarNaPasta(c, novo); }); mostrarBiblioteca();
      } },
      { texto: 'Desfazer pasta', acao: function () {
        if (!confirm('Desfazer a pasta "' + nome + '"? Os ' + dentro.length + ' cadernos voltam para a tela principal (nada é apagado).')) return;
        dentro.forEach(function (c) { colocarNaPasta(c, ''); }); mostrarBiblioteca();
      } },
      { texto: 'Fechar', primario: true }
    ]);
  }
  $('b-pasta-voltar').onclick = function () { Bib.pasta = null; mostrarBiblioteca(); };

  function exportar(c) {
    if (Sync.semPC) return exportarLocal(c);
    aviso('Enviando para o PC…', 15000);
    sincronizar(function (err) {
      if (err && err !== 'ocupado') return exportarLocal(c);   // sem o PC: o próprio aparelho monta o PDF
      $('aviso').hidden = true;
      modal('PDF de "' + (c.nome || 'caderno') + '" pronto.', [
        { texto: 'Fechar' },
        { texto: 'Abrir PDF', primario: true, href: '/api/exportar/' + c.id + '.pdf?t=' + Date.now() }
      ]);
    });
  }

  $('b-novo').onclick = function () {
    var nome = prompt('Nome do caderno:', 'Caderno ' + (cadernos().length + 1));
    if (!nome) return;
    var c = { id: novoId(), tipo: 'c', nome: nome, u: agora(), d: 0 };
    if (Bib.pasta) c.pasta = Bib.pasta;   // criado dentro da pasta aberta
    alterado(c);
    novaPagina(c.id, 1, 'pautado');
    Editor.abrir(c);
  };
  // Importar: PDF, imagens, slides e documentos (do iCloud Drive, Fotos ou outro app).
  // O PC converte em páginas (slides/documentos pelo LibreOffice).
  function ehImagem(f) { return /^image\//.test(f.type || '') || /\.(jpe?g|png|gif|bmp|webp)$/i.test(f.name || ''); }
  function nomeSemExtensao(f) { return (f.name || 'Arquivo').replace(/\.[A-Za-z0-9]{1,5}$/, ''); }
  function enviarImportacao(f, destino, cb) {
    var url = '/api/importar?nome=' + encodeURIComponent(nomeSemExtensao(f)) + '&arquivo=' + encodeURIComponent(f.name || '');
    if (destino) url += '&caderno=' + encodeURIComponent(destino.caderno) + '&apos=' + destino.apos + (destino.ate !== null ? '&ate=' + destino.ate : '');
    lerArquivo(f, function (dados) {
      if (Sync.semPC) return importarSemPC(f, dados, destino, cb);
      // o caderno precisa existir no PC antes (pode ter sido criado agora, só no iPad)
      if (destino) sincronizarAntes(function () { enviar(dados); }); else enviar(dados);
    });
    function enviar(dados) {
      aviso('Enviando "' + (f.name || 'arquivo') + '" para o PC… (slides e PDFs grandes demoram)', 600000);
      xhr('POST', url, dados, 'application/octet-stream', function (err, r) {
        registrarImportacao(f, err || 'ok');
        if (err === 'sem conexão' || erroDeSemPC(err)) return importarSemPC(f, dados, destino, cb);
        if (err) return aviso('Não deu para importar: ' + err, 6000);
        aviso('Importado: ' + r.paginas + (r.paginas === 1 ? ' página.' : ' páginas.'), 3000);
        sincronizar(function () { if (cb) cb(r); });
      }, { timeout: 900000 });
    }
  }
  function sincronizarAntes(cb, tentativas) {
    sincronizar(function (err) {
      if (err === 'ocupado' && (tentativas || 0) < 20) return setTimeout(function () { sincronizarAntes(cb, (tentativas || 0) + 1); }, 500);
      cb();
    });
  }
  // No iOS 9, arquivo do iCloud Drive que ainda não foi baixado para o iPad vem ilegível
  // (falha do Safari). Lê antes de enviar para dar um aviso claro em vez de mandar vazio.
  function lerArquivo(f, cb) {
    var fr = new FileReader();
    aviso('Lendo "' + (f.name || 'arquivo') + '"…', 600000);
    fr.onload = function () {
      if (!fr.result || !fr.result.byteLength) return falhaLeitura('vazio');
      cb(fr.result);
    };
    fr.onerror = function () { falhaLeitura(fr.error ? (fr.error.name || fr.error.code) : 'erro'); };
    try { fr.readAsArrayBuffer(f); } catch (e) { falhaLeitura(String(e)); }
    function falhaLeitura(motivo) {
      registrarImportacao(f, 'ilegivel:' + motivo);
      $('aviso').hidden = true;
      modal('O iPad não deixou ler "' + (f.name || 'o arquivo') + '". No iOS 9 isso acontece com arquivos do iCloud Drive ' +
            'que ainda não foram baixados para o iPad. Abra o arquivo uma vez no app iCloud Drive (espere ele baixar) e ' +
            'tente de novo. Outra opção: no PC, coloque o arquivo na pasta Anotacoes/Importar.', [{ texto: 'Entendi', primario: true }]);
    }
  }
  function registrarImportacao(f, resultado) {
    if (Sync.semPC) return;
    xhr('POST', '/api/registro', JSON.stringify({ evento: 'importar', arquivo: f.name || '', tipo: f.type || '',
      tamanho: f.size, resultado: resultado }), 'application/json', function () {});
  }
  $('b-importar').onclick = function () { $('arquivo-imp').value = ''; $('arquivo-imp').click(); };
  $('arquivo-imp').onchange = function () {
    var f = this.files && this.files[0];
    if (f) enviarImportacao(f, null);
  };

  // ================================================================ editor
  // cores na barra (as últimas usadas) e a grade completa do botão +
  var CORES = { caneta: ['#1a1a1a', '#1e5bd6', '#d62828', '#2a9d4b', '#8e44ad'],
                marca: ['#ffe14d', '#8ef08e', '#ff9ad5', '#7fd6ff'] };
  var GRADE = {
    caneta: ['#1a1a1a', '#4a4f57', '#8a929c', '#ffffff', '#6b3e1f', '#a0522d',
             '#d62828', '#e4572e', '#f08c00', '#e0b000', '#7a8b00', '#2a9d4b',
             '#0f7b6c', '#16a2b8', '#1e5bd6', '#1a237e', '#5e35b1', '#8e44ad',
             '#c2185b', '#ff6fa8', '#b8860b', '#00897b', '#3f51b5', '#795548'],
    marca: ['#ffe14d', '#ffd166', '#ffb347', '#ff8a65', '#ff9ad5', '#e1a6ff',
            '#b39ddb', '#7fd6ff', '#80deea', '#8ef08e', '#c5e17a', '#d7ccc8']
  };
  try { var cs0 = JSON.parse(localStorage.getItem('an-cores') || 'null'); if (cs0 && cs0.caneta && cs0.marca) CORES = cs0; } catch (e) {}
  var ESPESSURAS = { caneta: [1.8, 3, 5], marca: [14, 20, 28] };
  var FUNDOS = [['liso', 'Liso'], ['pautado', 'Pautado'], ['quad', 'Quadriculado'], ['pontos', 'Pontos']];
  var RAIO_BORRACHA = 14;
  // fontes do texto: ficam guardadas no app (funcionam sem internet e saem iguais no PDF)
  var FONTES = [['', 'Padrão'], ['caveat', 'Manuscrita'], ['patrick-hand', 'Letra de forma'], ['kalam', 'Caneta'],
                ['permanent-marker', 'Pincel'], ['lora', 'Livro'], ['courier-prime', 'Máquina']];
  var SISTEMA = '-apple-system, Helvetica, Arial, sans-serif';
  function familia(chave) { return chave ? "'an-" + chave + "', " + SISTEMA : SISTEMA; }
  function fonteCanvas(e) { return e.tam + 'px ' + familia(e.fonte); }
  // O Safari do iOS 9 não avisa quando a fonte carrega: compara a largura do texto até mudar
  // e então redesenha a página.
  var Fontes = {
    padrao: '', prontas: {},
    iniciar: function () {
      try { Fontes.padrao = localStorage.getItem('an-fonte') || ''; } catch (e) {}
      var div = document.createElement('div');
      div.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden';
      FONTES.forEach(function (f) { if (f[0]) { var sp = document.createElement('span'); sp.style.fontFamily = familia(f[0]); sp.textContent = 'Aá'; div.appendChild(sp); } });
      document.body.appendChild(div);
      var c = document.createElement('canvas').getContext('2d'), voltas = 0;
      function medir(f) { c.font = '40px ' + f; return c.measureText('Ação é ótima, Wiq 0123').width; }
      var ref = medir('monospace');
      (function conferir() {
        var novas = 0;
        FONTES.forEach(function (f) {
          if (f[0] && !Fontes.prontas[f[0]] && medir("'an-" + f[0] + "', monospace") !== ref) { Fontes.prontas[f[0]] = 1; novas++; }
        });
        if (novas && telaAtual === 'editor' && !Editor.ocupado()) Editor.render();
        if (chaves(Fontes.prontas).length < FONTES.length - 1 && ++voltas < 60) setTimeout(conferir, 400);
      })();
    },
    montarSeletor: function () {
      var sel = $('t-fonte');
      FONTES.forEach(function (f) {
        var o = document.createElement('option'); o.value = f[0]; o.textContent = f[1];
        o.style.fontFamily = familia(f[0]); sel.appendChild(o);
      });
      sel.onchange = function () {
        var el = E.textoEdit; if (!el) return;
        if (sel.value) el.fonte = sel.value; else delete el.fonte;
        $('t-texto').style.fontFamily = familia(el.fonte);
        sel.style.fontFamily = familia(el.fonte);
        Fontes.padrao = sel.value;
        try { localStorage.setItem('an-fonte', sel.value); } catch (e) {}
      };
    }
  };

  var E = {
    cad: null, paginas: [], idx: 0, pagina: null,
    ferr: 'caneta', cor: { caneta: '#1a1a1a', marca: '#ffe14d' }, esp: { caneta: 1, marca: 1 },
    zoom: 1, px: 0, py: 0,           // zoom e deslocamento (em px da tela)
    dpr: 1, W: 0, H: 0, s: 1, ox: 0, oy: 0,
    desfazer: [], refazer: [],
    sel: [], textoEdit: null
  };
  var base, vivo, cb2, cv2;

  var Editor = {
    desenhando: false,

    abrir: function (c) {
      telaAtual = 'editor';
      E.cad = c; E.paginas = paginasDe(c.id);
      if (!E.paginas.length) E.paginas = [novaPagina(c.id, 1, 'pautado')];
      E.idx = 0; E.desfazer = []; E.refazer = [];
      $('biblioteca').hidden = true; $('editor').hidden = false;
      if (c.sala && (Sala.aberto !== c.sala || !Sala.fonte)) Sala.conectar(c.sala);
      else if (!c.sala && Sala.aberto) Sala.fechar();
      Sala.atualizarBotao();
      Editor.medir();
      Pulso.mostrar();
      Editor.irPara(0);
      dicaUmaVez('an-dica-formas', 'Dica: segure a caneta parada no fim do traço e ele vira forma (linha, círculo, quadrado…). ⬚ Selecionar: contorne a letra para endireitar, copiar ou colar.');
    },
    irPara: function (i) {
      Editor.fecharTexto(true); Editor.desselecionar();
      E.idx = Math.max(0, Math.min(E.paginas.length - 1, i));
      E.pagina = E.paginas[E.idx];
      E.zoom = zoomInicial(); E.px = 0; E.py = 0;
      E.desfazer = []; E.refazer = [];
      Editor.atualizarBotoes();
      Editor.render();
    },
    recarregarDoServidor: function () {
      if (Editor.ocupado()) { Editor.recarregarDepois = true; return; }
      Editor.recarregarDepois = false;
      var c = D.ents[E.cad.id];
      if (!c || c.d || c.lix) { aviso('Este caderno foi para a lixeira em outro aparelho.'); return mostrarBiblioteca(); }
      var atualId = E.pagina && E.pagina.id;
      E.cad = c; E.paginas = paginasDe(c.id);
      if (!E.paginas.length) E.paginas = [novaPagina(c.id, 1, 'pautado')];
      var i = 0;
      for (var k = 0; k < E.paginas.length; k++) if (E.paginas[k].id === atualId) i = k;
      E.idx = i; E.pagina = E.paginas[i];
      Editor.atualizarBotoes(); Editor.render();
    },
    medir: function () {
      var area = $('area');
      E.W = area.clientWidth; E.H = area.clientHeight;
      E.dpr = window.devicePixelRatio || 1;
      [base, vivo].forEach(function (cv) {
        cv.width = Math.round(E.W * E.dpr); cv.height = Math.round(E.H * E.dpr);
        cv.style.width = E.W + 'px'; cv.style.height = E.H + 'px';
      });
    },
    // posição da página na tela
    calcularVista: function () {
      var pg = E.pagina, margem = 16;
      E.s = (E.W - 2 * margem) / pg.w * E.zoom;
      var largura = pg.w * E.s, altura = pg.h * E.s;
      E.ox = largura < E.W ? (E.W - largura) / 2 : margem + E.px;
      E.oy = margem + E.py;
      // não deixa a página sumir da tela; se cabe inteira, fica no meio
      if (largura >= E.W) E.ox = Math.min(margem, Math.max(E.W - largura - margem, E.ox));
      E.oy = Math.min(margem, Math.max(Math.min(margem, E.H - altura - margem), E.oy));
      if (altura <= E.H - 2 * margem) E.oy = (E.H - altura) / 2;
      E.px = largura >= E.W ? E.ox - margem : 0;
      E.py = altura <= E.H - 2 * margem ? 0 : E.oy - margem;
    },
    paraPagina: function (cx, cy) { return { x: (cx - E.ox) / E.s, y: (cy - E.oy) / E.s }; },

    render: function () {
      if (!E.pagina) return;
      Editor.calcularVista();
      var c = cb2, pg = E.pagina;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = '#e4e7eb'; c.fillRect(0, 0, base.width, base.height);
      c.setTransform(E.dpr * E.s, 0, 0, E.dpr * E.s, E.dpr * E.ox, E.dpr * E.oy);
      c.shadowColor = 'rgba(0,0,0,0.18)'; c.shadowBlur = 6 * E.dpr; c.shadowOffsetY = 1 * E.dpr;
      c.fillStyle = '#fff'; c.fillRect(0, 0, pg.w, pg.h);
      c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
      c.save();
      c.beginPath(); c.rect(0, 0, pg.w, pg.h); c.clip();
      if (pg.pdf) {
        if (imgs[pg.pdf]) c.drawImage(imgs[pg.pdf], 0, 0, pg.w, pg.h);
        else obterImagem(pg.pdf, function () { if (E.pagina && E.pagina.id === pg.id) Editor.render(); });
      }
      desenharFundo(c, pg);
      ordenados(pg).forEach(function (e) { desenharElemento(c, e); });
      c.restore();
      Editor.limparVivo();
      Editor.posicionarSelecao();
    },
    limparVivo: function () {
      cv2.setTransform(1, 0, 0, 1, 0, 0);
      cv2.clearRect(0, 0, vivo.width, vivo.height);
      cv2.setTransform(E.dpr * E.s, 0, 0, E.dpr * E.s, E.dpr * E.ox, E.dpr * E.oy);
    },
    desenharNaBase: function (e) {   // acrescenta 1 elemento sem redesenhar tudo
      cb2.save();
      cb2.setTransform(E.dpr * E.s, 0, 0, E.dpr * E.s, E.dpr * E.ox, E.dpr * E.oy);
      cb2.beginPath(); cb2.rect(0, 0, E.pagina.w, E.pagina.h); cb2.clip();
      desenharElemento(cb2, e);
      cb2.restore();
    },

    // ---------- alterações com desfazer ----------
    // a sincronização pode ter trazido uma versão mais nova da página aberta
    atualizarPagina: function () {
      var atual = E.pagina && D.ents[E.pagina.id];
      if (atual && atual !== E.pagina) { E.pagina = mesclar(E.pagina, atual); E.paginas[E.idx] = E.pagina; }
    },
    ocupado: function () { return !!(G || P || E.textoEdit); },
    aplicar: function (mudancas, registrar) {
      // mudancas: [{antes: el|null, depois: el}]
      Editor.atualizarPagina();
      var pg = copia(E.pagina);
      mudancas.forEach(function (m) { var el = copia(m.depois); el.u = agora(); pg.els[el.id] = el; });
      E.pagina = pg; E.paginas[E.idx] = pg;
      alterado(pg);
      if (registrar !== false) { E.desfazer.push(mudancas); E.refazer = []; if (E.desfazer.length > 100) E.desfazer.shift(); }
      Editor.atualizarBotoes();
    },
    desfazer: function () {
      var m = E.desfazer.pop(); if (!m) return;
      Editor.desselecionar();
      Editor.aplicar(m.map(function (x) {
        return { antes: x.depois, depois: x.antes || apagado(x.depois) };
      }), false);
      E.refazer.push(m); Editor.atualizarBotoes(); Editor.render();
    },
    refazer: function () {
      var m = E.refazer.pop(); if (!m) return;
      Editor.desselecionar();
      Editor.aplicar(m, false);
      E.desfazer.push(m); Editor.atualizarBotoes(); Editor.render();
    },

    atualizarBotoes: function () {
      $('p-num').textContent = (E.idx + 1) + ' / ' + E.paginas.length;
      $('p-ant').disabled = E.idx === 0;
      $('p-prox').disabled = E.idx >= E.paginas.length - 1;
      $('e-desfazer').disabled = !E.desfazer.length;
      $('e-refazer').disabled = !E.refazer.length;
      $('e-colar').disabled = !(Clip.els && Clip.els.length);
      var nomeFundo = 'Liso';
      FUNDOS.forEach(function (f) { if (f[0] === (E.pagina && E.pagina.fundo)) nomeFundo = f[1]; });
      $('p-fundo').textContent = 'Fundo: ' + (E.pagina && E.pagina.pdf ? 'PDF' : nomeFundo);
      var fs = document.querySelectorAll('.ferr');
      for (var i = 0; i < fs.length; i++) fs[i].className = 'ferr' + (fs[i].getAttribute('data-f') === E.ferr ? ' ativo' : '');
      Editor.montarPaleta();
    },
    montarPaleta: function () {
      var tipo = E.ferr === 'marca' ? 'marca' : 'caneta';
      var mostrar = E.ferr === 'caneta' || E.ferr === 'marca' || E.ferr === 'texto';
      var cores = $('cores'), esps = $('espessuras');
      cores.innerHTML = ''; esps.innerHTML = '';
      if (!mostrar) return;
      CORES[tipo].forEach(function (cor) {
        var s = document.createElement('span');
        s.style.background = cor;
        if (cor === '#ffffff') s.style.boxShadow = '0 0 0 1px #9aa5b1';
        if (E.cor[tipo] === cor) s.className = 'ativo';
        s.onclick = function () { E.cor[tipo] = cor; Editor.montarPaleta(); };
        cores.appendChild(s);
      });
      var mais = document.createElement('span'); mais.className = 'mais-cores'; mais.textContent = '+';
      mais.title = 'Mais cores';
      mais.onclick = function (ev) { ev.stopPropagation(); abrirGradeCores(tipo, mais); };
      cores.appendChild(mais);
      if (E.ferr === 'texto') return;
      ESPESSURAS[tipo].forEach(function (l, i) {
        var s = document.createElement('span'), t = document.createElement('i');
        var px = tipo === 'marca' ? 4 + i * 4 : 2 + i * 2;
        t.style.height = px + 'px'; t.style.marginTop = (-px / 2) + 'px';
        if (tipo === 'marca') { t.style.background = E.cor.marca; }
        s.appendChild(t);
        if (E.esp[tipo] === i) s.className = 'ativo';
        s.onclick = function () { E.esp[tipo] = i; Editor.montarPaleta(); };
        esps.appendChild(s);
      });
    },

    // ---------- seleção ----------
    selecionados: function () {
      var r = [];
      E.sel.forEach(function (id) { var e = E.pagina && E.pagina.els[id]; if (e && !e.d) r.push(e); });
      return r;
    },
    selecionar: function (lista) {
      E.sel = (lista || []).map(function (e) { return e.id; });
      Editor.posicionarSelecao();
    },
    desselecionar: function () { E.sel = []; $('selecao').hidden = true; },
    posicionarSelecao: function () {
      var box = $('selecao'), els = Editor.selecionados();
      if (!els.length) { box.hidden = true; E.sel = []; return; }
      var b = caixaDeVarios(els), x = E.ox + b.x * E.s, y = E.oy + b.y * E.s;
      box.style.left = x + 'px'; box.style.top = y + 'px';
      box.style.width = (b.w * E.s) + 'px'; box.style.height = (b.h * E.s) + 'px';
      $('s-editar').hidden = !(els.length === 1 && els[0].k === 'texto');
      $('s-endireitar').hidden = !els.some(ehEscrita);
      // botões: abaixo da caixa se ela encosta no alto; puxados para dentro se passam da direita
      box.className = 'selecao' + (y < 46 ? ' acoes-embaixo' : '');
      var acoes = $('s-acoes');
      acoes.style.left = '-2px';
      var sobra = E.W - (x + acoes.offsetWidth + 8);
      if (sobra < 0) acoes.style.left = Math.max(-x + 4, sobra - 2) + 'px';
      box.hidden = false;
    },

    // ---------- texto ----------
    abrirTexto: function (el) {
      E.textoEdit = el;
      var cx = $('caixa-texto'), ta = $('t-texto');
      cx.style.left = (E.ox + el.x * E.s) + 'px'; cx.style.top = (E.oy + el.y * E.s) + 'px';
      cx.style.width = Math.max(140, el.w * E.s) + 'px';
      ta.style.fontSize = Math.max(10, el.tam * E.s) + 'px';
      ta.style.color = el.cor;
      ta.style.fontFamily = familia(el.fonte);
      $('t-fonte').value = el.fonte || ''; $('t-fonte').style.fontFamily = familia(el.fonte);
      ta.value = el.t || '';
      cx.hidden = false;
      setTimeout(function () { ta.focus(); }, 50);
    },
    fecharTexto: function (salvar) {
      var el = E.textoEdit; if (!el) return;
      E.textoEdit = null;
      $('caixa-texto').hidden = true;
      $('t-texto').blur();
      if (!salvar) return Editor.render();
      var txt = $('t-texto').value.replace(/\s+$/, '');
      var antigo = E.pagina.els[el.id] || null;
      if (!txt) { if (antigo && !antigo.d) Editor.aplicar([{ antes: antigo, depois: apagado(antigo) }]); }
      else {
        var novo = copia(el); novo.t = txt;
        if (!antigo || antigo.t !== txt || antigo.tam !== novo.tam || (antigo.fonte || '') !== (novo.fonte || '') || antigo.d) Editor.aplicar([{ antes: antigo, depois: novo }]);
      }
      Editor.render();
    }
  };

  // grade de cores: a escolhida entra na barra (no lugar da mais antiga)
  function abrirGradeCores(tipo, ancora) {
    var g = $('grade-cores');
    if (!g.hidden && g.getAttribute('data-tipo') === tipo) { g.hidden = true; return; }
    g.innerHTML = ''; g.setAttribute('data-tipo', tipo);
    $('aviso').hidden = true;
    GRADE[tipo].forEach(function (cor) {
      var s = document.createElement('span');
      s.style.background = cor;
      if (cor === '#ffffff') s.style.boxShadow = 'inset 0 0 0 1px #9aa5b1';
      if (E.cor[tipo] === cor) s.className = 'ativo';
      s.onclick = function () {
        E.cor[tipo] = cor;
        var l = CORES[tipo];
        if (l.indexOf(cor) < 0) { l.unshift(cor); l.pop(); }
        try { localStorage.setItem('an-cores', JSON.stringify(CORES)); } catch (e) {}
        g.hidden = true; Editor.montarPaleta();
      };
      g.appendChild(s);
    });
    var r = ancora.getBoundingClientRect();
    g.className = 'grade-cores' + (tipo === 'marca' ? ' marca' : '');
    g.hidden = false;
    g.style.top = (r.bottom + 8) + 'px';
    g.style.left = Math.max(8, Math.min(window.innerWidth - g.offsetWidth - 8, r.left + r.width / 2 - g.offsetWidth / 2)) + 'px';
  }
  document.addEventListener('touchstart', function (ev) {
    var g = $('grade-cores'); if (g.hidden) return;
    var el = ev.target; while (el) { if (el === g || (el.className && /mais-cores/.test(el.className))) return; el = el.parentNode; }
    g.hidden = true;
  }, false);
  document.addEventListener('mousedown', function (ev) {
    var g = $('grade-cores'); if (g.hidden) return;
    var el = ev.target; while (el) { if (el === g || (el.className && /mais-cores/.test(el.className))) return; el = el.parentNode; }
    g.hidden = true;
  }, false);

  function apagado(el) { var n = copia(el); n.d = 1; return n; }
  function ordenados(pg) {
    var r = [];
    for (var k in pg.els) if (pg.els.hasOwnProperty(k) && !pg.els[k].d) r.push(pg.els[k]);
    return r.sort(function (a, b) { return (a.c - b.c) || (a.id < b.id ? -1 : 1); });
  }

  // ================================================================ desenho
  function desenharFundo(c, pg) {
    var y, x;
    if (pg.fundo === 'pautado') {
      c.strokeStyle = '#c9d6e8'; c.lineWidth = 1.2; c.beginPath();
      for (y = 120; y < pg.h - 40; y += 32) { c.moveTo(0, y); c.lineTo(pg.w, y); }
      c.stroke();
      c.strokeStyle = '#efaaaa'; c.beginPath(); c.moveTo(80, 0); c.lineTo(80, pg.h); c.stroke();
    } else if (pg.fundo === 'quad') {
      c.strokeStyle = '#e3e8ef'; c.lineWidth = 1; c.beginPath();
      for (x = 25; x < pg.w; x += 25) { c.moveTo(x, 0); c.lineTo(x, pg.h); }
      for (y = 25; y < pg.h; y += 25) { c.moveTo(0, y); c.lineTo(pg.w, y); }
      c.stroke();
    } else if (pg.fundo === 'pontos') {
      c.fillStyle = '#bec6d2';
      for (x = 25; x < pg.w; x += 25) for (y = 25; y < pg.h; y += 25) c.fillRect(x - 1.3, y - 1.3, 2.6, 2.6);
    }
  }

  function caminhoTraco(c, p) {
    c.beginPath();
    c.moveTo(p[0], p[1]);
    if (p.length <= 4) { c.lineTo(p[p.length - 2] + 0.01, p[p.length - 1]); return; }
    for (var i = 2; i < p.length - 2; i += 2) {
      var mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
      c.quadraticCurveTo(p[i], p[i + 1], mx, my);
    }
    c.lineTo(p[p.length - 2], p[p.length - 1]);
  }

  function desenharElemento(c, e, vivo, mapaImgs) {
    if (e.k === 'traco') {
      if (!e.p || e.p.length < 2) return;
      c.save();
      c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = e.l; c.strokeStyle = e.cor;
      if (e.a < 1) { c.globalAlpha = e.a; if (!vivo) c.globalCompositeOperation = 'multiply'; }
      if (e.f) {   // forma: segmentos retos
        c.beginPath(); c.moveTo(e.p[0], e.p[1]);
        for (var i = 2; i < e.p.length; i += 2) c.lineTo(e.p[i], e.p[i + 1]);
      } else caminhoTraco(c, e.p);
      c.stroke();
      c.restore();
    } else if (e.k === 'texto') {
      c.save();
      c.fillStyle = e.cor || '#1a1a1a';
      c.font = fonteCanvas(e);
      c.textBaseline = 'top';
      linhasTexto(c, e).forEach(function (l, i) { c.fillText(l, e.x, e.y + i * e.tam * 1.3); });
      c.restore();
    } else if (e.k === 'img') {
      var im = mapaImgs ? mapaImgs[e.a] : imgs[e.a];
      if (im) c.drawImage(im, e.x, e.y, e.w, e.h);
      else if (mapaImgs) { c.fillStyle = '#eef0f3'; c.fillRect(e.x, e.y, e.w, e.h); }
      else {
        c.fillStyle = '#eef0f3'; c.fillRect(e.x, e.y, e.w, e.h);
        obterImagem(e.a, function () { if (E.pagina) Editor.render(); });
      }
    }
  }

  function linhasTexto(c, e) {
    c.font = fonteCanvas(e);
    var r = [];
    (e.t || '').split('\n').forEach(function (par) {
      var atual = '';
      par.split(' ').forEach(function (pal) {
        var teste = atual ? atual + ' ' + pal : pal;
        if (c.measureText(teste).width <= e.w || !atual) atual = teste;
        else { r.push(atual); atual = pal; }
      });
      r.push(atual);
    });
    return r;
  }

  function caixaDe(e) {
    if (e.k === 'texto') {
      var n = linhasTexto(cb2, e).length;
      return { x: e.x, y: e.y, w: e.w, h: Math.max(e.tam * 1.3, n * e.tam * 1.3) };
    }
    if (e.k === 'img') return { x: e.x, y: e.y, w: e.w, h: e.h };
    var p = e.p, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (var i = 0; i < p.length; i += 2) {
      x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
    }
    var m = e.l / 2;
    return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
  }

  function distSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = 0;
    if (l > 0) t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l));
    var qx = ax + t * dx - px, qy = ay + t * dy - py;
    return Math.sqrt(qx * qx + qy * qy);
  }
  function tocaTraco(e, x, y, raio) {
    var p = e.p, lim = raio + e.l / 2;
    if (p.length === 2) return distSeg(x, y, p[0], p[1], p[0], p[1]) <= lim;
    for (var i = 0; i < p.length - 2; i += 2) if (distSeg(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= lim) return true;
    return false;
  }
  function elementoEm(x, y) {
    var els = ordenados(E.pagina).reverse();
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e.k === 'traco') { if (tocaTraco(e, x, y, 8)) return e; }
      else { var b = caixaDe(e); if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return e; }
    }
    return null;
  }

  // ================================================================ toque / mouse
  var G = null;   // gesto em andamento

  function pontoDe(ev) {
    var r = $('area').getBoundingClientRect();
    return { cx: ev.clientX - r.left, cy: ev.clientY - r.top };
  }

  function inicio(cx, cy) {
    if (E.textoEdit) { Editor.fecharTexto(true); return; }
    var p = Editor.paraPagina(cx, cy), f = E.ferr;
    if (f === 'caneta' || f === 'marca') {
      var tipo = f;
      G = { tipo: 'traco', pts: [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10], sx: p.x, sy: p.y,
            cor: E.cor[tipo], l: ESPESSURAS[tipo][E.esp[tipo]], a: tipo === 'marca' ? 0.35 : 1, hx: cx, hy: cy };
      Editor.desenhando = true;
      agendarForma();
    } else if (f === 'borracha') {
      G = { tipo: 'borracha', apagados: {} };
      apagarEm(p.x, p.y);
    } else if (f === 'texto') {
      var alvo = elementoEm(p.x, p.y);
      if (alvo && alvo.k === 'texto') { Editor.abrirTexto(copia(alvo)); return; }
      Editor.abrirTexto({ id: novoId(), k: 'texto', c: agora(), x: Math.round(p.x), y: Math.round(p.y),
        w: Math.min(520, E.pagina.w - p.x - 20), t: '', tam: 26, cor: E.cor.caneta, fonte: Fontes.padrao || undefined });
    } else if (f === 'selecao') {
      // toque num item: seleciona e move; arrastar no vazio: laço em volta do que quer
      var sels = Editor.selecionados();
      if (sels.length) {
        var b = caixaDeVarios(sels), m = 6 / E.s;
        if (p.x >= b.x - m && p.x <= b.x + b.w + m && p.y >= b.y - m && p.y <= b.y + b.h + m) {
          G = { tipo: 'mover', els: sels.map(copia), x0: p.x, y0: p.y }; return;
        }
      }
      var e = elementoEm(p.x, p.y);
      if (e) { Editor.selecionar([e]); G = { tipo: 'mover', els: [copia(e)], x0: p.x, y0: p.y }; }
      else { Editor.desselecionar(); G = { tipo: 'laco', pts: [p.x, p.y] }; }
    }
  }

  function movimento(cx, cy) {
    if (!G) return;
    var p = Editor.paraPagina(cx, cy);
    if (G.tipo === 'traco') {
      if (G.forma) return;   // já virou forma: espera soltar
      if (Math.abs(cx - G.hx) + Math.abs(cy - G.hy) > 6) { G.hx = cx; G.hy = cy; agendarForma(); }
      var n = G.pts.length, lx = G.pts[n - 2], ly = G.pts[n - 1];
      // suaviza o tremido da caneta capacitiva
      var sx = G.sx + (p.x - G.sx) * 0.55, sy = G.sy + (p.y - G.sy) * 0.55;
      G.sx = sx; G.sy = sy;
      if (Math.abs(sx - lx) + Math.abs(sy - ly) < 1.2) return;
      G.pts.push(Math.round(sx * 10) / 10, Math.round(sy * 10) / 10);
      desenharVivo();
    } else if (G.tipo === 'borracha') {
      apagarEm(p.x, p.y);
    } else if (G.tipo === 'mover') {
      G.dx = p.x - G.x0; G.dy = p.y - G.y0;
      mostrarProvisorio(G.els, G.els.map(function (e) { return movido(e, G.dx, G.dy); }));
    } else if (G.tipo === 'redimensionar') {
      var f = Math.max(0.15, (G.b.w + (p.x - G.x0)) / G.b.w);
      G.novos = G.els.map(function (e) { return escalado(e, f, G.b.x, G.b.y); });
      mostrarProvisorio(G.els, G.novos);
    } else if (G.tipo === 'laco') {
      var k = G.pts.length;
      if (Math.abs(p.x - G.pts[k - 2]) + Math.abs(p.y - G.pts[k - 1]) < 3 / E.s) return;
      G.pts.push(Math.round(p.x), Math.round(p.y));
      desenharLaco(G.pts);
    } else if (G.tipo === 'arrastar') {
      E.px = G.px + (cx - G.cx); E.py = G.py + (cy - G.cy);
      transformarCanvas(cx - G.cx, cy - G.cy, 1);
    }
  }

  function fim() {
    if (!G) return;
    var g = G; G = null;
    clearTimeout(timerForma);
    if (g.tipo === 'traco') {
      Editor.desenhando = false;
      if (g.pts.length === 2) g.pts.push(g.pts[0] + 0.5, g.pts[1]);   // um ponto vira um pinguinho
      var el = { id: novoId(), k: 'traco', c: agora(), cor: g.cor, l: g.l, a: g.a, p: g.forma || g.pts };
      if (g.forma) el.f = 1;   // forma: lados retos, sem arredondar os cantos
      Editor.aplicar([{ antes: null, depois: el }]);
      Editor.limparVivo();
      Editor.desenharNaBase(E.pagina.els[el.id]);
    } else if (g.tipo === 'borracha') {
      Editor.limparVivo();
      var ids = chaves(g.apagados);
      if (ids.length) {
        // já estão marcados na página; registra como uma alteração só
        var mud = ids.map(function (id) { return { antes: g.apagados[id], depois: apagado(g.apagados[id]) }; });
        ids.forEach(function (id) { E.pagina.els[id] = g.apagados[id]; });
        Editor.aplicar(mud);
        Editor.render();
      }
    } else if (g.tipo === 'mover') {
      if (g.dx || g.dy) Editor.aplicar(g.els.map(function (e) { return { antes: e, depois: movido(e, g.dx || 0, g.dy || 0) }; }));
      Editor.render();
    } else if (g.tipo === 'redimensionar') {
      if (g.novos) Editor.aplicar(g.els.map(function (e, i) { return { antes: e, depois: g.novos[i] }; }));
      Editor.render();
    } else if (g.tipo === 'laco') {
      Editor.limparVivo();
      var poli = g.pts, achados = [];
      if (poli.length >= 8) ordenados(E.pagina).forEach(function (e) { if (noLaco(e, poli)) achados.push(e); });
      Editor.selecionar(achados);
    } else if (g.tipo === 'arrastar') {
      transformarCanvas(0, 0, 1); Editor.render();
    }
  }

  function cancelarGesto() {
    clearTimeout(timerForma);
    if (G && (G.tipo === 'traco' || G.tipo === 'laco')) { Editor.desenhando = false; Editor.limparVivo(); }
    if (G && (G.tipo === 'mover' || G.tipo === 'redimensionar')) Editor.render();
    if (G && G.tipo === 'borracha') {
      var ids = chaves(G.apagados);
      ids.forEach(function (id) { E.pagina.els[id] = G.apagados[id]; });
      Editor.render();
    }
    G = null;
  }

  function movido(el, dx, dy) {
    var n = copia(el);
    if (n.k === 'traco') { for (var i = 0; i < n.p.length; i += 2) { n.p[i] = Math.round((n.p[i] + dx) * 10) / 10; n.p[i + 1] = Math.round((n.p[i + 1] + dy) * 10) / 10; } }
    else { n.x = Math.round(n.x + dx); n.y = Math.round(n.y + dy); }
    return n;
  }
  function escalado(el, f, ox, oy) {
    var n = copia(el), r = function (v) { return Math.round(v * 10) / 10; };
    if (n.k === 'traco') { for (var i = 0; i < n.p.length; i += 2) { n.p[i] = r(ox + (n.p[i] - ox) * f); n.p[i + 1] = r(oy + (n.p[i + 1] - oy) * f); } }
    else {
      n.x = Math.round(ox + (n.x - ox) * f); n.y = Math.round(oy + (n.y - oy) * f); n.w = Math.max(10, Math.round(n.w * f));
      if (n.k === 'img') n.h = Math.max(10, Math.round(n.h * f));
      else n.tam = Math.max(8, Math.round(n.tam * f));
    }
    return n;
  }
  // desenha a página com os elementos na posição provisória (enquanto arrasta)
  function mostrarProvisorio(originais, provisorios) {
    provisorios.forEach(function (e) { E.pagina.els[e.id] = e; });
    Editor.render();
    originais.forEach(function (e) { E.pagina.els[e.id] = e; });
  }
  function caixaDeVarios(els) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    els.forEach(function (e) {
      var b = caixaDe(e);
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    });
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }
  function ehEscrita(e) { return e.k === 'traco' && !e.f && !(e.a < 1); }
  function noLaco(e, poli) {
    if (e.k === 'traco') {   // traço: pelo menos metade dos pontos dentro
      var n = 0, t = 0;
      for (var i = 0; i < e.p.length; i += 2) { t++; if (NotasGeo.dentro(e.p[i], e.p[i + 1], poli)) n++; }
      return t > 0 && n / t >= 0.5;
    }
    var b = caixaDe(e);
    return NotasGeo.dentro(b.x + b.w / 2, b.y + b.h / 2, poli);
  }
  function desenharLaco(p) {
    Editor.limparVivo();
    cv2.save();
    cv2.strokeStyle = '#2f6fde'; cv2.lineWidth = 1.5 / E.s;
    if (cv2.setLineDash) cv2.setLineDash([6 / E.s, 5 / E.s]);
    cv2.beginPath(); cv2.moveTo(p[0], p[1]);
    for (var i = 2; i < p.length; i += 2) cv2.lineTo(p[i], p[i + 1]);
    cv2.closePath(); cv2.stroke();
    cv2.fillStyle = 'rgba(47,111,222,.06)'; cv2.fill();
    cv2.restore();
  }

  // ---- segurar a caneta parada no fim do traço: vira forma regular
  var timerForma = null;
  function agendarForma() {
    clearTimeout(timerForma);
    var g = G;
    timerForma = setTimeout(function () {
      if (G !== g || !g || g.tipo !== 'traco' || g.forma) return;
      var r = NotasGeo.reconhecerForma(g.pts);
      if (!r) return;
      g.forma = r.p;
      Editor.limparVivo();
      desenharElemento(cv2, { k: 'traco', cor: g.cor, l: g.l, a: g.a, p: r.p, f: 1 }, true);
    }, 600);
  }

  function desenharVivo() {
    var p = G.pts;
    if (G.a < 1) {   // marca-texto: redesenha o traço todo (transparência uniforme)
      Editor.limparVivo();
      cv2.save(); cv2.globalAlpha = G.a; cv2.lineCap = 'round'; cv2.lineJoin = 'round';
      cv2.lineWidth = G.l; cv2.strokeStyle = G.cor; caminhoTraco(cv2, p); cv2.stroke(); cv2.restore();
      return;
    }
    // caneta: desenha só o pedaço novo
    var n = p.length;
    cv2.lineCap = 'round'; cv2.lineJoin = 'round'; cv2.lineWidth = G.l; cv2.strokeStyle = G.cor;
    cv2.beginPath();
    if (n >= 6) {
      cv2.moveTo((p[n - 6] + p[n - 4]) / 2, (p[n - 5] + p[n - 3]) / 2);
      cv2.quadraticCurveTo(p[n - 4], p[n - 3], (p[n - 4] + p[n - 2]) / 2, (p[n - 3] + p[n - 1]) / 2);
    } else { cv2.moveTo(p[0], p[1]); cv2.lineTo(p[n - 2], p[n - 1]); }
    cv2.stroke();
  }

  var rafBorracha = null;
  function apagarEm(x, y) {
    var pg = E.pagina, mudou = false;
    for (var k in pg.els) if (pg.els.hasOwnProperty(k)) {
      var e = pg.els[k];
      if (e.d || e.k !== 'traco' || G.apagados[k]) continue;
      if (tocaTraco(e, x, y, RAIO_BORRACHA)) { G.apagados[k] = e; pg.els[k] = apagado(e); mudou = true; }
    }
    if (mudou && !rafBorracha) rafBorracha = requestAnimationFrame(function () { rafBorracha = null; Editor.render(); desenharCirculo(x, y); });
    else if (!mudou) { Editor.limparVivo(); desenharCirculo(x, y); }
  }
  function desenharCirculo(x, y) {
    cv2.beginPath(); cv2.arc(x, y, RAIO_BORRACHA, 0, Math.PI * 2);
    cv2.strokeStyle = 'rgba(47,111,222,.8)'; cv2.lineWidth = 1.5 / E.s; cv2.stroke();
  }

  function transformarCanvas(dx, dy, esc) {
    var t = 'translate(' + dx + 'px,' + dy + 'px) scale(' + esc + ')';
    [base, vivo].forEach(function (c) { c.style.webkitTransform = t; c.style.transform = t; });
  }

  // ---- dois dedos: mover e ampliar ----
  var P = null;
  function inicioPinca(t1, t2) {
    cancelarGesto();
    var r = $('area').getBoundingClientRect();
    var mx = (t1.clientX + t2.clientX) / 2 - r.left, my = (t1.clientY + t2.clientY) / 2 - r.top;
    P = { d0: dist(t1, t2), mx: mx, my: my, zoom: E.zoom, ox: E.ox, oy: E.oy, s: E.s, esc: 1, dx: 0, dy: 0,
          ids: [t1.identifier, t2.identifier] };
  }
  function movePinca(t1, t2) {
    var r = $('area').getBoundingClientRect();
    var mx = (t1.clientX + t2.clientX) / 2 - r.left, my = (t1.clientY + t2.clientY) / 2 - r.top;
    var esc = Math.max(0.5 / P.zoom, Math.min(4 / P.zoom, dist(t1, t2) / P.d0));
    P.esc = esc; P.dx = mx - P.mx * esc; P.dy = my - P.my * esc; P.cmx = mx; P.cmy = my;
    transformarCanvas(P.dx, P.dy, esc);
  }
  function fimPinca() {
    var p = P; P = null;
    transformarCanvas(0, 0, 1);
    if (!p) return;
    // ponto da página sob o centro inicial dos dedos continua sob o centro final
    var pgx = (p.mx - p.ox) / p.s, pgy = (p.my - p.oy) / p.s;
    E.zoom = Math.max(0.5, Math.min(4, p.zoom * p.esc));
    var novoS = (E.W - 32) / E.pagina.w * E.zoom;
    var cmx = p.cmx === undefined ? p.mx : p.cmx, cmy = p.cmy === undefined ? p.my : p.cmy;
    E.px = cmx - pgx * novoS - 16; E.py = cmy - pgy * novoS - 16;
    Editor.render();
  }
  function dist(a, b) { var x = a.clientX - b.clientX, y = a.clientY - b.clientY; return Math.sqrt(x * x + y * y) || 1; }

  function iniciarRedimensionar(cx, cy) {
    var p = Editor.paraPagina(cx, cy), els = Editor.selecionados().map(copia);
    G = { tipo: 'redimensionar', els: els, b: caixaDeVarios(els), x0: p.x, y0: p.y };
  }

  function ligarEntrada() {
    var area = $('area');
    // Cada dedo é acompanhado pelo seu identificador:
    //  - toque que começa na faixa de pulso é ignorado (a mão pode ficar apoiada);
    //  - um 2º toque logo no começo (até 0,2 s) vira pinça (mover/ampliar);
    //  - um 2º toque depois disso (a mão encostando) é ignorado e o traço continua.
    var ignorados = {};
    function porId(lista, id) {
      for (var i = 0; i < lista.length; i++) if (lista[i].identifier === id) return lista[i];
      return null;
    }
    function validos(lista) {
      var r = [];
      for (var i = 0; i < lista.length; i++) if (!ignorados[lista[i].identifier]) r.push(lista[i]);
      return r;
    }
    area.addEventListener('touchstart', function (ev) {
      if (ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'BUTTON') return;
      ev.preventDefault();
      for (var i = 0; i < ev.changedTouches.length; i++) {
        var t = ev.changedTouches[i], q = pontoDe(t);
        if (ev.target.id === 'pulso-alca' && !G && !P) {
          G = { tipo: 'faixa', id: t.identifier, cx0: q.cx, cy0: q.cy, h0: Pulso.tamanho() }; continue;
        }
        if (Pulso.contem(q.cx, q.cy)) { ignorados[t.identifier] = 1; continue; }
        if (P) { ignorados[t.identifier] = 1; continue; }
        if (!G) {
          if (ev.target.id === 's-alca' && E.sel.length) iniciarRedimensionar(q.cx, q.cy);
          else inicio(q.cx, q.cy);
          if (G) { G.id = t.identifier; G.t0 = Date.now(); }
          continue;
        }
        // já há um gesto: pinça se o 2º dedo veio logo em seguida, senão é a mão encostando
        var outro = porId(ev.touches, G.id);
        var cedo = Date.now() - G.t0 < 200 && (G.tipo !== 'traco' || G.pts.length < 16);
        if (outro && cedo && G.tipo !== 'faixa' && G.tipo !== 'redimensionar') {
          inicioPinca(outro, t);
        } else ignorados[t.identifier] = 1;
      }
    }, false);
    area.addEventListener('touchmove', function (ev) {
      if (ev.target.tagName === 'TEXTAREA') return;
      ev.preventDefault();
      if (P) {
        var a = porId(ev.touches, P.ids[0]), b = porId(ev.touches, P.ids[1]);
        if (a && b) movePinca(a, b);
        return;
      }
      if (!G) return;
      var t = porId(ev.touches, G.id);
      if (!t) return;
      var q = pontoDe(t);
      if (G.tipo === 'faixa') { Pulso.arrastou(G, q.cx, q.cy); return; }
      movimento(q.cx, q.cy);
    }, false);
    function toqueFim(ev) {
      if (ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'BUTTON') return;
      ev.preventDefault();
      for (var i = 0; i < ev.changedTouches.length; i++) {
        var id = ev.changedTouches[i].identifier;
        delete ignorados[id];
        if (P && (P.ids[0] === id || P.ids[1] === id)) fimPinca();
        else if (G && G.id === id) {
          if (G.tipo === 'faixa') { G = null; Pulso.salvar(); }
          else fim();
        }
      }
      if (ev.type === 'touchcancel' && !ev.touches.length) { ignorados = {}; }
    }
    area.addEventListener('touchend', toqueFim, false);
    area.addEventListener('touchcancel', toqueFim, false);
    document.addEventListener('touchmove', function (ev) {
      if (telaAtual === 'editor' && ev.target.tagName !== 'TEXTAREA' && !ehRolavel(ev.target)) ev.preventDefault();
    }, false);

    // mouse (PC)
    var mouseDown = false;
    area.addEventListener('mousedown', function (ev) {
      if (ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'BUTTON') return;
      if (ev.target.id === 's-alca' && E.sel.length) {
        var pt = pontoDe(ev); iniciarRedimensionar(pt.cx, pt.cy); mouseDown = true; return;
      }
      mouseDown = true; var q = pontoDe(ev); inicio(q.cx, q.cy); ev.preventDefault();
    }, false);
    window.addEventListener('mousemove', function (ev) { if (mouseDown) { var q = pontoDe(ev); movimento(q.cx, q.cy); } }, false);
    window.addEventListener('mouseup', function () { if (mouseDown) { mouseDown = false; fim(); } }, false);
    area.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      if (ev.ctrlKey) { E.zoom = Math.max(0.5, Math.min(4, E.zoom * (ev.deltaY < 0 ? 1.1 : 0.9))); }
      else { E.px -= ev.deltaX; E.py -= ev.deltaY; }
      Editor.render();
    }, false);
  }
  function ehRolavel(el) {
    while (el) { if (el.className && /ferramentas|lista|rodape/.test(el.className)) return true; el = el.parentNode; }
    return false;
  }

  // ================================================================ miniaturas das páginas
  var Mini = {
    cache: {},   // id da página -> {versao, canvas}
    fila: [], ativo: false,
    versao: function (pg) {
      var v = (pg.u || 0) + ':' + pg.w + ':' + (pg.fundo || '') + ':' + (pg.pdf || ''), m = 0, n = 0;
      for (var k in pg.els) if (pg.els.hasOwnProperty(k)) { m = Math.max(m, pg.els[k].u || 0); n++; }
      return v + ':' + m + ':' + n;
    },
    abrir: function () {
      Editor.fecharTexto(true); Editor.desselecionar();
      E.paginas = paginasDe(E.cad.id);
      for (var i = 0; i < E.paginas.length; i++) if (E.pagina && E.paginas[i].id === E.pagina.id) E.idx = i;
      $('miniaturas').hidden = false;
      Mini.montar();
      var atual = $('m-grade').children[E.idx];
      if (atual) $('m-grade').scrollTop = Math.max(0, atual.offsetTop - 80);
    },
    fechar: function () {
      $('miniaturas').hidden = true; Mini.fila = [];
      E.paginas = paginasDe(E.cad.id);
      if (!E.paginas.length) E.paginas = [novaPagina(E.cad.id, 1, 'pautado')];
      Editor.irPara(Math.min(E.idx, E.paginas.length - 1));
    },
    montar: function () {
      var grade = $('m-grade'); grade.innerHTML = ''; Mini.fila = [];
      E.paginas.forEach(function (pg, i) {
        var it = document.createElement('div'); it.className = 'm-item' + (i === E.idx ? ' atual' : '');
        var cv = Mini.canvas(pg);
        var rod = document.createElement('div'); rod.className = 'm-rodape'; rod.textContent = String(i + 1);
        var mais = document.createElement('span'); mais.className = 'mais'; mais.textContent = '⋯'; rod.appendChild(mais);
        it.appendChild(cv); it.appendChild(rod);
        it.onclick = function (ev) {
          if (Mini.soltou) { Mini.soltou = false; return; }
          if (ev.target === mais) return Mini.menu(i);
          E.idx = i; Mini.fechar();
        };
        Mini.ligarArrasto(it, i);
        grade.appendChild(it);
      });
      var nova = document.createElement('div'); nova.className = 'm-item';
      var caixa = document.createElement('div'); caixa.className = 'm-nova'; caixa.textContent = '+ Página';
      nova.appendChild(caixa);
      nova.onclick = function () {
        var ult = E.paginas[E.paginas.length - 1];
        novaPagina(E.cad.id, ult ? ult.ord + 1 : 1, ult && !ult.pdf ? ult.fundo : 'pautado', ult ? ult.h > ult.w : false);
        E.paginas = paginasDe(E.cad.id); E.idx = E.paginas.length - 1; Mini.montar();
        $('m-grade').scrollTop = $('m-grade').scrollHeight;
      };
      grade.appendChild(nova);
      // desenha primeiro as páginas perto da atual
      Mini.fila.sort(function (a, b) { return Math.abs(a.i - E.idx) - Math.abs(b.i - E.idx); });
      if (!Mini.ativo) Mini.proxima();
    },
    canvas: function (pg) {
      var c = Mini.cache[pg.id], v = Mini.versao(pg);
      if (c && c.versao === v) return c.canvas;
      var cv = document.createElement('canvas'), esc = Math.min(1.5, window.devicePixelRatio || 1);
      cv.width = Math.round(160 * esc); cv.height = Math.round(160 * esc * pg.h / pg.w);
      Mini.cache[pg.id] = { versao: v, canvas: cv };
      Mini.fila.push({ pg: pg, cv: cv, i: E.paginas.indexOf(pg) });
      return cv;
    },
    proxima: function () {
      var t = Mini.fila.shift();
      if (!t) { Mini.ativo = false; return; }
      Mini.ativo = true;
      Mini.desenhar(t.pg, t.cv, function () { setTimeout(Mini.proxima, 0); });
    },
    desenhar: function (pg, cv, cb) {
      var ids = [];
      if (pg.pdf) ids.push(pg.pdf);
      ordenados(pg).forEach(function (e) { if (e.k === 'img') ids.push(e.a); });
      var mapa = {}, falta = ids.length;
      function pintar() {
        var c = cv.getContext('2d'), k = cv.width / pg.w;
        c.setTransform(k, 0, 0, k, 0, 0);
        c.fillStyle = '#fff'; c.fillRect(0, 0, pg.w, pg.h);
        if (pg.pdf && mapa[pg.pdf]) c.drawImage(mapa[pg.pdf], 0, 0, pg.w, pg.h);
        desenharFundo(c, pg);
        // traço fino some na miniatura: engrossa só aqui
        var minimo = 1.4 / k;
        ordenados(pg).forEach(function (e) {
          if (e.k === 'traco' && e.l < minimo) { e = copia(e); e.l = minimo; }
          desenharElemento(c, e, false, mapa);
        });
        cb();
      }
      if (!falta) return pintar();
      ids.forEach(function (id) {
        obterImagem(id, function (im) { mapa[id] = im; if (--falta === 0) pintar(); }, true);
      });
    },
    // nova ordem: a página de "de" vai para a posição "para" (índices de E.paginas)
    mover: function (de, para) {
      if (para === de || para === de + 1) return;
      var lista = E.paginas.slice(), pg = lista[de];
      lista.splice(de, 1);
      var pos = para > de ? para - 1 : para;
      lista.splice(pos, 0, pg);
      var ant = lista[pos - 1], prox = lista[pos + 1], ord;
      if (ant && prox) ord = (ant.ord + prox.ord) / 2;
      else if (ant) ord = ant.ord + 1;
      else ord = prox ? prox.ord - 1 : 1;
      if ((ant && ord <= ant.ord) || (prox && ord >= prox.ord)) {   // sem espaço entre os números: renumera
        lista.forEach(function (p, i) { var n = copia(D.ents[p.id] || p); n.ord = i + 1; n.u = agora(); alterado(n); });
      } else { var n = copia(D.ents[pg.id] || pg); n.ord = ord; n.u = agora(); alterado(n); }
      var atualId = E.paginas[E.idx] && E.paginas[E.idx].id;
      E.paginas = paginasDe(E.cad.id);
      for (var i = 0; i < E.paginas.length; i++) if (E.paginas[i].id === atualId) E.idx = i;
      Mini.montar();
    },
    menu: function (i) {
      var pg = E.paginas[i];
      var acoes = [
        { texto: 'Duplicar', acao: function () {
          var n = copia(D.ents[pg.id] || pg), prox = E.paginas[i + 1], els = {};
          n.id = novoId(); n.ord = prox ? (pg.ord + prox.ord) / 2 : pg.ord + 1; n.u = agora(); n.lix = 0;
          for (var k in n.els) if (n.els.hasOwnProperty(k) && !n.els[k].d) { var e = n.els[k]; e.id = novoId(); e.u = agora(); els[e.id] = e; }
          n.els = els; alterado(n);
          E.paginas = paginasDe(E.cad.id); Mini.montar(); aviso('Página duplicada.');
        } }
      ];
      if (i > 0) acoes.push({ texto: '◀ Para trás', acao: function () { Mini.mover(i, i - 1); } });
      if (i < E.paginas.length - 1) acoes.push({ texto: 'Para frente ▶', acao: function () { Mini.mover(i, i + 2); } });
      acoes.push({ texto: 'Lixeira', acao: function () {
        Lixeira.mover(D.ents[pg.id] || pg);
        E.paginas = paginasDe(E.cad.id);
        if (!E.paginas.length) E.paginas = [novaPagina(E.cad.id, 1, 'pautado')];
        if (E.idx >= E.paginas.length) E.idx = E.paginas.length - 1;
        Mini.montar(); aviso('Página na lixeira.');
      } });
      acoes.push({ texto: 'Fechar', primario: true });
      modal('Página ' + (i + 1), acoes);
    },
    // segurar ~0,35 s e arrastar muda a ordem; mexer antes disso rola a lista
    ligarArrasto: function (it, i) {
      var t0 = null, timer = null, arr = null;
      function limpar() {
        clearTimeout(timer); timer = null;
        var it2 = $('m-grade').querySelectorAll('.m-item');
        for (var k = 0; k < it2.length; k++) it2[k].className = it2[k].className.replace(/ ?(alvo-fim|alvo|arrastando)/g, '');
        it.style.webkitTransform = it.style.transform = '';
      }
      function alvo(x, y) {
        var itens = $('m-grade').querySelectorAll('.m-item'), melhor = E.paginas.length, md = 1e9;
        for (var k = 0; k < E.paginas.length; k++) {
          if (k === i) continue;   // a própria miniatura acompanha o dedo
          var r = itens[k].getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          var d = Math.abs(cy - y) * 3 + Math.abs(cx - x);
          if (d < md) { md = d; melhor = x < cx ? k : k + 1; }
        }
        return melhor;
      }
      it.addEventListener('touchstart', function (ev) {
        if (ev.touches.length > 1) return;
        var t = ev.touches[0]; t0 = { x: t.clientX, y: t.clientY };
        timer = setTimeout(function () { arr = { x: t0.x, y: t0.y, para: i }; it.className += ' arrastando'; }, 350);
      }, false);
      it.addEventListener('touchmove', function (ev) {
        var t = ev.touches[0];
        if (!arr) { if (t0 && Math.abs(t.clientX - t0.x) + Math.abs(t.clientY - t0.y) > 10) clearTimeout(timer); return; }
        ev.preventDefault();
        var tr = 'translate(' + (t.clientX - arr.x) + 'px,' + (t.clientY - arr.y) + 'px)';
        it.style.webkitTransform = it.style.transform = tr;
        arr.para = alvo(t.clientX, t.clientY);
        var itens = $('m-grade').querySelectorAll('.m-item');
        for (var k = 0; k < itens.length; k++) itens[k].className = itens[k].className.replace(/ ?(alvo-fim|alvo)\b/g, '');
        if (arr.para < E.paginas.length) itens[arr.para].className += ' alvo';
        else itens[E.paginas.length - 1].className += ' alvo alvo-fim';
      }, false);
      function fimToque() {
        var a = arr; arr = null; limpar();
        if (a) { Mini.soltou = true; setTimeout(function () { Mini.soltou = false; }, 400); Mini.mover(i, a.para); }
      }
      it.addEventListener('touchend', fimToque, false);
      it.addEventListener('touchcancel', function () { arr = null; limpar(); }, false);
    }
  };

  // ================================================================ faixa de pulso
  // Faixa embaixo da tela onde a mão pode ficar apoiada (serve para as duas mãos).
  // lado: 'direita' | 'esquerda' (faixa em pé, o padrão) ou 'baixo'. Tamanho guardado por lado.
  var LADOS = [['direita', '▐ Direita'], ['esquerda', '▌ Esquerda'], ['baixo', '▄ Embaixo']];
  var Pulso = {
    carregar: function () {
      E.pulso = { ativo: false, lado: 'direita', tam: {} };
      try {
        var v = JSON.parse(localStorage.getItem('an-pulso') || 'null');
        if (v) { E.pulso.ativo = !!v.ativo; E.pulso.lado = v.lado || 'direita'; E.pulso.tam = v.tam || {}; if (v.altura && !v.tam) E.pulso.tam.baixo = v.altura; }
      } catch (e) {}
    },
    salvar: function () { try { localStorage.setItem('an-pulso', JSON.stringify(E.pulso)); } catch (e) {} },
    vertical: function () { return E.pulso.lado !== 'baixo'; },
    tamanho: function () {
      var t = E.pulso.tam[E.pulso.lado];
      return t || Math.round(Pulso.vertical() ? E.W * 0.26 : E.H * 0.3);
    },
    contem: function (cx, cy) {
      if (!E.pulso.ativo) return false;
      var t = Pulso.tamanho(), l = E.pulso.lado;
      return l === 'baixo' ? cy >= E.H - t : (l === 'direita' ? cx >= E.W - t : cx <= t);
    },
    // arrastar a alça: quanto o dedo andou "para dentro" da tela
    arrastou: function (g, cx, cy) {
      var l = E.pulso.lado, d = l === 'baixo' ? g.cy0 - cy : (l === 'direita' ? g.cx0 - cx : cx - g.cx0);
      Pulso.ajustar(g.h0 + d);
    },
    ajustar: function (h) {
      var max = (Pulso.vertical() ? E.W : E.H) * 0.6;
      E.pulso.tam[E.pulso.lado] = Math.round(Math.max(70, Math.min(max, h)));
      Pulso.mostrar();
    },
    mostrar: function () {
      var f = $('pulso'), t = Pulso.tamanho();
      f.className = 'pulso pulso-' + E.pulso.lado;
      f.style.width = Pulso.vertical() ? t + 'px' : '';
      f.style.height = Pulso.vertical() ? '' : t + 'px';
      f.hidden = !E.pulso.ativo;
      $('p-pulso').className = 'botao' + (E.pulso.ativo ? ' ligado' : '');
    },
    menu: function () {
      var acoes = LADOS.map(function (l) {
        return { texto: l[1], primario: E.pulso.ativo && E.pulso.lado === l[0], acao: function () {
          E.pulso.ativo = true; E.pulso.lado = l[0]; Pulso.mostrar(); Pulso.salvar();
          aviso('Apoie a mão na faixa. Arraste a borda dela para mudar o tamanho.', 3000);
        } };
      });
      acoes.push({ texto: 'Desligar', primario: !E.pulso.ativo, acao: function () { E.pulso.ativo = false; Pulso.mostrar(); Pulso.salvar(); } });
      modal('Proteção de pulso: onde a mão fica apoiada?', acoes);
    }
  };

  function dicaUmaVez(chave, txt) {
    try { if (localStorage.getItem(chave)) return; localStorage.setItem(chave, '1'); } catch (e) { return; }
    aviso(txt, 7000);
  }

  // ================================================================ área de transferência
  // Guardada no aparelho: dá para colar em outra página ou outro caderno.
  var Clip = {
    els: null, pag: null, desloc: 0,
    carregar: function () {
      try { var v = JSON.parse(localStorage.getItem('an-clip') || 'null'); if (v && v.els) { Clip.els = v.els; Clip.pag = v.pag; } } catch (e) {}
    },
    copiar: function (els, recorte) {
      if (!els.length) return;
      Clip.els = els.map(copia).sort(function (a, b) { return (a.c - b.c) || (a.id < b.id ? -1 : 1); });
      Clip.els.forEach(function (e) { delete e.u; delete e.d; });
      Clip.pag = E.pagina.id;
      Clip.desloc = recorte ? 0 : 24;   // recortar e colar na mesma página: volta para o mesmo lugar
      try { localStorage.setItem('an-clip', JSON.stringify({ els: Clip.els, pag: Clip.pag })); } catch (e) {}
      Editor.atualizarBotoes();
    },
    colar: function () {
      if (!Clip.els || !Clip.els.length || !E.pagina) return;
      var pg = E.pagina, b = caixaDeVarios(Clip.els), dx, dy;
      if (Clip.pag === pg.id) { dx = dy = Clip.desloc; Clip.desloc += 24; }
      else {
        var c = Editor.paraPagina(E.W / 2, E.H / 2);
        dx = c.x - (b.x + b.w / 2); dy = c.y - (b.y + b.h / 2);
      }
      // dentro da folha
      if (b.w < pg.w) dx = Math.max(-b.x + 4, Math.min(pg.w - b.x - b.w - 4, dx));
      if (b.h < pg.h) dy = Math.max(-b.y + 4, Math.min(pg.h - b.y - b.h - 4, dy));
      var ordem = agora();
      var novos = Clip.els.map(function (e, i) { var n = movido(e, dx, dy); n.id = novoId(); n.c = ordem + i; return n; });
      Editor.aplicar(novos.map(function (n) { return { antes: null, depois: n }; }));
      E.ferr = 'selecao'; Editor.atualizarBotoes();
      Editor.selecionar(novos); Editor.render();
    }
  };

  // ================================================================ botões do editor
  function ligarBotoes() {
    var fs = document.querySelectorAll('.ferr');
    for (var i = 0; i < fs.length; i++) fs[i].onclick = function () {
      var f = this.getAttribute('data-f');
      Editor.fecharTexto(true);
      if (f !== 'selecao') Editor.desselecionar();
      if (f === 'imagem') { $('arquivo-img').value = ''; $('arquivo-img').click(); return; }
      E.ferr = f; Editor.atualizarBotoes();
    };
    $('e-voltar').onclick = function () { Editor.fecharTexto(true); Editor.desselecionar(); Sala.fechar(); mostrarBiblioteca(); sincronizar(); Sala.enviar(); };
    $('e-desfazer').onclick = function () { Editor.fecharTexto(true); Editor.desfazer(); };
    $('e-refazer').onclick = function () { Editor.fecharTexto(true); Editor.refazer(); };
    $('e-mais').onclick = function () { zoomCentro(1.25); };
    $('e-menos').onclick = function () { zoomCentro(0.8); };
    $('e-exportar').onclick = function () { Editor.fecharTexto(true); exportar(E.cad); };
    $('p-pulso').onclick = function () { Pulso.menu(); };
    $('p-num').onclick = function () { Mini.abrir(); };
    $('m-fechar').onclick = function () { Mini.fechar(); };
    $('p-ant').onclick = function () { Editor.irPara(E.idx - 1); };
    $('p-prox').onclick = function () { Editor.irPara(E.idx + 1); };
    $('p-nova').onclick = function () {
      Editor.fecharTexto(true);
      var atual = E.pagina, prox = E.paginas[E.idx + 1];
      var ord = prox ? (atual.ord + prox.ord) / 2 : atual.ord + 1;
      var p = novaPagina(E.cad.id, ord, atual.pdf ? 'pautado' : atual.fundo, atual.h > atual.w);
      E.paginas = paginasDe(E.cad.id);
      Editor.irPara(E.paginas.indexOf(p));
    };
    $('p-fundo').onclick = function () {
      var acoes = FUNDOS.map(function (f) {
        return { texto: f[1], primario: f[0] === E.pagina.fundo, acao: function () {
          Editor.atualizarPagina();
          var pg = copia(E.pagina); pg.fundo = f[0]; pg.u = agora();
          E.pagina = pg; E.paginas[E.idx] = pg; alterado(pg); Editor.atualizarBotoes(); Editor.render();
        } };
      });
      if (!E.pagina.pdf) {
        var emPe = E.pagina.h > E.pagina.w;
        acoes.push({ texto: '↔ Deitada', primario: !emPe, acao: function () { orientar(false); } });
        acoes.push({ texto: '↕ Em pé', primario: emPe, acao: function () { orientar(true); } });
      }
      modal('Fundo e posição da folha', acoes);
    };
    function orientar(emPe) {
      Editor.atualizarPagina();
      var pg = copia(E.pagina);
      if ((pg.h > pg.w) === emPe) return;
      var w = pg.w; pg.w = pg.h; pg.h = w; pg.u = agora();
      E.pagina = pg; E.paginas[E.idx] = pg; alterado(pg);
      E.zoom = zoomInicial(); E.px = 0; E.py = 0;
      Editor.render();
    }
    $('p-apagar').onclick = function () {
      if (!confirm('Mandar esta página para a lixeira?')) return;
      Editor.atualizarPagina();
      Lixeira.mover(E.pagina);
      aviso('Página na lixeira (tela de cadernos → Lixeira).', 3000);
      E.paginas = paginasDe(E.cad.id);
      if (!E.paginas.length) E.paginas = [novaPagina(E.cad.id, 1, 'pautado')];
      Editor.irPara(Math.min(E.idx, E.paginas.length - 1));
    };
    $('s-apagar').onclick = function () {
      var els = Editor.selecionados(); if (!els.length) return;
      Editor.desselecionar(); Editor.aplicar(els.map(function (el) { return { antes: el, depois: apagado(el) }; })); Editor.render();
    };
    $('s-editar').onclick = function () {
      var el = Editor.selecionados()[0]; if (!el) return;
      Editor.desselecionar(); Editor.abrirTexto(copia(el));
    };
    $('s-copiar').onclick = function () { Clip.copiar(Editor.selecionados(), false); aviso('Copiado. Toque em Colar (aqui ou em outra página).'); };
    $('s-recortar').onclick = function () {
      var els = Editor.selecionados(); if (!els.length) return;
      Clip.copiar(els, true); $('s-apagar').onclick();
    };
    $('e-colar').onclick = function () { Editor.fecharTexto(true); Clip.colar(); };
    $('s-endireitar').onclick = function () {
      var els = Editor.selecionados().filter(ehEscrita);
      if (!els.length) return;
      var pg = E.pagina, pauta = pg.fundo === 'pautado' && !pg.pdf ? { y0: 120, passo: 32 } : null;
      var novos = NotasGeo.endireitar(els.map(copia), { pauta: pauta });
      if (!novos.length) return;
      Editor.aplicar(novos.map(function (n) { return { antes: pg.els[n.id], depois: n }; }));
      Editor.render();
      aviso('Letra endireitada. ↶ desfaz.');
    };
    $('e-ajustar').onclick = function () {
      var aj = zoomAjuste();
      E.zoom = Math.abs(E.zoom - aj) < 0.01 ? 1 : aj; E.px = 0; E.py = 0;
      Editor.render();
    };
    $('t-ok').onclick = function () { Editor.fecharTexto(true); };
    $('t-maior').onclick = function () { mudarTam(1.2); };
    $('t-menor').onclick = function () { mudarTam(1 / 1.2); };
    $('e-importar').onclick = function () { Editor.fecharTexto(true); $('arquivo-imp-e').value = ''; $('arquivo-imp-e').click(); };
    $('arquivo-imp-e').onchange = function () {
      var f = this.files && this.files[0]; if (!f) return;
      if (ehImagem(f)) return lerImagem(f, true);   // imagem entra na página (funciona sem o PC)
      // PDF/slides: viram páginas logo depois desta
      var atual = E.pagina, prox = E.paginas[E.idx + 1];
      enviarImportacao(f, { caderno: E.cad.id, apos: atual.ord, ate: prox ? prox.ord : null }, function (r) {
        if (telaAtual !== 'editor' || !E.cad || E.cad.id !== r.caderno) return;
        E.paginas = paginasDe(E.cad.id);
        for (var i = 0; i < E.paginas.length; i++) if (E.paginas[i].id === r.primeira) return Editor.irPara(i);
      });
    };
    function lerImagem(f, registrar) {
      var fr = new FileReader();
      fr.onerror = function () {
        if (registrar) registrarImportacao(f, 'ilegivel');
        aviso('O iPad não deixou ler essa imagem. Se ela está no iCloud Drive, abra-a lá uma vez e tente de novo.', 7000);
      };
      fr.onload = function () {
        var im = new Image();
        im.onload = function () { inserirImagem(im); };
        im.onerror = function () { aviso('Não consegui abrir essa imagem.'); };
        im.src = fr.result;
      };
      fr.readAsDataURL(f);
    }
    $('arquivo-img').onchange = function () { var f = this.files && this.files[0]; if (f) lerImagem(f); };
    window.addEventListener('resize', function () {
      if (telaAtual !== 'editor') return;
      setTimeout(function () { Editor.medir(); Pulso.mostrar(); Editor.render(); }, 250);
    }, false);
    document.addEventListener('keydown', function (ev) {
      if (telaAtual !== 'editor' || E.textoEdit) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z') { ev.preventDefault(); ev.shiftKey ? Editor.refazer() : Editor.desfazer(); }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'y') { ev.preventDefault(); Editor.refazer(); }
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && E.sel.length) $('s-apagar').onclick();
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'c' && E.sel.length) $('s-copiar').onclick();
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'x' && E.sel.length) $('s-recortar').onclick();
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'v') Clip.colar();
    }, false);
  }

  function mudarTam(f) {
    var el = E.textoEdit; if (!el) return;
    el.tam = Math.max(10, Math.min(120, Math.round(el.tam * f)));
    $('t-texto').style.fontSize = Math.max(10, el.tam * E.s) + 'px';
  }

  // zoom que mostra a página inteira (1 = largura da tela)
  function zoomAjuste() {
    var pg = E.pagina; if (!pg || !E.W) return 1;
    var sLarg = (E.W - 32) / pg.w;
    return Math.min(1, (E.H - 32) / (pg.h * sLarg));
  }
  // folha deitada já quase cabe: mostra inteira; folha em pé: pela largura
  function zoomInicial() { var a = zoomAjuste(); return a > 0.8 ? a : 1; }

  function zoomCentro(f) {
    var cx = E.W / 2, cy = E.H / 2, pgx = (cx - E.ox) / E.s, pgy = (cy - E.oy) / E.s;
    E.zoom = Math.max(0.5, Math.min(4, E.zoom * f));
    var novoS = (E.W - 32) / E.pagina.w * E.zoom;
    E.px = cx - pgx * novoS - 16; E.py = cy - pgy * novoS - 16;
    Editor.render();
  }

  function inserirImagem(im) {
    // reduz para no máximo 1200 px (cabe no iPad e sincroniza rápido)
    var esc = Math.min(1, 1200 / Math.max(im.width, im.height));
    var w = Math.max(1, Math.round(im.width * esc)), h = Math.max(1, Math.round(im.height * esc));
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h);
    var url = c.toDataURL('image/jpeg', 0.82), id = novoId();
    guardarImagem(id, url);
    var pw = Math.min(600, E.pagina.w * 0.6), ph = Math.round(pw * h / w);
    var centro = Editor.paraPagina(E.W / 2, E.H / 2);
    var el = { id: novoId(), k: 'img', c: agora(), a: id, x: Math.round(Math.max(10, centro.x - pw / 2)),
               y: Math.round(Math.max(10, centro.y - ph / 2)), w: Math.round(pw), h: ph };
    var nova = new Image();
    nova.onload = function () {
      imgs[id] = nova;
      Editor.aplicar([{ antes: null, depois: el }]);
      E.ferr = 'selecao'; Editor.atualizarBotoes();
      Editor.selecionar([E.pagina.els[el.id]]); Editor.render();
    };
    nova.src = url;
  }

  // ================================================================ app offline (cache do Safari)
  // Mostra na tela de cadernos se o app está guardado para abrir sem o PC, e conta ao PC
  // (aparece em anotacoes.log), para dar para diagnosticar.
  function vigiarCacheApp() {
    var ac = window.applicationCache, el = $('offline-b');
    function mostrar(txt, cls) { el.textContent = txt; el.className = 'offline-info ' + (cls || ''); }
    function contar(evento) {
      if (Sync.semPC) return;
      xhr('POST', '/api/registro', JSON.stringify({ evento: evento, cache: ac ? ac.status : 'sem suporte',
        armazenamento: Arm.tipo, tela_inicio: !!window.navigator.standalone }), 'application/json', function () {});
    }
    if (!ac) { mostrar(''); return; }   // navegadores novos não têm esse cache (só o iPad antigo usa)
    var nomes = ['não guardado', 'guardado ✓', 'verificando…', 'baixando…', 'versão nova', 'obsoleto'];
    mostrar('Offline: ' + (nomes[ac.status] || ac.status), ac.status === 1 ? 'ok' : '');
    ac.addEventListener('checking', function () { mostrar('Offline: verificando…'); }, false);
    ac.addEventListener('downloading', function () { mostrar('Offline: baixando…'); }, false);
    ac.addEventListener('progress', function (e) {
      if (e && e.total) mostrar('Offline: baixando ' + e.loaded + '/' + e.total);
    }, false);
    ac.addEventListener('noupdate', function () { mostrar('Offline: guardado ✓', 'ok'); contar('guardado'); }, false);
    ac.addEventListener('cached', function () { mostrar('Offline: guardado ✓', 'ok'); contar('guardou-agora'); }, false);
    ac.addEventListener('obsolete', function () { mostrar('Offline: removido', 'erro'); contar('obsoleto'); }, false);
    ac.addEventListener('error', function () {
      // sem o PC também dá "error" (não conseguiu conferir); só é problema se nunca guardou
      if (ac.status === 1) mostrar('Offline: guardado ✓', 'ok');
      else { mostrar('Offline: erro ao guardar', 'erro'); contar('erro'); }
    }, false);
    ac.addEventListener('updateready', function () {
      try { ac.swapCache(); } catch (x) {}
      contar('versao-nova');
      if (telaAtual === 'biblioteca') location.reload();
      else aviso('Versão nova do app baixada: ela entra ao voltar para os cadernos.', 4000);
    }, false);
  }

  // ================================================================ início
  function iniciar() {
    base = $('c-base'); vivo = $('c-vivo');
    cb2 = base.getContext('2d'); cv2 = vivo.getContext('2d');
    Pulso.carregar(); Clip.carregar(); Fontes.iniciar(); Fontes.montarSeletor();
    ligarEntrada(); ligarBotoes();
    Arm.iniciar(function () {
      carregar(function () {
        mostrarBiblioteca();
        cicloSync();
        Sala.enviar();
        var m = location.search.match(/[?&]sala=([A-Za-z0-9]{6})/);
        if (m) setTimeout(function () { Sala.entrarComCodigo(m[1].toUpperCase()); }, 300);
      });
    });
    vigiarCacheApp();
    window.__notas = { Mini: Mini, Bib: Bib, Pulso: Pulso, Clip: Clip, D: D, E: E, Editor: Editor, sincronizar: sincronizar, Arm: Arm, mesclar: mesclar, Sala: Sala, Sync: Sync }; // para testes
  }
  iniciar();
})();
