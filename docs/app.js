import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const veioDeConviteOuRecuperacao = /type=(invite|recovery)/.test(window.location.hash);
let senhaDefinida = false;

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const estado = { usuario: null, carregado: false, checklists: [], atual: null, secoes: [], itens: [] };

const MAX_FOTOS_POR_ITEM = 10;
const TELAS = ['tela-carregando', 'tela-login', 'tela-senha', 'tela-sem-acesso', 'app'];

const ICONES = {
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  editar: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
  lixeira: 'M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  copiar: 'M9 9h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1',
};

const $ = (seletor) => document.querySelector(seletor);

function icone(nome) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const caminho = document.createElementNS(ns, 'path');
  caminho.setAttribute('d', ICONES[nome]);
  svg.append(caminho);
  return svg;
}

// Cria elementos sem innerHTML, para que texto do usuario nunca seja interpretado como HTML.
function h(tag, props = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props)) {
    if (valor === false || valor == null) continue;
    if (chave === 'class') el.className = valor;
    else if (chave === 'checked' || chave === 'value') el[chave] = valor;
    else if (chave.startsWith('on')) el.addEventListener(chave.slice(2), valor);
    else el.setAttribute(chave, valor === true ? '' : valor);
  }
  for (const filho of filhos.flat()) {
    if (filho == null || filho === false) continue;
    el.append(filho.nodeType ? filho : document.createTextNode(String(filho)));
  }
  return el;
}

function mostrarTela(id) {
  for (const t of TELAS) $('#' + t).hidden = t !== id;
}

let temporizadorAviso;
function aviso(texto) {
  const toast = $('#toast');
  toast.textContent = texto;
  toast.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { toast.hidden = true; }, 4000);
}

async function tentar(fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    aviso(e.message || 'Erro inesperado');
  }
}

function checar(resposta) {
  if (resposta.error) throw resposta.error;
  return resposta.data;
}

// ---------------------------------------------------------------
// Autenticacao
// ---------------------------------------------------------------

db.auth.onAuthStateChange((evento, sessao) => {
  // Chamadas ao Supabase dentro deste callback podem travar; por isso o setTimeout.
  setTimeout(() => tratarSessao(evento, sessao), 0);
});

async function tratarSessao(evento, sessao) {
  if (!sessao) {
    estado.usuario = null;
    estado.carregado = false;
    return mostrarTela('tela-login');
  }
  if (evento === 'PASSWORD_RECOVERY' || (veioDeConviteOuRecuperacao && !senhaDefinida)) {
    return mostrarTela('tela-senha');
  }
  if (evento === 'TOKEN_REFRESHED' || evento === 'USER_UPDATED') return;
  if (estado.carregado && estado.usuario?.id === sessao.user.id) return;
  await entrar(sessao.user);
}

async function entrar(usuario) {
  estado.usuario = usuario;
  const { data } = await db
    .from('assinaturas')
    .select('status, valido_ate')
    .eq('user_id', usuario.id)
    .maybeSingle();

  // Esta checagem apenas escolhe a tela. A protecao real dos dados esta no RLS do banco.
  const ativa = data && data.status === 'ativa' && (!data.valido_ate || new Date(data.valido_ate) > new Date());
  if (!ativa) return mostrarTela('tela-sem-acesso');

  estado.carregado = true;
  mostrarTela('app');
  await tentar(carregarChecklists);
}

$('#form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = $('#login-msg');
  msg.textContent = '';
  const { error } = await db.auth.signInWithPassword({
    email: $('#login-email').value.trim(),
    password: $('#login-senha').value,
  });
  if (error) msg.textContent = 'E-mail ou senha inválidos.';
});

$('#btn-google').addEventListener('click', async () => {
  await db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
});

$('#btn-esqueci').addEventListener('click', async () => {
  const msg = $('#login-msg');
  const email = $('#login-email').value.trim();
  if (!email) {
    msg.textContent = 'Digite seu e-mail no campo acima e clique de novo.';
    return;
  }
  await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  msg.textContent = 'Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.';
});

