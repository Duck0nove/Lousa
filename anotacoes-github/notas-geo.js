// Anotações — geometria (ES5): reconhecer formas e endireitar a letra.
// Funções puras sobre traços {p:[x,y,x,y,...], l, a, f}. Também carrega no Node (testes).
(function (raiz) {
  var PI = Math.PI;

  function pares(p) { var r = []; for (var i = 0; i + 1 < p.length; i += 2) r.push([p[i], p[i + 1]]); return r; }
  function plano(v) { var r = []; for (var i = 0; i < v.length; i++) r.push(Math.round(v[i][0] * 10) / 10, Math.round(v[i][1] * 10) / 10); return r; }
  function d(a, b) { var x = a[0] - b[0], y = a[1] - b[1]; return Math.sqrt(x * x + y * y); }
  function compr(v) { var s = 0; for (var i = 1; i < v.length; i++) s += d(v[i - 1], v[i]); return s; }
  function caixa(v) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (var i = 0; i < v.length; i++) { x0 = Math.min(x0, v[i][0]); x1 = Math.max(x1, v[i][0]); y0 = Math.min(y0, v[i][1]); y1 = Math.max(y1, v[i][1]); }
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0, diag: Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)) };
  }
  function mediana(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function quantil(s, q) {   // s já ordenado
    if (!s.length) return 0;
    var i = Math.max(0, Math.min(s.length - 1, Math.round(q * (s.length - 1))));
    return s[i];
  }
  function distSeg(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = 0;
    if (l > 0) t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l));
    var qx = a[0] + t * dx - p[0], qy = a[1] + t * dy - p[1];
    return Math.sqrt(qx * qx + qy * qy);
  }

  // n pontos igualmente espaçados ao longo do traço
  function reamostrar(v, n) {
    var L = compr(v), passo = L / (n - 1), r = [v[0].slice()], acum = 0, i = 1, ant = v[0].slice();
    if (L <= 0) return r;
    while (i < v.length && r.length < n) {
      var seg = d(ant, v[i]);
      if (acum + seg >= passo && seg > 0) {
        var t = (passo - acum) / seg, q = [ant[0] + t * (v[i][0] - ant[0]), ant[1] + t * (v[i][1] - ant[1])];
        r.push(q); ant = q; acum = 0;
      } else { acum += seg; ant = v[i]; i++; }
    }
    while (r.length < n) r.push(v[v.length - 1].slice());
    return r;
  }

  // Douglas-Peucker: índices dos vértices
  function dp(v, eps) {
    var manter = [0, v.length - 1];
    function rec(i, j) {
      var maior = -1, k = -1;
      for (var m = i + 1; m < j; m++) { var x = distSeg(v[m], v[i], v[j]); if (x > maior) { maior = x; k = m; } }
      if (maior > eps) { manter.push(k); rec(i, k); rec(k, j); }
    }
    rec(0, v.length - 1);
    return manter.sort(function (a, b) { return a - b; });
  }

  function anguloDe(a, b) { return Math.atan2(b[1] - a[1], b[0] - a[0]); }
  // aproxima de múltiplos de 45° quando está perto
  // 0°/90° com a tolerância dada; 45° só quando está bem perto
  function ajustarAngulo(t, tol) {
    var m = Math.round(t / (PI / 2)) * (PI / 2);
    if (Math.abs(t - m) <= tol) return m;
    m = Math.round(t / (PI / 4)) * (PI / 4);
    return Math.abs(t - m) <= tol * 0.5 ? m : t;
  }
  var GRAU = PI / 180;

  // reta que passa pelos pontos (PCA): {c:[x,y], t:ângulo}
  function ajustarReta(v) {
    var mx = 0, my = 0, i;
    for (i = 0; i < v.length; i++) { mx += v[i][0]; my += v[i][1]; }
    mx /= v.length; my /= v.length;
    var sxx = 0, syy = 0, sxy = 0;
    for (i = 0; i < v.length; i++) { var x = v[i][0] - mx, y = v[i][1] - my; sxx += x * x; syy += y * y; sxy += x * y; }
    return { c: [mx, my], t: 0.5 * Math.atan2(2 * sxy, sxx - syy) };
  }
  function cruzar(r1, r2) {
    var c1 = Math.cos(r1.t), s1 = Math.sin(r1.t), c2 = Math.cos(r2.t), s2 = Math.sin(r2.t);
    var det = c1 * s2 - s1 * c2;
    if (Math.abs(det) < 0.15) return null;   // quase paralelas
    var dx = r2.c[0] - r1.c[0], dy = r2.c[1] - r1.c[1];
    var t = (dx * s2 - dy * c2) / det;
    return [r1.c[0] + t * c1, r1.c[1] + t * s1];
  }

  function poligonoRegular(k, c, R, fi) {
    var r = [];
    for (var i = 0; i < k; i++) { var a = fi + 2 * PI * i / k; r.push([c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)]); }
    return r;
  }
  function fechar(v) { var r = v.slice(); r.push(v[0].slice()); return r; }

  function linha(a, b) {
    var t = ajustarAngulo(anguloDe(a, b), 6 * GRAU), L = d(a, b);
    return [a, [a[0] + L * Math.cos(t), a[1] + L * Math.sin(t)]];
  }

  // ---------------------------------------------------------------- formas
  // Recebe os pontos do traço; devolve os pontos da forma regular, ou null se não parece forma.
  function reconhecerForma(p) {
    var v = pares(p);
    if (v.length < 4) return null;
    var cx = caixa(v);
    if (cx.diag < 14) return null;
    var L = compr(v), r = reamostrar(v, 64), pontas = d(r[0], r[r.length - 1]);

    if (pontas / L > 0.94) return { tipo: 'linha', p: plano(linha(r[0], r[r.length - 1])) };

    var fechada = pontas < Math.max(0.2 * L, 0.25 * cx.diag);
    if (!fechada) {
      var iv = dp(r, 0.06 * cx.diag);
      if (iv.length > 4) return null;
      var verts = iv.map(function (i) { return r[i]; });
      var erro = 0;
      for (var m = 0; m < r.length; m++) {
        var mn = 1e9;
        for (var s = 0; s + 1 < verts.length; s++) mn = Math.min(mn, distSeg(r[m], verts[s], verts[s + 1]));
        erro += mn;
      }
      if (erro / r.length > 0.025 * cx.diag) return null;
      // segmentos quase horizontais/verticais/45° ficam exatos
      var saida = [verts[0]];
      for (var j = 1; j < verts.length; j++) saida.push(linha(saida[j - 1], verts[j])[1]);
      return { tipo: 'linhas', p: plano(saida) };
    }

    // ---- fechada: elipse ou polígono? fica a que se encaixa melhor
    var el = ajustarElipse(r), pol = ajustarPoligono(r, cx);
    var usarPol = pol && (!el || pol.erro < el.erro);
    if (usarPol) return { tipo: pol.tipo, p: plano(fechar(pol.v)) };
    if (el && el.erroRel < 0.16) return { tipo: el.tipo, p: plano(el.v) };
    return null;
  }

  function ajustarElipse(r) {
    var n = r.length - 1, mx = 0, my = 0, i;   // o último ponto repete o começo
    for (i = 0; i < n; i++) { mx += r[i][0]; my += r[i][1]; }
    mx /= n; my /= n;
    var sxx = 0, syy = 0, sxy = 0;
    for (i = 0; i < n; i++) { var x = r[i][0] - mx, y = r[i][1] - my; sxx += x * x; syy += y * y; sxy += x * y; }
    sxx /= n; syy /= n; sxy /= n;
    var t = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    var tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    var a = Math.sqrt(2 * (tr / 2 + disc)), b = Math.sqrt(2 * Math.max(1e-6, tr / 2 - disc));
    if (b < 3) return null;
    var ct = Math.cos(t), st = Math.sin(t), soma = 0;
    for (i = 0; i < n; i++) {
      var dx = r[i][0] - mx, dy = r[i][1] - my, u = dx * ct + dy * st, w = -dx * st + dy * ct;
      soma += Math.abs(Math.sqrt(u * u / (a * a) + w * w / (b * b)) - 1);
    }
    var erroRel = soma / n, tipo = 'elipse';
    if (a / b < 1.15) { a = b = (a + b) / 2; t = 0; tipo = 'circulo'; }
    else {
      var t2 = Math.round(t / (PI / 2)) * (PI / 2);
      if (Math.abs(t - t2) < 12 * GRAU) t = t2;
    }
    ct = Math.cos(t); st = Math.sin(t);
    var v = [];
    for (i = 0; i <= 72; i++) {
      var ang = 2 * PI * i / 72, ex = a * Math.cos(ang), ey = b * Math.sin(ang);
      v.push([mx + ex * ct - ey * st, my + ex * st + ey * ct]);
    }
    return { tipo: tipo, v: v, erroRel: erroRel, erro: erroRel * (a + b) / 2 };
  }

  function ajustarPoligono(r, cx) {
    var n = r.length - 1, i;
    // começa no ponto mais longe do centro (é quase sempre um canto)
    var mx = 0, my = 0;
    for (i = 0; i < n; i++) { mx += r[i][0]; my += r[i][1]; }
    mx /= n; my /= n;
    var ini = 0, maior = -1;
    for (i = 0; i < n; i++) { var x = d(r[i], [mx, my]); if (x > maior) { maior = x; ini = i; } }
    var ciclo = [];
    for (i = 0; i <= n; i++) ciclo.push(r[(ini + i) % n]);
    var idx = dp(ciclo, 0.05 * cx.diag);
    idx.pop();   // o último é o mesmo que o primeiro
    // tira vértices quase em linha reta
    var mudou = true;
    while (mudou && idx.length > 3) {
      mudou = false;
      for (var j = 0; j < idx.length; j++) {
        var a = ciclo[idx[(j - 1 + idx.length) % idx.length]], b = ciclo[idx[j]], c = ciclo[idx[(j + 1) % idx.length]];
        var giro = Math.abs(normalizar(anguloDe(b, c) - anguloDe(a, b)));
        if (giro < 28 * GRAU) { idx.splice(j, 1); mudou = true; break; }
      }
    }
    var k = idx.length;
    if (k < 3 || k > 8) return null;
    var verts = idx.map(function (q) { return ciclo[q]; });
    // erro: distância média dos pontos ao polígono
    var soma = 0;
    for (i = 0; i < n; i++) {
      var mn = 1e9;
      for (j = 0; j < k; j++) mn = Math.min(mn, distSeg(r[i], verts[j], verts[(j + 1) % k]));
      soma += mn;
    }
    var erro = soma / n;
    if (erro > 0.05 * cx.diag) return null;

    // cada lado vira uma reta ajustada aos pontos dele; ângulos perto de 0/45/90 ficam exatos
    var retas = [];
    for (j = 0; j < k; j++) {
      var i0 = idx[j], i1 = j + 1 < k ? idx[j + 1] : n, trecho = [];
      var folga = Math.floor((i1 - i0) * 0.15);
      for (var q = i0 + folga; q <= i1 - folga; q++) trecho.push(ciclo[q]);
      if (trecho.length < 2) trecho = [ciclo[i0], ciclo[i1]];
      var rt = ajustarReta(trecho);
      var dir = anguloDe(ciclo[i0], ciclo[i1]);
      if (Math.abs(normalizar(rt.t - dir)) > PI / 2) rt.t += PI;
      rt.t = ajustarAngulo(rt.t, 8 * GRAU);
      retas.push(rt);
    }
    var nv = [];
    for (j = 0; j < k; j++) nv.push(cruzar(retas[(j - 1 + k) % k], retas[j]) || verts[j]);

    var lados = [], angs = [];
    for (j = 0; j < k; j++) {
      lados.push(d(nv[j], nv[(j + 1) % k]));
      var a2 = nv[(j - 1 + k) % k], b2 = nv[j], c2 = nv[(j + 1) % k];
      angs.push(PI - Math.abs(normalizar(anguloDe(b2, c2) - anguloDe(a2, b2))));
    }
    var mL = 0; lados.forEach(function (x) { mL += x; }); mL /= k;
    var dpL = 0; lados.forEach(function (x) { dpL += (x - mL) * (x - mL); }); dpL = Math.sqrt(dpL / k) / mL;
    var c0 = centroide(nv), tipo = 'poligono';

    if (k === 4 && angs.every(function (x) { return Math.abs(x - PI / 2) < 16 * GRAU; })) {
      // retângulo (ou quadrado): orientação média dos lados
      var sx = 0, sy = 0;
      for (j = 0; j < 4; j++) { var t4 = anguloDe(nv[j], nv[(j + 1) % 4]) * 4; sx += Math.cos(t4); sy += Math.sin(t4); }
      var t = Math.atan2(sy, sx) / 4;
      t = ajustarAngulo(t, 10 * GRAU);
      var ct = Math.cos(t), st = Math.sin(t), u0 = 1e9, u1 = -1e9, w0 = 1e9, w1 = -1e9;
      // média de lados opostos em vez do maior/menor: não cresce com o canto mais torto
      var us = [], ws = [];
      for (j = 0; j < 4; j++) { var px = nv[j][0] - c0[0], py = nv[j][1] - c0[1]; us.push(px * ct + py * st); ws.push(-px * st + py * ct); }
      us.sort(function (a3, b3) { return a3 - b3; }); ws.sort(function (a3, b3) { return a3 - b3; });
      u0 = (us[0] + us[1]) / 2; u1 = (us[2] + us[3]) / 2; w0 = (ws[0] + ws[1]) / 2; w1 = (ws[2] + ws[3]) / 2;
      var lw = u1 - u0, lh = w1 - w0, uc = (u0 + u1) / 2, wc = (w0 + w1) / 2;
      tipo = 'retangulo';
      if (Math.abs(lw - lh) / Math.max(lw, lh) < 0.12) { lw = lh = (lw + lh) / 2; tipo = 'quadrado'; }
      var cc = [c0[0] + uc * ct - wc * st, c0[1] + uc * st + wc * ct];
      nv = [[-lw / 2, -lh / 2], [lw / 2, -lh / 2], [lw / 2, lh / 2], [-lw / 2, lh / 2]].map(function (o) {
        return [cc[0] + o[0] * ct - o[1] * st, cc[1] + o[0] * st + o[1] * ct];
      });
    } else if (dpL < (k === 3 ? 0.1 : 0.16) && angs.every(function (x) { return Math.abs(x - PI * (k - 2) / k) < 18 * GRAU; })) {
      // regular: triângulo equilátero, pentágono, hexágono...
      var R = 0; nv.forEach(function (q2) { R += d(q2, c0); }); R /= k;
      var fi = anguloDe(c0, nv[0]);
      // se algum lado está quase na horizontal, deixa esse lado reto
      var base = PI / 2 + PI / k;   // lado de baixo horizontal (y para baixo)
      var passo = 2 * PI / k, delta = normalizar(fi - base), m = Math.round(delta / passo) * passo;
      if (Math.abs(delta - m) < 10 * GRAU) fi = base + m;
      else { var fi2 = -PI / 2 + Math.round((fi + PI / 2) / passo) * passo; if (Math.abs(normalizar(fi - fi2)) < 10 * GRAU) fi = fi2; }
      nv = poligonoRegular(k, c0, R, fi);
      tipo = k === 3 ? 'triangulo' : 'regular';
    } else if (k === 3) tipo = 'triangulo';
    return { tipo: tipo, v: nv, erro: erro };
  }
  function centroide(v) { var x = 0, y = 0; v.forEach(function (q) { x += q[0]; y += q[1]; }); return [x / v.length, y / v.length]; }
  function normalizar(t) { while (t > PI) t -= 2 * PI; while (t < -PI) t += 2 * PI; return t; }

  // ---------------------------------------------------------------- endireitar a letra
  // ângulo da escrita: o que deixa as linhas mais "concentradas" (perfil de projeção)
  function melhorAngulo(pts, de, ate, passo) {
    var notas = [], maior = 0, g;
    for (g = de; g <= ate + 1e-9; g += passo) {
      var t = g * GRAU, s = Math.sin(t), c = Math.cos(t), caixas = {}, soma = 0;
      for (var i = 0; i < pts.length; i++) {
        var k = Math.floor((-pts[i][0] * s + pts[i][1] * c) / 3);
        caixas[k] = (caixas[k] || 0) + 1;
      }
      for (var b in caixas) if (caixas.hasOwnProperty(b)) soma += caixas[b] * caixas[b];
      notas.push([g, soma]); if (soma > maior) maior = soma;
    }
    // entre os quase empatados, o ângulo mais perto de zero (não gira à toa)
    var melhor = null;
    notas.forEach(function (n) { if (n[1] >= maior * 0.97 && (melhor === null || Math.abs(n[0]) < Math.abs(melhor))) melhor = n[0]; });
    return (melhor || 0) * GRAU;
  }
  function girar(v, c, t) {   // gira por -t em volta de c
    var co = Math.cos(t), s = Math.sin(t);
    for (var i = 0; i < v.length; i++) {
      var x = v[i][0] - c[0], y = v[i][1] - c[1];
      v[i] = [c[0] + x * co + y * s, c[1] - x * s + y * co];
    }
  }

  // tracos: traços da caneta (já copiados). opcoes.pauta: {y0, passo} ou null.
  // Devolve os mesmos traços com os pontos endireitados.
  function endireitar(tracos, opcoes) {
    opcoes = opcoes || {};
    var ts = tracos.filter(function (t) { return t.p && t.p.length >= 2; });
    if (!ts.length) return [];
    var todos = [], i, j;
    ts.forEach(function (t) { t.v = pares(t.p); todos = todos.concat(t.v); });
    var cg = caixa(todos), centro = [(cg.x0 + cg.x1) / 2, (cg.y0 + cg.y1) / 2];

    // 1. inclinação geral
    var ang = melhorAngulo(todos, -35, 35, 1);
    ts.forEach(function (t) { girar(t.v, centro, ang); t.cx = caixa(t.v); });

    // 2. separa em linhas
    var alturas = ts.map(function (t) { return t.cx.h; }).filter(function (h) { return h > 2; });
    var medH = Math.max(6, mediana(alturas));
    var grandes = ts.filter(function (t) { return t.cx.h >= 0.35 * medH; });
    var pequenos = ts.filter(function (t) { return t.cx.h < 0.35 * medH; });
    if (!grandes.length) { grandes = ts; pequenos = []; }
    grandes.sort(function (a, b) { return (a.cx.y0 + a.cx.y1) - (b.cx.y0 + b.cx.y1); });
    var linhas = [];
    grandes.forEach(function (t) {
      var cy = (t.cx.y0 + t.cx.y1) / 2, alvo = null, md = 1e9;
      linhas.forEach(function (l) { var x = Math.abs(cy - l.cy); if (x < md) { md = x; alvo = l; } });
      if (alvo && md < 0.65 * medH) { alvo.ts.push(t); alvo.cy = (alvo.cy * (alvo.ts.length - 1) + cy) / alvo.ts.length; }
      else linhas.push({ ts: [t], cy: cy });
    });
    linhas.forEach(function (l) {
      l.y0 = 1e9; l.y1 = -1e9;
      l.ts.forEach(function (t) { l.y0 = Math.min(l.y0, t.cx.y0); l.y1 = Math.max(l.y1, t.cx.y1); });
    });
    pequenos.forEach(function (t) {   // pingos, acentos, vírgulas: vão para a linha mais perto
      var cy = (t.cx.y0 + t.cx.y1) / 2, alvo = linhas[0], md = 1e9;
      linhas.forEach(function (l) { var x = cy < l.y0 ? l.y0 - cy : (cy > l.y1 ? cy - l.y1 : 0); if (x < md) { md = x; alvo = l; } });
      alvo.ts.push(t);
    });

    // 3. cada linha: acerta a inclinação dela e separa as palavras
    var palavras = [];
    linhas.forEach(function (l) {
      var pts = [];
      l.ts.forEach(function (t) { pts = pts.concat(t.v); });
      var cl = caixa(pts), c = [(cl.x0 + cl.x1) / 2, (cl.y0 + cl.y1) / 2];
      if (cl.w > 3 * medH) {
        var a2 = melhorAngulo(pts, -8, 8, 0.5);
        l.ts.forEach(function (t) { girar(t.v, c, a2); t.cx = caixa(t.v); });
      }
      l.ts.sort(function (a, b) { return a.cx.x0 - b.cx.x0; });
      l.pals = [];
      var atual = null, folga = 0.45 * medH;
      l.ts.forEach(function (t) {
        if (atual && t.cx.x0 <= atual.x1 + folga) { atual.ts.push(t); atual.x1 = Math.max(atual.x1, t.cx.x1); }
        else { atual = { ts: [t], x0: t.cx.x0, x1: t.cx.x1 }; l.pals.push(atual); }
      });
      l.pals.forEach(function (w) {
        var ys = [];
        w.ts.forEach(function (t) { t.v.forEach(function (q) { ys.push(q[1]); }); });
        ys.sort(function (a, b) { return a - b; });
        w.base = quantil(ys, 0.85); w.nucleo = Math.max(2, quantil(ys, 0.85) - quantil(ys, 0.2));
        palavras.push(w);
      });
    });

    // 4. tamanho: aproxima cada palavra do tamanho típico; linha de base comum por linha
    var alvoT = mediana(palavras.map(function (w) { return w.nucleo; }));
    linhas.forEach(function (l) {
      var base = mediana(l.pals.map(function (w) { return w.base; }));
      if (opcoes.pauta) {
        var k = Math.round((base - opcoes.pauta.y0) / opcoes.pauta.passo), r = opcoes.pauta.y0 + k * opcoes.pauta.passo;
        if (k >= 0 && Math.abs(r - base) < opcoes.pauta.passo * 0.45) base = r;
      }
      var vaos = [];
      for (j = 1; j < l.pals.length; j++) vaos.push(l.pals[j].x0 - l.pals[j - 1].x1);
      var vaoM = Math.max(0.5 * alvoT, mediana(vaos));
      var x = l.pals.length ? l.pals[0].x0 : 0;
      l.pals.forEach(function (w, n) {
        var f = Math.max(0.75, Math.min(1.33, alvoT / w.nucleo));
        f = 1 + (f - 1) * 0.7;
        if (n > 0) x += Math.max(0.6 * vaoM, Math.min(1.6 * vaoM, w.x0 - l.pals[n - 1].x1));
        var x0 = w.x0, b0 = w.base;
        w.ts.forEach(function (t) {
          for (i = 0; i < t.v.length; i++) t.v[i] = [x + (t.v[i][0] - x0) * f, base + (t.v[i][1] - b0) * f];
        });
        x += (w.x1 - w.x0) * f;
        w.novoX1 = x;
      });
    });

    return ts.map(function (t) {
      var n = {};
      for (var k in t) if (t.hasOwnProperty(k) && k !== 'v' && k !== 'cx') n[k] = t[k];
      n.p = plano(t.v);
      return n;
    });
  }

  // ponto dentro do polígono (laço)
  function dentro(x, y, poli) {
    var ok = false;
    for (var i = 0, j = poli.length - 2; i < poli.length; j = i, i += 2) {
      var xi = poli[i], yi = poli[i + 1], xj = poli[j], yj = poli[j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ok = !ok;
    }
    return ok;
  }

  var G = { reconhecerForma: reconhecerForma, endireitar: endireitar, dentro: dentro,
            melhorAngulo: melhorAngulo, reamostrar: reamostrar, pares: pares };
  if (typeof module !== 'undefined' && module.exports) module.exports = G;
  else raiz.NotasGeo = G;
})(this);
