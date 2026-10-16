'use strict';
/* Finanças Pessoais — app estático (GitHub Pages).
   Dados: localStorage (cache) + arquivo JSON num repositório GitHub (sincronização opcional). */

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const ABR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const CATS_PADRAO = {
  'Entrada': ['Salário','13º, Férias e Bônus','Renda Extra / Freelance','Rendimentos e Investimentos','Reembolsos e Estornos','Vendas','Presentes e Mesada','Benefícios (VR/VA)','Outras Receitas'],
  'Saída': ['Moradia e Contas Fixas','Alimentação','Mercado e Supermercado','Restaurantes e Delivery','Transporte','Veículo e Manutenção','Dívidas e Empréstimos','Fatura do Cartão','Lazer e Entretenimento','Assinaturas e Streaming','Viagens e Passeios','Saúde','Academia e Suplementos','Educação','Vestuário e Cuidados Pessoais','Compras e Eletrônicos','Presentes e Doações','Impostos e Documentos','Investimentos','Tarifas e Juros','Outras Despesas']
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const fmtBRL = v => r2(v).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
const fmtCompact = v => 'R$ ' + new Intl.NumberFormat('pt-BR', {notation:'compact', maximumFractionDigits:1}).format(v);
const fmtNum = v => r2(v).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
const sgn = (tipo, v) => (tipo === 'Entrada' ? '+ ' : '− ') + fmtBRL(v);
const dataBR = iso => iso ? iso.split('-').reverse().join('/') : '';
const pad = n => String(n).padStart(2, '0');
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const LS = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

/* ---------------------------------------------------------------- estado */
let ano, D, meta;
const ui = Object.assign({view:'painel', mes:new Date().getMonth(), tipo:'', busca:'', catPeriodo:'ano'}, LS.get('fin.ui', {}));
let charts = {}, syncing = false, syncAgain = false, lastErr = '', pushTimer = null, lastPull = 0;

function novoAno(a, saldoInicial = 0) {
  return {versao:1, ano:a, saldoInicial, saldoInicialU:Date.now(), categorias:{'Entrada':[...CATS_PADRAO['Entrada']], 'Saída':[...CATS_PADRAO['Saída']]}, removidos:{}, lancamentos:[]};
}
function garantirCats(d) {
  d.categorias = d.categorias || {};
  for (const t of ['Entrada','Saída']) if (!Array.isArray(d.categorias[t]) || !d.categorias[t].length) d.categorias[t] = [...CATS_PADRAO[t]];
  for (const l of d.lancamentos) if (!d.categorias[l.tipo].includes(l.categoria)) d.categorias[l.tipo].push(l.categoria);
  d.removidos = d.removidos || {};
  return d;
}
function anosLocais() {
  const s = new Set([new Date().getFullYear(), new Date().getFullYear() + 1]);
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); const m = k && k.match(/^fin\.data\.(\d{4})$/); if (m) s.add(+m[1]); } } catch {}
  s.add(ano);
  return [...s].sort();
}
function acumFinal(a) {
  const d = LS.get('fin.data.' + a, null); if (!d) return null;
  const c = calc(d); return c.M[11].acum;
}
function abrirAno(a) {
  ano = a;
  let d = LS.get('fin.data.' + a, null);
  if (!d) { const prev = acumFinal(a - 1); d = novoAno(a, prev == null ? 0 : r2(prev)); }
  D = garantirCats(d);
  meta = LS.get('fin.meta.' + a, {sha:null, dirty:false, replace:false, t:0});
  LS.set('fin.ui', Object.assign(ui, {ano:a}));
  const hoje = new Date();
  if (a === hoje.getFullYear()) ui.mes = hoje.getMonth();
  else { const c = calc(D); ui.mes = c.last >= 0 ? c.last : 0; }
}
function persistir(marcarSujo = true) {
  LS.set('fin.data.' + ano, D);
  if (marcarSujo) { meta.dirty = true; }
  LS.set('fin.meta.' + ano, meta);
  refreshStatus();
  if (marcarSujo) agendarPush();
}

/* ---------------------------------------------------------------- cálculo (espelha a planilha) */
function calc(d) {
  const M = Array.from({length:12}, () => ({ent:0, sai:0, n:0, max:0, maxDesc:'', cats:{}}));
  for (const l of d.lancamentos) {
    const m = M[l.mes - 1]; if (!m) continue;
    m.n++;
    if (l.tipo === 'Entrada') m.ent += l.valor;
    else { m.sai += l.valor; if (l.valor > m.max) { m.max = l.valor; m.maxDesc = l.descricao || l.categoria; } }
    const k = l.tipo + '|' + l.categoria; m.cats[k] = (m.cats[k] || 0) + l.valor;
  }
  let ac = d.saldoInicial || 0;
  for (const m of M) { m.rest = ac; m.saldo = m.ent - m.sai; m.acum = m.rest + m.saldo; ac = m.acum; }
  const ent = M.reduce((a, m) => a + m.ent, 0), sai = M.reduce((a, m) => a + m.sai, 0);
  const comDados = M.map((m, i) => m.n ? i : -1).filter(i => i >= 0);
  const last = comDados.length ? comDados[comDados.length - 1] : -1;
  let maxI = null; for (const l of d.lancamentos) if (l.tipo === 'Saída' && (!maxI || l.valor > maxI.valor)) maxI = l;
  return {M, ent, sai, saldo:ent - sai, taxa:ent ? (ent - sai) / ent : 0, nMeses:comDados.length, media:comDados.length ? sai / comDados.length : 0,
          maior:maxI ? maxI.valor : 0, maiorL:maxI, n:d.lancamentos.length, last, acumAtual:last >= 0 ? M[last].acum : (d.saldoInicial || 0)};
}
function catsDoPeriodo(i) { // i = 'ano' ou índice do mês → [{nome, v}] saídas
  const out = {};
  for (const l of D.lancamentos) if (l.tipo === 'Saída' && (i === 'ano' || l.mes - 1 === +i)) out[l.categoria] = (out[l.categoria] || 0) + l.valor;
  return Object.entries(out).map(([nome, v]) => ({nome, v})).sort((a, b) => b.v - a.v);
}