$('#form-senha').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = $('#senha-msg');
  const a = $('#nova-senha').value;
  const b = $('#nova-senha2').value;
  if (a !== b) {
    msg.textContent = 'As senhas não são iguais.';
    return;
  }
  const { data, error } = await db.auth.updateUser({ password: a });
  if (error) {
    msg.textContent = error.message;
    return;
  }
  senhaDefinida = true;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  await entrar(data.user);
});

document.addEventListener('click', async (ev) => {
  if (ev.target.closest('[data-acao="sair"]')) {
    await db.auth.signOut();
  }
});

$('#btn-menu').addEventListener('click', () => document.body.classList.toggle('menu-aberto'));

// ---------------------------------------------------------------
// Dados
// ---------------------------------------------------------------

async function carregarChecklists() {
  estado.checklists = checar(await db.from('checklists').select('*').order('criado_em'));
  const idAtual = estado.atual?.id;
  const alvo = estado.checklists.find((c) => c.id === idAtual) ?? estado.checklists[0];
  await abrir(alvo?.id ?? null);
}

async function abrir(id) {
  const checklist = estado.checklists.find((c) => c.id === id);
  if (!checklist) {
    estado.atual = null;
    estado.secoes = [];
    estado.itens = [];
    renderLateral();
    renderConteudo();
    return;
  }
  estado.atual = checklist;
  const [s, i] = await Promise.all([
    db.from('secoes').select('*').eq('checklist_id', id).order('ordem'),
    db.from('itens').select('*, fotos_item(id, caminho, nome)').eq('checklist_id', id).order('ordem'),
  ]);
  estado.secoes = checar(s);
  estado.itens = checar(i);
  renderLateral();
  renderConteudo();
}

const recarregar = () => abrir(estado.atual?.id ?? null);

function proximaOrdem(lista) {
  return lista.reduce((max, x) => Math.max(max, x.ordem), 0) + 1;
}

async function apagarArquivos(caminhos) {
  if (!caminhos.length) return;
  const { error } = await db.storage.from('fotos').remove(caminhos);
  if (error) console.error('Falha ao apagar arquivos', error);
}

const caminhosDosItens = (itens) => itens.flatMap((i) => (i.fotos_item || []).map((f) => f.caminho));

// ---------------------------------------------------------------
// Acoes de checklist
// ---------------------------------------------------------------

async function criarChecklistComSecao(nome) {
  const novo = checar(await db.from('checklists').insert({ nome }).select().single());
  checar(await db.from('secoes').insert({ checklist_id: novo.id, nome: 'Itens', ordem: 1 }));
  return novo;
}

$('#btn-novo-checklist').addEventListener('click', () => tentar(async () => {
  const nome = prompt('Nome do novo checklist');
  if (!nome?.trim()) return;
  const novo = await criarChecklistComSecao(nome.trim());
  estado.atual = novo;
  await carregarChecklists();
}));

const renomearChecklist = () => tentar(async () => {
  const nome = prompt('Novo nome', estado.atual.nome);
  if (!nome?.trim() || nome.trim() === estado.atual.nome) return;
  checar(await db.from('checklists').update({ nome: nome.trim() }).eq('id', estado.atual.id));
  await carregarChecklists();
});

const excluirChecklist = () => tentar(async () => {
  if (!confirm(`Excluir o checklist "${estado.atual.nome}" com todos os itens e fotos?`)) return;
  const caminhos = caminhosDosItens(estado.itens);
  checar(await db.from('checklists').delete().eq('id', estado.atual.id));
  await apagarArquivos(caminhos);
  estado.atual = null;
  await carregarChecklists();
});