/* ---------------------------------------------------------------- navegação */
function setView(v) {
  ui.view = v; LS.set('fin.ui', ui);
  $$('.view').forEach(s => s.hidden = s.id !== 'v-' + v);
  $$('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  renderAll(); window.scrollTo({top:0});
}
function renderAll() {
  renderAnoSel(); renderBanner();
  if (ui.view === 'painel') renderPainel();
  if (ui.view === 'mes') renderMes();
  if (ui.view === 'resumo') renderResumo();
  if (ui.view === 'ajustes') renderAjustes();
  refreshStatus();
}
function renderAnoSel() {
  const s = $('#anoSel'); s.innerHTML = anosLocais().map(a => `<option ${a === ano ? 'selected' : ''}>${a}</option>`).join('');
}

/* ---------------------------------------------------------------- painel */
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function renderPainel() {
  const C = calc(D);
  const kpi = (l, v, cls = '', sub = '') => `<div class="kpi"><span>${l}</span><b class="${cls}">${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const mesAc = C.last >= 0 ? ABR[C.last] : '—';
  $('#kpis').innerHTML =
    kpi('Total de entradas (ano)', fmtBRL(C.ent), 'pos') +
    kpi('Total de saídas (ano)', fmtBRL(C.sai), 'neg') +
    kpi('Saldo do ano', fmtBRL(C.saldo), C.saldo >= 0 ? 'pos' : 'neg') +
    kpi(`Total acumulado em conta (${mesAc})`, fmtBRL(C.acumAtual), C.acumAtual >= 0 ? 'pos' : 'neg', 'Inclui o saldo inicial') +
    kpi('Taxa de poupança', (C.taxa * 100).toFixed(1).replace('.', ',') + '%', C.taxa >= 0 ? 'pos' : 'neg', 'Saldo ÷ entradas') +
    kpi('Média mensal de gastos', fmtBRL(C.media), '', `${C.nMeses} ${C.nMeses === 1 ? 'mês' : 'meses'} com lançamentos`) +
    kpi('Maior gasto individual', fmtBRL(C.maior), '', C.maiorL ? esc(C.maiorL.descricao || C.maiorL.categoria) : '') +
    kpi('Nº de lançamentos (ano)', C.n, '');
  const com = C.M.map((m, i) => ({m, i})).filter(x => x.m.n);
  if (com.length) {
    const gasto = com.reduce((a, b) => b.m.sai > a.m.sai ? b : a), saldo = com.reduce((a, b) => b.m.saldo > a.m.saldo ? b : a);
    $('#highlights').innerHTML = `<span>Mês com mais gastos: <b>${ABR[gasto.i]}</b> (${fmtBRL(gasto.m.sai)})</span><span>Mês com maior saldo: <b>${ABR[saldo.i]}</b> (${fmtBRL(saldo.m.saldo)})</span>`;
  } else $('#highlights').innerHTML = '<span>Sem lançamentos neste ano ainda.</span>';

  // gráficos
  Object.values(charts).forEach(c => c.destroy()); charts = {};
  const tx = cssVar('--text2'), grid = cssVar('--grid'), sur = cssVar('--surface');
  const base = {responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false},
    plugins:{legend:{position:'top', align:'end', labels:{color:tx, usePointStyle:true, boxWidth:8, boxHeight:8}},
      tooltip:{callbacks:{label: c => ` ${c.dataset.label}: ${fmtBRL(c.parsed.y)}`}}},
    scales:{x:{grid:{display:false}, ticks:{color:tx}, border:{color:grid}}, y:{grid:{color:grid}, border:{display:false}, ticks:{color:tx, callback:v => fmtCompact(v)}}}};
  charts.m = new Chart($('#chMensal'), {type:'bar', data:{labels:ABR, datasets:[
    {label:'Entradas', data:C.M.map(m => r2(m.ent)), backgroundColor:cssVar('--s-ent'), borderRadius:{topLeft:4, topRight:4}, maxBarThickness:16, borderColor:sur, borderWidth:2},
    {label:'Saídas', data:C.M.map(m => r2(m.sai)), backgroundColor:cssVar('--s-sai'), borderRadius:{topLeft:4, topRight:4}, maxBarThickness:16, borderColor:sur, borderWidth:2}]}, options:base});
  charts.a = new Chart($('#chAcum'), {type:'line', data:{labels:ABR, datasets:[
    {label:'Total acumulado em conta', data:C.M.map((m, i) => i <= C.last ? r2(m.acum) : null), borderColor:cssVar('--s-line'), backgroundColor:cssVar('--s-line'),
     borderWidth:2, tension:.25, pointRadius:4, pointBackgroundColor:cssVar('--s-line'), pointBorderColor:sur, pointBorderWidth:2, spanGaps:false}]}, options:base});

  // categorias
  const sel = $('#catPeriodo');
  sel.innerHTML = `<option value="ano">Ano todo</option>` + MESES.map((m, i) => `<option value="${i}">${m}</option>`).join('');
  sel.value = String(ui.catPeriodo);
  const cats = catsDoPeriodo(ui.catPeriodo), tot = cats.reduce((a, c) => a + c.v, 0);
  let linhas = cats.slice(0, 12);
  if (cats.length > 12) linhas.push({nome:`Demais (${cats.length - 12})`, v:cats.slice(12).reduce((a, c) => a + c.v, 0)});
  const mx = linhas.length ? linhas[0].v : 1;
  $('#catBars').innerHTML = linhas.length ? linhas.map(c => `<div class="cb"><span class="n" title="${esc(c.nome)}">${esc(c.nome)}</span>
    <span class="track"><div class="bar" style="width:${Math.max(1, c.v / mx * 100)}%"></div></span>
    <span class="v">${fmtBRL(c.v)}<i>${(c.v / tot * 100).toFixed(0)}%</i></span></div>`).join('') : '<div class="empty">Sem saídas neste período.</div>';

  // insights do ano
  const ins = [];
  if (C.n) {
    ins.push({c:C.saldo >= 0 ? 'good' : 'bad', t:`Saldo do ano ${C.saldo >= 0 ? 'positivo' : 'negativo'}: <b>${fmtBRL(C.saldo)}</b> (poupança de ${(C.taxa * 100).toFixed(1).replace('.', ',')}% das entradas).`});
    const ct = catsDoPeriodo('ano');
    if (ct.length) {
      ins.push({t:`Categoria que mais pesa: <b>${esc(ct[0].nome)}</b>, com ${fmtBRL(ct[0].v)} (${(ct[0].v / C.sai * 100).toFixed(0)}% das saídas).`});
      if (ct.length >= 3) { const s3 = ct.slice(0, 3).reduce((a, c) => a + c.v, 0); ins.push({t:`As 3 maiores categorias (${ct.slice(0, 3).map(c => esc(c.nome)).join(', ')}) somam <b>${(s3 / C.sai * 100).toFixed(0)}%</b> dos gastos.`}); }
    }
    const comS = C.M.map((m, i) => ({m, i})).filter(x => x.m.n && x.m.sai > 0);
    if (comS.length > 1) { const hi = comS.reduce((a, b) => b.m.sai > a.m.sai ? b : a), lo = comS.reduce((a, b) => b.m.sai < a.m.sai ? b : a);
      ins.push({c:'warn', t:`Mês mais caro: <b>${MESES[hi.i]}</b> (${fmtBRL(hi.m.sai)}). Mais econômico: <b>${MESES[lo.i]}</b> (${fmtBRL(lo.m.sai)}).`}); }
    if (C.maiorL) ins.push({t:`Maior gasto individual: <b>${esc(C.maiorL.descricao || C.maiorL.categoria)}</b> — ${fmtBRL(C.maiorL.valor)} (${ABR[C.maiorL.mes - 1]}).`});
    ins.push({t:`Média de gastos: <b>${fmtBRL(C.media)}</b> por mês com lançamentos.`});
    const neg = C.M.findIndex((m, i) => i <= C.last && m.acum < 0);
    if (neg >= 0) ins.push({c:'bad', t:`O total acumulado em conta ficou negativo em <b>${MESES[neg]}</b> (${fmtBRL(C.M[neg].acum)}).`});
  }
  $('#insAno').innerHTML = ins.length ? ins.map(i => `<div class="insight ${i.c || ''}">${i.t}</div>`).join('') : '<div class="empty">Sem dados para gerar insights.</div>';
}

/* ---------------------------------------------------------------- lançamentos do mês */
function renderMes() {
  const C = calc(D), i = ui.mes, m = C.M[i];
  $('#mesChips').innerHTML = MESES.map((n, k) => `<button role="tab" class="${k === i ? 'on' : ''} ${C.M[k].n ? 'has' : ''}" data-m="${k}">${n}</button>`).join('');
  const on = $('#mesChips .on'); if (on) on.scrollIntoView({inline:'center', block:'nearest'});
  $('#mesTitulo').textContent = `Lançamentos — ${MESES[i]} ${ano}`;
  $('#mEnt').textContent = fmtBRL(m.ent); $('#mSai').textContent = fmtBRL(m.sai);
  const sd = $('#mSaldo'); sd.textContent = fmtBRL(m.saldo); sd.className = m.saldo >= 0 ? 'pos' : 'neg';
  $('#mRestLbl').textContent = i === 0 ? `Saldo inicial (conta em 31/12/${ano - 1})` : 'Restante do mês anterior';
  $('#mRest').textContent = fmtBRL(m.rest); $('#editSaldoIni').hidden = i !== 0;
  const ac = $('#mAcum'); ac.textContent = fmtBRL(m.acum);

  // insights do mês
  const ins = [];
  if (!m.n) ins.push({t:'Sem lançamentos neste mês ainda.'});
  else {
    ins.push({c:m.saldo >= 0 ? 'good' : 'bad', t:`Mês ${m.saldo >= 0 ? 'positivo' : 'negativo'}: <b>${fmtBRL(m.saldo)}</b>.`});
    const ct = catsDoPeriodo(i);
    if (ct.length) ins.push({t:`Maior categoria: <b>${esc(ct[0].nome)}</b> — ${fmtBRL(ct[0].v)} (${(ct[0].v / m.sai * 100).toFixed(0)}% das saídas).`});
    if (m.max) ins.push({t:`Maior gasto: <b>${esc(m.maxDesc)}</b> — ${fmtBRL(m.max)}.`});
    if (i > 0 && C.M[i - 1].sai > 0 && m.sai > 0) { const v = (m.sai / C.M[i - 1].sai - 1) * 100;
      ins.push({c:v > 0 ? 'warn' : 'good', t:`Saídas ${Math.abs(v).toFixed(0)}% ${v > 0 ? 'acima' : 'abaixo'} de ${MESES[i - 1]}.`}); }
  }
  $('#insMes').innerHTML = ins.map(x => `<div class="insight ${x.c || ''}">${x.t}</div>`).join('');
  if (!renderMes.init) { renderMes.init = true; $('#insDet').open = window.innerWidth > 720; }

  // lista
  const q = ui.busca.trim().toLowerCase();
  const rows = D.lancamentos.map((l, idx) => ({l, idx})).filter(({l}) => l.mes - 1 === i && (!ui.tipo || l.tipo === ui.tipo) &&
      (!q || (l.descricao + ' ' + l.categoria).toLowerCase().includes(q)))
    .sort((a, b) => (b.l.data || '').localeCompare(a.l.data || '') || b.idx - a.idx).map(x => x.l);
  const fora = l => l.data && (+l.data.slice(0, 4) !== ano || +l.data.slice(5, 7) !== l.mes);
  const flag = l => fora(l) ? `<span class="flag" title="A data está fora de ${MESES[l.mes - 1]}/${ano}">⚠</span>` : '';
  $('#tbody').innerHTML = rows.map(l => `<tr class="row" data-id="${l.id}"><td>${dataBR(l.data)}${flag(l)}</td><td><span class="tag ${l.tipo}">${l.tipo}</span></td>
    <td>${esc(l.categoria)}</td><td class="d">${esc(l.descricao)}</td><td class="r ${l.tipo === 'Entrada' ? 'pos' : 'neg'}">${sgn(l.tipo, l.valor)}</td><td><button class="link" style="position:static" data-id="${l.id}">editar</button></td></tr>`).join('');
  $('#cards').innerHTML = rows.map(l => `<div class="lc" data-id="${l.id}"><span class="t">${esc(l.descricao || l.categoria)}</span>
    <span class="v ${l.tipo === 'Entrada' ? 'pos' : 'neg'}">${sgn(l.tipo, l.valor)}</span>
    <span class="m">${dataBR(l.data)}${flag(l)} · ${esc(l.categoria)}</span></div>`).join('');
  $('#vazio').hidden = rows.length > 0;
  $('#vazio').textContent = m.n ? 'Nada encontrado com esse filtro.' : 'Nenhum lançamento neste mês.';
  $$('#fTipo button').forEach(b => b.classList.toggle('on', b.dataset.t === ui.tipo));
  $('#busca').value = ui.busca;
}

/* ---------------------------------------------------------------- resumo mensal */
function renderResumo() {
  const C = calc(D), oculta = $('#ocultaZero').checked;
  const cel = v => v ? fmtNum(v) : '–';
  const linhaCat = (tipo, nome) => {
    const vals = C.M.map(m => m.cats[tipo + '|' + nome] || 0), tot = vals.reduce((a, b) => a + b, 0);
    if (oculta && !tot) return '';
    return `<tr><td>${esc(nome)}</td>${vals.map(v => `<td class="${v ? '' : 'z'}">${cel(v)}</td>`).join('')}<td class="tot">${cel(tot)}</td></tr>`;
  };
  const soma = (f) => C.M.map(f);
  const linhaSum = (lbl, arr, tot, cls = '') => `<tr class="sum"><td>${lbl}</td>${arr.map(v => `<td class="${cls || (v < 0 ? 'neg' : '')}">${fmtNum(v)}</td>`).join('')}<td class="tot ${tot < 0 ? 'neg' : ''}">${tot == null ? '' : fmtNum(tot)}</td></tr>`;
  $('#resTbl').innerHTML = `<thead><tr><th>Categoria</th>${ABR.map(a => `<th>${a}</th>`).join('')}<th>Total</th></tr></thead><tbody>
    <tr class="sec"><td colspan="14">Entradas</td></tr>${D.categorias['Entrada'].map(c => linhaCat('Entrada', c)).join('')}
    ${linhaSum('TOTAL ENTRADAS', soma(m => m.ent), C.ent)}
    <tr class="sec"><td colspan="14">Saídas</td></tr>${D.categorias['Saída'].map(c => linhaCat('Saída', c)).join('')}
    ${linhaSum('TOTAL SAÍDAS', soma(m => m.sai), C.sai)}
    <tr class="sec"><td colspan="14">Conta</td></tr>
    ${linhaSum('SALDO DO MÊS (Entradas − Saídas)', soma(m => m.saldo), C.saldo)}
    <tr><td>RESTANTE DO MÊS ANTERIOR</td>${C.M.map(m => `<td>${fmtNum(m.rest)}</td>`).join('')}<td class="tot"></td></tr>
    ${linhaSum('TOTAL ACUMULADO EM CONTA', soma(m => m.acum), null)}
    <tr><td>Nº de lançamentos</td>${C.M.map(m => `<td class="${m.n ? '' : 'z'}">${m.n || '–'}</td>`).join('')}<td class="tot">${C.n}</td></tr></tbody>`;
}

/* ---------------------------------------------------------------- formulário */
let editId = null, abaTocada = false;
function valorDeTexto(s) {
  s = String(s).replace(/R\$/gi, '').replace(/\s+/g, '');
  if (!s || !/^[+-]?[\d.,]+([+-][\d.,]+)*$/.test(s)) return NaN;
  const partes = s.match(/[+-]?[\d.,]+/g);
  let total = 0;
  for (let p of partes) {
    const neg = p[0] === '-'; p = p.replace(/^[+-]/, '');
    if (p.includes(',')) p = p.replace(/\./g, '').replace(',', '.');
    else if ((p.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(p)) p = p.replace(/\./g, '');
    const n = Number(p); if (isNaN(n)) return NaN;
    total += neg ? -n : n;
  }
  return r2(total);
}
function tipoAtual() { return $('#fmTipo .on').dataset.t; }
function popularCats(sel) {
  const t = tipoAtual(), lista = D.categorias[t];
  $('#fmCat').innerHTML = lista.map(c => `<option>${esc(c)}</option>`).join('') + '<option value="__nova">+ Nova categoria…</option>';
  if (sel && lista.includes(sel)) $('#fmCat').value = sel;
}
function abrirForm(id) {
  editId = id || null; abaTocada = !!id;
  const l = id ? D.lancamentos.find(x => x.id === id) : null;
  $('#dlgTitulo').textContent = l ? 'Editar lançamento' : `Novo lançamento — ${MESES[ui.mes]}`;
  $$('#fmTipo button').forEach(b => b.classList.toggle('on', b.dataset.t === (l ? l.tipo : 'Saída')));
  popularCats(l?.categoria);
  $('#fmValor').value = l ? String(l.valor).replace('.', ',') : '';
  $('#fmDesc').value = l ? l.descricao : '';
  $('#fmMes').innerHTML = MESES.map((n, k) => `<option value="${k + 1}">${n}</option>`).join('');
  $('#fmMes').value = l ? l.mes : ui.mes + 1;
  const hoje = new Date();
  let d = hojeISO(); if (ano !== hoje.getFullYear() || ui.mes !== hoje.getMonth()) d = `${ano}-${pad(ui.mes + 1)}-01`;
  $('#fmData').value = l ? l.data : d;
  $('#fmDel').hidden = !l; $('#fmErro').hidden = true;
  $('#dlg').showModal();
  if (!l) setTimeout(() => $('#fmValor').focus(), 60);
}
function salvarForm() {
  const erro = m => { const e = $('#fmErro'); e.textContent = m; e.hidden = false; };
  const valor = valorDeTexto($('#fmValor').value);
  if (isNaN(valor) || valor <= 0) return erro('Informe um valor maior que zero (ex.: 25,90 ou 8+221).');
  const cat = $('#fmCat').value; if (!cat || cat === '__nova') return erro('Escolha uma categoria.');
  const data = $('#fmData').value; if (!data) return erro('Informe a data.');
  const campos = {tipo:tipoAtual(), categoria:cat, descricao:$('#fmDesc').value.trim(), valor, data, mes:+$('#fmMes').value, u:Date.now()};
  if (editId) Object.assign(D.lancamentos.find(x => x.id === editId), campos);
  else D.lancamentos.push({id:novoId(), ...campos});
  ui.mes = campos.mes - 1; LS.set('fin.ui', ui);
  $('#dlg').close(); persistir(); renderAll(); toast(editId ? 'Lançamento atualizado' : 'Lançamento salvo');
}
function excluirForm() {
  if (!editId || !confirm('Excluir este lançamento?')) return;
  D.lancamentos = D.lancamentos.filter(x => x.id !== editId);
  D.removidos[editId] = Date.now();
  $('#dlg').close(); persistir(); renderAll(); toast('Lançamento excluído');
}

/* ---------------------------------------------------------------- ajustes */
function renderAjustes() {
  const c = LS.get('fin.cfg', {});
  $('#gRepo').value = c.repo || ''; $('#gBranch').value = c.branch || ''; $('#gPasta').value = c.pasta || ''; $('#gToken').value = c.token || '';
  const usados = new Set(D.lancamentos.map(l => l.tipo + '|' + l.categoria));
  $('#catManager').innerHTML = ['Entrada', 'Saída'].map(t => `<div class="catgrp"><b>${t === 'Entrada' ? 'Entradas' : 'Saídas'}</b><div>${D.categorias[t].map(c =>
    `<span class="pill">${esc(c)}${usados.has(t + '|' + c) ? '' : ` <button class="link" style="position:static" data-rm="${t}|${esc(c)}" title="Remover categoria sem uso">×</button>`}</span>`).join('')}</div></div>`).join('');
}

/* ---------------------------------------------------------------- GitHub */
const ghCfg = () => { const c = LS.get('fin.cfg', {}); return c.repo && c.token ? c : null; };
const ghPath = c => ((c.pasta || '').replace(/^\/+|\/+$/g, '') ? (c.pasta.replace(/^\/+|\/+$/g, '') + '/') : '') + `dados-${ano}.json`;
const ghUrl = c => `https://api.github.com/repos/${c.repo.trim()}/contents/${ghPath(c).split('/').map(encodeURIComponent).join('/')}`;
const ghHead = c => ({'Authorization':'Bearer ' + c.token.trim(), 'Accept':'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28'});
const b64enc = str => { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(s); };
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
class GhErro extends Error { constructor(m, status) { super(m); this.status = status; } }

async function ghGet(c) {
  const r = await fetch(ghUrl(c) + '?ref=' + encodeURIComponent(c.branch || 'main') + '&t=' + Date.now(), {headers:ghHead(c), cache:'no-store'});
  if (r.status === 404) return null;
  if (r.status === 401 || r.status === 403) throw new GhErro('Token inválido ou sem permissão neste repositório.', r.status);
  if (!r.ok) throw new GhErro('GitHub respondeu ' + r.status, r.status);
  const j = await r.json();
  if (!j.content) throw new GhErro('Arquivo grande demais para a API de conteúdo.', 0);
  return {sha:j.sha, data:garantirCats(JSON.parse(b64dec(j.content)))};
}
async function ghPut(c, d, sha) {
  const body = {message:`Lançamentos ${ano} — ${new Date().toLocaleString('pt-BR')}`, content:b64enc(serializar(d)), branch:c.branch || 'main'};
  if (sha) body.sha = sha;
  const r = await fetch(ghUrl(c), {method:'PUT', headers:{...ghHead(c), 'Content-Type':'application/json'}, body:JSON.stringify(body)});
  if (r.status === 409 || r.status === 422) throw new GhErro('conflito', 409);
  if (r.status === 401 || r.status === 403) throw new GhErro('Token sem permissão de escrita (Contents: Read and write).', r.status);
  if (r.status === 404) throw new GhErro('Repositório ou branch não encontrado.', 404);
  if (!r.ok) throw new GhErro('GitHub respondeu ' + r.status, r.status);
  return (await r.json()).content.sha;
}
function serializar(d) {
  const {lancamentos, ...resto} = d;
  const head = JSON.stringify(resto, null, 1).replace(/\n}$/, '');
  return head + ',\n "lancamentos": [\n' + lancamentos.map(l => '  ' + JSON.stringify(l)).join(',\n') + '\n ]\n}\n';
}
const canon = d => JSON.stringify({s:d.saldoInicial, l:[...d.lancamentos].sort((a, b) => a.id < b.id ? -1 : 1), r:d.removidos});
function mesclar(a, b) { // a = local, b = remoto
  const rem = {...(b.removidos || {})}; for (const [k, v] of Object.entries(a.removidos || {})) rem[k] = Math.max(rem[k] || 0, v);
  const mapa = new Map();
  for (const l of b.lancamentos) mapa.set(l.id, l);
  for (const l of a.lancamentos) { const o = mapa.get(l.id); if (!o || (l.u || 0) > (o.u || 0)) mapa.set(l.id, l); }
  const lancs = [...mapa.values()].filter(l => !(rem[l.id] >= (l.u || 0)));
  const out = {...b, ano:a.ano, versao:1, removidos:rem, lancamentos:lancs,
    saldoInicial:(a.saldoInicialU || 0) > (b.saldoInicialU || 0) ? a.saldoInicial : b.saldoInicial,
    saldoInicialU:Math.max(a.saldoInicialU || 0, b.saldoInicialU || 0), categorias:{}};
  for (const t of ['Entrada', 'Saída']) out.categorias[t] = [...new Set([...(b.categorias?.[t] || []), ...(a.categorias?.[t] || [])])];
  return garantirCats(out);
}
function agendarPush() { clearTimeout(pushTimer); if (ghCfg()) pushTimer = setTimeout(() => sincronizar(), 1200); }

async function sincronizar({manual = false} = {}) {
  const c = ghCfg();
  if (!c) { if (manual) { setView('ajustes'); toast('Configure o repositório e o token primeiro'); } return; }
  if (syncing) { syncAgain = true; return; }
  if (!navigator.onLine) { lastErr = 'Sem internet — será enviado quando voltar.'; refreshStatus(); return; }
  syncing = true; lastErr = ''; refreshStatus();
  const anoAlvo = ano;
  try {
    for (let t = 0; t < 3; t++) {
      const r = await ghGet(c);
      if (anoAlvo !== ano) return; // usuário trocou de ano no meio
      if (r && !meta.dirty && !meta.replace) { // nada local pendente: adota o remoto
        if (canon(r.data) !== canon(D)) { D = r.data; renderAll(); }
        meta.sha = r.sha; meta.t = Date.now(); LS.set('fin.data.' + ano, D); LS.set('fin.meta.' + ano, meta); break;
      }
      if (!r && !meta.dirty && !meta.replace && !D.lancamentos.length) { meta.t = Date.now(); LS.set('fin.meta.' + ano, meta); break; }
      const alvo = r && !meta.replace ? mesclar(D, r.data) : D;
      if (r && !meta.replace && canon(alvo) === canon(r.data)) { // já igual ao remoto
        D = alvo; meta.sha = r.sha; meta.dirty = false; meta.t = Date.now(); LS.set('fin.data.' + ano, D); LS.set('fin.meta.' + ano, meta); renderAll(); break;
      }
      try {
        const sha = await ghPut(c, alvo, r ? r.sha : null);
        D = alvo; meta.sha = sha; meta.dirty = false; meta.replace = false; meta.t = Date.now();
        LS.set('fin.data.' + ano, D); LS.set('fin.meta.' + ano, meta); renderAll(); break;
      } catch (e) { if (e.status === 409 && t < 2) continue; throw e; }
    }
  } catch (e) { lastErr = e.message === 'Failed to fetch' ? 'Sem conexão com o GitHub.' : e.message; }
  finally { syncing = false; lastPull = Date.now(); refreshStatus(); if (syncAgain) { syncAgain = false; sincronizar(); } }
}
function refreshStatus() {
  const b = $('#syncBtn'), t = $('#syncTxt'); b.className = 'sync';
  if (!ghCfg()) t.textContent = 'Só neste aparelho';
  else if (syncing) { b.classList.add('busy', 'pend'); t.textContent = 'Sincronizando…'; }
  else if (lastErr) { b.classList.add('err'); t.textContent = 'Erro — toque'; b.title = lastErr; }
  else if (meta.dirty || meta.replace) { b.classList.add('pend'); t.textContent = 'Pendente'; }
  else { b.classList.add('ok'); t.textContent = meta.t ? 'Salvo ' + new Date(meta.t).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) : 'Conectado'; }
}
function renderBanner() {
  const b = $('#banner');
  if (ghCfg() || LS.get('fin.bannerOff', false)) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = `Seus lançamentos estão salvos <b>apenas neste aparelho</b>. Conecte um repositório do GitHub para não perdê-los e ver no celular e no PC.
    <button class="btn" id="bnGo">Configurar</button> <button class="btn" id="bnX">Dispensar</button>`;
  $('#bnGo').onclick = () => setView('ajustes'); $('#bnX').onclick = () => { LS.set('fin.bannerOff', true); renderBanner(); };
}