const duplicarChecklist = () => tentar(async () => {
  const nome = prompt('Nome da cópia', `${estado.atual.nome} 2`);
  if (!nome?.trim()) return;
  const novo = checar(await db.from('checklists').insert({ nome: nome.trim() }).select().single());
  for (const secao of estado.secoes) {
    const nova = checar(
      await db.from('secoes').insert({ checklist_id: novo.id, nome: secao.nome, ordem: secao.ordem }).select().single(),
    );
    const itens = estado.itens
      .filter((i) => i.secao_id === secao.id)
      .map((i) => ({ checklist_id: novo.id, secao_id: nova.id, descricao: i.descricao, ordem: i.ordem }));
    if (itens.length) checar(await db.from('itens').insert(itens));
  }
  estado.atual = novo;
  await carregarChecklists();
});

const limparMarcacoes = () => tentar(async () => {
  checar(await db.from('itens').update({ marcado: false }).eq('checklist_id', estado.atual.id));
  await recarregar();
});

// ---------------------------------------------------------------
// Acoes de secao
// ---------------------------------------------------------------

const novaSecao = () => tentar(async () => {
  const nome = prompt('Nome da nova seção');
  if (!nome?.trim()) return;
  checar(await db.from('secoes').insert({
    checklist_id: estado.atual.id,
    nome: nome.trim(),
    ordem: proximaOrdem(estado.secoes),
  }));
  await recarregar();
});

const renomearSecao = (secao) => tentar(async () => {
  const nome = prompt('Novo nome da seção', secao.nome);
  if (!nome?.trim() || nome.trim() === secao.nome) return;
  checar(await db.from('secoes').update({ nome: nome.trim() }).eq('id', secao.id));
  await recarregar();
});

const excluirSecao = (secao) => tentar(async () => {
  if (!confirm(`Excluir a seção "${secao.nome}" e seus itens?`)) return;
  const caminhos = caminhosDosItens(estado.itens.filter((i) => i.secao_id === secao.id));
  checar(await db.from('secoes').delete().eq('id', secao.id));
  await apagarArquivos(caminhos);
  await recarregar();
});

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const area = h('textarea', { value: texto, style: 'position:fixed;opacity:0' });
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

const copiarSecaoComoTexto = (secao) => tentar(async () => {
  const linhas = estado.itens.filter((i) => i.secao_id === secao.id).map((i) => `- ${i.descricao}`);
  await copiarTexto([secao.nome, ...linhas].join('\n'));
  aviso('Lista copiada');
});

// ---------------------------------------------------------------
// Acoes de item
// ---------------------------------------------------------------

async function adicionarItens(secao, texto) {
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\[[ xX]?\])\s*/, '').trim())
    .filter(Boolean)
    .map((l) => l.slice(0, 500));
  if (!linhas.length) return;
  const base = proximaOrdem(estado.itens.filter((i) => i.secao_id === secao.id));
  const registros = linhas.map((descricao, n) => ({
    checklist_id: estado.atual.id,
    secao_id: secao.id,
    descricao,
    ordem: base + n,
  }));
  checar(await db.from('itens').insert(registros));
  await recarregar();
}

async function marcar(item, marcado, linha) {
  item.marcado = marcado;
  linha.classList.toggle('feito', marcado);
  atualizarProgresso();
  const { error } = await db.from('itens').update({ marcado }).eq('id', item.id);
  if (error) {
    item.marcado = !marcado;
    linha.classList.toggle('feito', !marcado);
    linha.querySelector('input').checked = !marcado;
    atualizarProgresso();
    aviso('Não foi possível salvar a marcação');
  }
}

const editarItem = (item) => tentar(async () => {
  const texto = prompt('Editar item', item.descricao);
  if (!texto?.trim() || texto.trim() === item.descricao) return;
  checar(await db.from('itens').update({ descricao: texto.trim().slice(0, 500) }).eq('id', item.id));
  await recarregar();
});

const excluirItem = (item) => tentar(async () => {
  const caminhos = caminhosDosItens([item]);
  checar(await db.from('itens').delete().eq('id', item.id));
  await apagarArquivos(caminhos);
  await recarregar();
});

// ---------------------------------------------------------------
// Fotos
// ---------------------------------------------------------------

async function comprimir(arquivo, ladoMaximo = 1600, qualidade = 0.75) {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, falha) => {
    canvas.toBlob((blob) => (blob ? ok(blob) : falha(new Error('Falha ao comprimir a imagem'))), 'image/jpeg', qualidade);
  });
}

async function enviarFoto(item, arquivo) {
  const blob = await comprimir(arquivo);
  const caminho = `${estado.usuario.id}/${item.id}/${crypto.randomUUID()}.jpg`;

  const envio = await db.storage.from('fotos').upload(caminho, blob, { contentType: 'image/jpeg', upsert: false });
  if (envio.error) throw envio.error;

  const registro = await db
    .from('fotos_item')
    .insert({ item_id: item.id, caminho, nome: arquivo.name })
    .select('id, caminho, nome')
    .single();
  if (registro.error) {
    await apagarArquivos([caminho]);
    throw registro.error;
  }
  item.fotos_item.push(registro.data);
}

function abrirFotos(item) {
  const grade = h('div', { class: 'grade-fotos' });

  async function desenhar() {
    grade.replaceChildren();
    if (!item.fotos_item.length) {
      grade.append(h('p', {}, 'Nenhuma foto neste item.'));
      return;
    }
    const { data, error } = await db.storage
      .from('fotos')
      .createSignedUrls(item.fotos_item.map((f) => f.caminho), 3600);
    if (error) {
      aviso('Não foi possível carregar as fotos');
      return;
    }
    const urls = new Map(data.map((d) => [d.path, d.signedUrl]));
    for (const foto of item.fotos_item) {
      grade.append(
        h('figure', {},
          h('img', { src: urls.get(foto.caminho) ?? '', alt: foto.nome || 'Foto do item', loading: 'lazy' }),
          h('button', { type: 'button', class: 'link perigo', onclick: () => apagarFoto(foto) }, 'Excluir'),
        ),
      );
    }
  }

  async function apagarFoto(foto) {
    await tentar(async () => {
      checar(await db.from('fotos_item').delete().eq('id', foto.id));
      await apagarArquivos([foto.caminho]);
      item.fotos_item = item.fotos_item.filter((f) => f.id !== foto.id);
      await desenhar();
    });
  }

  const entrada = h('input', {
    type: 'file',
    accept: 'image/*',
    multiple: true,
    onchange: async (ev) => {
      const arquivos = [...ev.target.files];
      ev.target.value = '';
      for (const arquivo of arquivos) {
        if (item.fotos_item.length >= MAX_FOTOS_POR_ITEM) {
          aviso(`Limite de ${MAX_FOTOS_POR_ITEM} fotos por item`);
          break;
        }
        await tentar(() => enviarFoto(item, arquivo));
      }
      await desenhar();
    },
  });

  const dialogo = h('dialog', { class: 'modal', 'aria-label': 'Fotos do item' },
    h('div', { class: 'modal-topo' },
      h('h2', {}, item.descricao),
      h('button', { type: 'button', class: 'link', onclick: () => dialogo.close() }, 'Fechar'),
    ),
    grade,
    entrada,
  );
  dialogo.addEventListener('close', () => {
    dialogo.remove();
    renderConteudo();
  });
  document.body.append(dialogo);
  dialogo.showModal();
  desenhar();
}

// ---------------------------------------------------------------
// Renderizacao
// ---------------------------------------------------------------

function renderLateral() {
  const lista = $('#lista-checklists');
  lista.replaceChildren(
    ...estado.checklists.map((c) =>
      h('li', {},
        h('button', {
          type: 'button',
          'aria-current': c.id === estado.atual?.id ? 'true' : false,
          onclick: () => {
            document.body.classList.remove('menu-aberto');
            tentar(() => abrir(c.id));
          },
        }, c.nome),
      ),
    ),
  );
}