/* ---------------------------------------------------------------- importar / exportar */
function baixar(blob, nome) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function carregarXLSX() {
  return window.XLSX ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'vendor/xlsx.full.min.js'; s.onload = ok; s.onerror = () => no(new Error('Não foi possível carregar a biblioteca de Excel.')); document.head.appendChild(s); });
}
async function exportarXlsx() {
  await carregarXLSX();
  const C = calc(D), wb = XLSX.utils.book_new();
  const serial = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000 + 25569; };
  const cell = (v, f, z) => { const o = typeof v === 'number' ? {t:'n', v} : {t:'s', v}; if (f) o.f = f; if (z) o.z = z; return o; };
  const money = '#,##0.00';
  MESES.forEach((nome, i) => {
    const ws = {}, m = C.M[i], ls = D.lancamentos.filter(l => l.mes - 1 === i);
    const put = (a, c) => ws[a] = c;
    put('A1', cell(`LANÇAMENTOS — ${nome.toUpperCase()}`));
    put('A3', cell('Entradas do mês')); put('B3', cell(r2(m.ent), 'SUMIFS($E$8:$E$207,$B$8:$B$207,"Entrada")', money));
    put('A4', cell('Saídas do mês')); put('B4', cell(r2(m.sai), 'SUMIFS($E$8:$E$207,$B$8:$B$207,"Saída")', money));
    put('A5', cell('Saldo do mês')); put('B5', cell(r2(m.saldo), 'B3-B4', money));
    put('D3', cell(i === 0 ? `Saldo inicial (conta em 31/12/${ano - 1})` : 'Restante do mês anterior'));
    put('E3', cell(r2(m.rest), i === 0 ? null : `${MESES[i - 1]}!$E$5`, money));
    put('D4', cell('Saldo deste mês')); put('E4', cell(r2(m.saldo), 'B5', money));
    put('D5', cell('TOTAL ACUMULADO EM CONTA')); put('E5', cell(r2(m.acum), 'E3+E4', money));
    ['Data', 'Tipo', 'Categoria', 'Descrição', 'Valor (R$)'].forEach((h, k) => put('ABCDE'[k] + '7', cell(h)));
    [...ls].sort((a, b) => (a.data || '').localeCompare(b.data || '')).forEach((l, k) => {
      const r = 8 + k;
      put('A' + r, l.data ? {t:'n', v:serial(l.data), z:'dd/mm/yyyy'} : cell('')); put('B' + r, cell(l.tipo)); put('C' + r, cell(l.categoria)); put('D' + r, cell(l.descricao)); put('E' + r, cell(l.valor, null, money));
    });
    ws['!ref'] = `A1:E${Math.max(207, 7 + ls.length)}`; ws['!cols'] = [{wch:14}, {wch:10}, {wch:30}, {wch:38}, {wch:16}];
    XLSX.utils.book_append_sheet(wb, ws, nome);
  });
  const rs = {}, cats = [...D.categorias['Entrada'].map(c => ['Entrada', c]), ...D.categorias['Saída'].map(c => ['Saída', c])];
  rs['A1'] = cell('RESUMO MENSAL POR CATEGORIA'); ['Categoria', ...ABR, 'Total'].forEach((h, k) => rs[XLSX.utils.encode_cell({r:2, c:k})] = cell(h));
  cats.forEach(([t, c], k) => { const r = 3 + k; rs[XLSX.utils.encode_cell({r, c:0})] = cell(c);
    C.M.forEach((m, j) => rs[XLSX.utils.encode_cell({r, c:j + 1})] = cell(r2(m.cats[t + '|' + c] || 0), `SUMIFS(${MESES[j]}!$E$8:$E$207,${MESES[j]}!$C$8:$C$207,$A${r + 1})`, money));
    rs[XLSX.utils.encode_cell({r, c:13})] = cell(r2(C.M.reduce((a, m) => a + (m.cats[t + '|' + c] || 0), 0)), `SUM(B${r + 1}:M${r + 1})`, money); });
  const base = 3 + cats.length + 1;
  [['TOTAL ENTRADAS', m => m.ent, C.ent], ['TOTAL SAÍDAS', m => m.sai, C.sai], ['SALDO DO MÊS (Entradas - Saídas)', m => m.saldo, C.saldo], ['RESTANTE DO MÊS ANTERIOR', m => m.rest, null], ['TOTAL ACUMULADO EM CONTA', m => m.acum, null]]
    .forEach(([lbl, f, tot], k) => { rs[XLSX.utils.encode_cell({r:base + k, c:0})] = cell(lbl); C.M.forEach((m, j) => rs[XLSX.utils.encode_cell({r:base + k, c:j + 1})] = cell(r2(f(m)), null, money)); if (tot != null) rs[XLSX.utils.encode_cell({r:base + k, c:13})] = cell(r2(tot), null, money); });
  rs['!ref'] = `A1:N${base + 6}`; rs['!cols'] = [{wch:34}, ...Array(13).fill({wch:12})];
  XLSX.utils.book_append_sheet(wb, rs, 'Resumo Mensal');
  const cs = {}; cs['A1'] = cell('ENTRADAS'); cs['C1'] = cell('SAÍDAS');
  D.categorias['Entrada'].forEach((c, k) => cs['A' + (2 + k)] = cell(c)); D.categorias['Saída'].forEach((c, k) => cs['C' + (2 + k)] = cell(c));
  cs['!ref'] = `A1:C${2 + Math.max(D.categorias['Entrada'].length, D.categorias['Saída'].length)}`; cs['!cols'] = [{wch:30}, {wch:4}, {wch:30}];
  XLSX.utils.book_append_sheet(wb, cs, 'Categorias');
  const out = XLSX.write(wb, {bookType:'xlsx', type:'array'});
  baixar(new Blob([out], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), `Financas_Pessoais_${ano}.xlsx`);
}
async function importarXlsx(file) {
  await carregarXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), {type:'array'});
  const lancs = []; let saldoIni = 0; const anos = {};
  const dataDe = v => { if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
    const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`; return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : ''; };
  MESES.forEach((nome, mi) => {
    const ws = wb.Sheets[nome]; if (!ws) return;
    const mx = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', raw:true});
    let h = -1; for (let i = 0; i < Math.min(mx.length, 15); i++) { const v = mx[i].map(x => String(x).trim()); if (v.includes('Data') && v.includes('Tipo') && v.includes('Categoria')) { h = i; break; } }
    if (h < 0) return;
    const hd = mx[h].map(x => String(x).trim()), ix = k => hd.findIndex(x => x === k || x.startsWith(k));
    const [id, it, ic, ides, iv] = [ix('Data'), ix('Tipo'), ix('Categoria'), ix('Descri'), ix('Valor')];
    if (mi === 0) { const v = ws['E3']?.v; if (typeof v === 'number') saldoIni = v; }
    for (let i = h + 1; i < mx.length; i++) {
      const r = mx[i], tipo = String(r[it]).trim(), val = typeof r[iv] === 'number' ? r[iv] : valorDeTexto(r[iv]);
      if (!['Entrada', 'Saída'].includes(tipo) || !(val > 0)) continue;
      const data = dataDe(r[id]); if (data) anos[data.slice(0, 4)] = (anos[data.slice(0, 4)] || 0) + 1;
      lancs.push({id:novoId(), mes:mi + 1, data, tipo, categoria:String(r[ic]).trim() || 'Outras Despesas', descricao:String(r[ides] ?? '').trim(), valor:r2(val), u:Date.now()});
    }
  });
  if (!lancs.length) throw new Error('Não encontrei abas mensais com Data, Tipo, Categoria e Valor.');
  const a = +(Object.entries(anos).sort((x, y) => y[1] - x[1])[0]?.[0] || ano);
  if (!confirm(`Importar ${lancs.length} lançamentos de ${a}? Isso substitui os dados de ${a} deste aparelho (e do GitHub, se conectado).`)) return;
  const d = novoAno(a, r2(saldoIni)); d.lancamentos = lancs; garantirCats(d);
  ano = a; D = d; meta = {sha:LS.get('fin.meta.' + a, {}).sha || null, dirty:true, replace:true, t:0};
  persistir(false); LS.set('fin.meta.' + a, meta); agendarPush(); ui.mes = 0; renderAll(); toast(`${lancs.length} lançamentos importados`);
}
async function importarJson(file) {
  const j = JSON.parse(await file.text());
  if (!j || !Array.isArray(j.lancamentos) || !j.ano) throw new Error('Arquivo de backup inválido.');
  if (!confirm(`Importar backup de ${j.ano} com ${j.lancamentos.length} lançamentos? Isso substitui os dados de ${j.ano}.`)) return;
  j.lancamentos.forEach(l => { l.id = l.id || novoId(); l.u = l.u || Date.now(); l.valor = Number(l.valor); });
  garantirCats(j); j.saldoInicial = Number(j.saldoInicial) || 0; j.saldoInicialU = j.saldoInicialU || Date.now();
  ano = +j.ano; D = j; meta = {sha:LS.get('fin.meta.' + ano, {}).sha || null, dirty:true, replace:true, t:0};
  persistir(false); LS.set('fin.meta.' + ano, meta); agendarPush(); renderAll(); toast('Backup importado');
}

/* ---------------------------------------------------------------- UI helpers */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }
const tratar = fn => async (...a) => { try { await fn(...a); } catch (e) { alert(e.message || e); } };

function ligarEventos() {
  $$('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#anoSel').addEventListener('change', e => { abrirAno(+e.target.value); persistirLeve(); renderAll(); sincronizar(); });
  $('#syncBtn').addEventListener('click', () => lastErr && ghCfg() ? (toast(lastErr), sincronizar({manual:true})) : sincronizar({manual:true}));
  $('#catPeriodo').addEventListener('change', e => { ui.catPeriodo = e.target.value; LS.set('fin.ui', ui); renderPainel(); });
  $('#mesChips').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b) { ui.mes = +b.dataset.m; LS.set('fin.ui', ui); renderMes(); } });
  $('#fTipo').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { ui.tipo = b.dataset.t; renderMes(); } });
  $('#busca').addEventListener('input', e => { ui.busca = e.target.value; renderMes(); $('#busca').focus(); });
  const abrir = e => { const el = e.target.closest('[data-id]'); if (el) abrirForm(el.dataset.id); };
  $('#tbody').addEventListener('click', abrir); $('#cards').addEventListener('click', abrir);
  $('#novoBtn').addEventListener('click', () => abrirForm()); $('#fab').addEventListener('click', () => { if (ui.view !== 'mes') setView('mes'); abrirForm(); });
  $('#editSaldoIni').addEventListener('click', () => {
    const v = prompt(`Saldo da conta em 31/12/${ano - 1} (R$):`, String(D.saldoInicial).replace('.', ','));
    if (v == null) return; const n = valorDeTexto(v); if (isNaN(n)) return alert('Valor inválido.');
    D.saldoInicial = n; D.saldoInicialU = Date.now(); persistir(); renderAll();
  });
  $('#ocultaZero').addEventListener('change', renderResumo);
  // formulário
  $('#fmTipo').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $$('#fmTipo button').forEach(x => x.classList.toggle('on', x === b)); popularCats(); });
  $('#fmCat').addEventListener('change', e => {
    if (e.target.value !== '__nova') return;
    const n = (prompt('Nome da nova categoria:') || '').trim(), t = tipoAtual();
    if (n) { const ex = D.categorias[t].find(c => c.toLowerCase() === n.toLowerCase()); if (!ex) { D.categorias[t].push(n); persistir(); } popularCats(ex || n); } else popularCats();
  });
  $('#fmData').addEventListener('change', e => { const v = e.target.value; if (!abaTocada && v && +v.slice(0, 4) === ano) $('#fmMes').value = +v.slice(5, 7); });
  $('#fmMes').addEventListener('change', () => abaTocada = true);
  $('#frm').addEventListener('submit', e => { e.preventDefault(); salvarForm(); });
  $('#fmCancel').addEventListener('click', () => $('#dlg').close()); $('#fmDel').addEventListener('click', excluirForm);
  $('#dlg').addEventListener('click', e => { if (e.target === $('#dlg')) $('#dlg').close(); });
  // ajustes
  const lerCfg = () => ({repo:$('#gRepo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, ''), branch:$('#gBranch').value.trim() || 'main', pasta:$('#gPasta').value.trim(), token:$('#gToken').value.trim()});
  const msg = t => $('#gMsg').textContent = t;
  $('#gSalvar').addEventListener('click', async () => {
    const c = lerCfg(); if (!/^[\w.-]+\/[\w.-]+$/.test(c.repo) || !c.token) return msg('Preencha o repositório (usuario/nome) e o token.');
    LS.set('fin.cfg', c); msg('Conectando…'); await sincronizar();
    msg(lastErr ? 'Erro: ' + lastErr : 'Conectado! Seus lançamentos agora são gravados no GitHub.'); renderAll();
  });
  $('#gTestar').addEventListener('click', async () => { msg('Sincronizando…'); await sincronizar({manual:true}); msg(lastErr ? 'Erro: ' + lastErr : 'Tudo sincronizado.'); });
  $('#gLimpar').addEventListener('click', () => { if (confirm('Desconectar do GitHub neste aparelho? Os lançamentos continuam salvos aqui.')) { LS.del('fin.cfg'); msg('Desconectado.'); renderAll(); } });
  $('#expXlsx').addEventListener('click', tratar(exportarXlsx));
  $('#expJson').addEventListener('click', () => baixar(new Blob([serializar(D)], {type:'application/json'}), `dados-${ano}.json`));
  $('#impXlsx').addEventListener('change', tratar(async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await importarXlsx(f); }));
  $('#impJson').addEventListener('change', tratar(async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await importarJson(f); }));
  $('#catManager').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; const [t, ...n] = b.dataset.rm.split('|'); const nome = n.join('|');
    D.categorias[t] = D.categorias[t].filter(c => c !== nome); persistir(); renderAjustes(); });
  // sincronização automática
  window.addEventListener('online', () => sincronizar());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastPull > 20000) sincronizar(); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => ui.view === 'painel' && renderPainel());
}
function persistirLeve() { LS.set('fin.data.' + ano, D); LS.set('fin.meta.' + ano, meta); }

/* ---------------------------------------------------------------- início */
(function iniciar() {
  const anoSalvo = ui.ano || new Date().getFullYear();
  abrirAno(anoSalvo);
  ligarEventos();
  ui.view = ['painel', 'mes', 'resumo', 'ajustes'].includes(ui.view) ? ui.view : 'painel';
  setView(ui.view);
  try { navigator.storage?.persist?.(); } catch {}
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  sincronizar();
})();