function atualizarProgresso() {
  const alvo = $('#progresso');
  if (!alvo) return;
  const feitos = estado.itens.filter((i) => i.marcado).length;
  alvo.textContent = `${feitos} de ${estado.itens.length} concluídos`;
}

function elItem(item) {
  const fotos = item.fotos_item || [];
  const linha = h('li', { class: 'item' + (item.marcado ? ' feito' : '') });
  linha.append(
    h('label', { class: 'item-texto' },
      h('input', { type: 'checkbox', checked: item.marcado, onchange: (ev) => marcar(item, ev.target.checked, linha) }),
      h('span', {}, item.descricao),
    ),
    h('button', { type: 'button', class: 'icone', 'aria-label': 'Fotos do item', onclick: () => abrirFotos(item) },
      icone('camera'),
      fotos.length ? h('span', { class: 'selo' }, fotos.length) : null,
    ),
    h('button', { type: 'button', class: 'icone', 'aria-label': 'Editar item', onclick: () => editarItem(item) }, icone('editar')),
    h('button', { type: 'button', class: 'icone', 'aria-label': 'Excluir item', onclick: () => excluirItem(item) }, icone('lixeira')),
  );
  return linha;
}

function elSecao(secao) {
  const itens = estado.itens.filter((i) => i.secao_id === secao.id);

  const campo = h('textarea', {
    class: 'novo-item',
    rows: '1',
    placeholder: 'Novo item (ou cole uma lista com vários itens)',
    'aria-label': `Novo item em ${secao.nome}`,
  });
  const enviar = () => {
    const texto = campo.value;
    campo.value = '';
    if (texto.trim()) tentar(() => adicionarItens(secao, texto));
  };
  campo.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      enviar();
    }
  });
  campo.addEventListener('input', () => {
    if (campo.value.includes('\n')) enviar();
  });

  return h('article', { class: 'secao' },
    h('div', { class: 'secao-topo' },
      h('h2', {}, secao.nome),
      h('button', { type: 'button', class: 'icone', 'aria-label': 'Copiar seção como texto', onclick: () => copiarSecaoComoTexto(secao) }, icone('copiar')),
      h('button', { type: 'button', class: 'icone', 'aria-label': 'Renomear seção', onclick: () => renomearSecao(secao) }, icone('editar')),
      h('button', { type: 'button', class: 'icone', 'aria-label': 'Excluir seção', onclick: () => excluirSecao(secao) }, icone('lixeira')),
    ),
    h('ul', { class: 'itens' }, itens.map(elItem)),
    campo,
  );
}

function renderConteudo() {
  const raiz = $('#conteudo');
  const titulo = $('#titulo-atual');

  if (!estado.atual) {
    titulo.textContent = 'ME-List';
    raiz.replaceChildren(h('p', { class: 'vazio' }, 'Nenhum checklist ainda. Use o botão "Novo checklist" para começar.'));
    return;
  }

  titulo.textContent = estado.atual.nome;
  raiz.replaceChildren(
    h('div', { class: 'acoes' },
      h('button', { type: 'button', class: 'secundario', onclick: renomearChecklist }, 'Renomear'),
      h('button', { type: 'button', class: 'secundario', onclick: duplicarChecklist }, 'Duplicar'),
      h('button', { type: 'button', class: 'secundario', onclick: limparMarcacoes }, 'Limpar marcações'),
      h('button', { type: 'button', class: 'secundario perigo', onclick: excluirChecklist }, 'Excluir'),
    ),
    h('p', { class: 'progresso', id: 'progresso' }),
    ...estado.secoes.map(elSecao),
    h('button', { type: 'button', class: 'secundario', onclick: novaSecao }, 'Nova seção'),
  );
  atualizarProgresso();
}
