// Camada de dados do ME-List.
// Recebe as mesmas chamadas que a interface sempre fez (chamarBackend) e executa tudo no Supabase.
// A seguranca real fica no banco (RLS) e no bucket privado; aqui so se traduz o formato dos dados.

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let usuarioAtual = null;
const caminhosFotos = {};
let filaEscrita = Promise.resolve();

function acessoAtivo(assinatura) {
  return !!assinatura && assinatura.status === 'ativa' &&
    (!assinatura.valido_ate || new Date(assinatura.valido_ate) > new Date());
}

// Garante que existe login e assinatura ativa. Caso contrario, volta para o login.
async function exigirLogin() {
  const { data } = await db.auth.getSession();
  const sessao = data.session;
  if (!sessao) {
    window.location.replace('login.html');
    return null;
  }

  const [assinatura, perfil] = await Promise.all([
    db.from('assinaturas').select('status, valido_ate').eq('user_id', sessao.user.id).maybeSingle(),
    db.from('perfis').select('nome').eq('id', sessao.user.id).maybeSingle()
  ]);

  if (!acessoAtivo(assinatura.data)) {
    await db.auth.signOut();
    window.location.replace('login.html?motivo=sem-acesso');
    return null;
  }

  const nome = (perfil.data && perfil.data.nome) || sessao.user.email.split('@')[0];
  usuarioAtual = {
    id: sessao.user.id,
    email: sessao.user.email,
    nome: nome,
    primeiroNome: nome.split(' ')[0]
  };
  return usuarioAtual;
}

async function sair() {
  await db.auth.signOut();
  window.location.replace('login.html');
}

// A integracao com a Google Agenda nao existe nesta versao; o resto do codigo continua igual.
function obterTokenAgenda(aoReceber) {
  aoReceber(null);
}

// ---------- utilitarios ----------

function uuid() {
  return crypto.randomUUID();
}

function agoraLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return {
    data: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()),
    hora: p(d.getHours()) + ':' + p(d.getMinutes())
  };
}

function enfileirar(fn) {
  const execucao = filaEscrita.then(fn);
  filaEscrita = execucao.catch(function () {});
  return execucao;
}

function conferir(resposta) {
  if (resposta.error) throw resposta.error;
  return resposta.data;
}

async function buscarTudo(montar) {
  const tamanho = 1000;
  let tudo = [];
  for (let de = 0; ; de += tamanho) {
    const lote = conferir(await montar().range(de, de + tamanho - 1));
    tudo = tudo.concat(lote);
    if (lote.length < tamanho) break;
  }
  return tudo;
}

async function inserirEmLotes(tabela, linhas) {
  for (let i = 0; i < linhas.length; i += 500) {
    conferir(await db.from(tabela).insert(linhas.slice(i, i + 500)));
  }
}

async function caminhosDeItens(ids) {
  let caminhos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const fotos = conferir(await db.from('fotos_item').select('caminho').in('item_id', ids.slice(i, i + 50)));
    caminhos = caminhos.concat(fotos.map(function (f) { return f.caminho; }));
  }
  return caminhos;
}

async function idsDeItens(filtroColuna, valor) {
  const itens = await buscarTudo(function () {
    return db.from('itens').select('id').eq(filtroColuna, valor).order('id');
  });
  return itens.map(function (i) { return i.id; });
}

async function apagarArquivos(caminhos) {
  for (let i = 0; i < caminhos.length; i += 100) {
    const { error } = await db.storage.from('fotos').remove(caminhos.slice(i, i + 100));
    if (error) console.error('Falha ao apagar arquivos de foto', error);
  }
}

function blobParaBase64(blob) {
  return new Promise(function (resolver, rejeitar) {
    const leitor = new FileReader();
    leitor.onerror = function () { rejeitar(new Error('Não foi possível ler a foto.')); };
    leitor.onload = function () { resolver(String(leitor.result).split(',')[1]); };
    leitor.readAsDataURL(blob);
  });
}

function base64ParaBlob(base64, tipoMime) {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: tipoMime });
}

async function listarFotos(idItem) {
  const fotos = conferir(
    await db.from('fotos_item').select('id, caminho, nome').eq('item_id', idItem).order('criado_em')
  );
  for (const f of fotos) caminhosFotos[f.id] = f.caminho;
  return fotos.map(function (f) { return { id: f.id, nome: f.nome }; });
}

async function proximaOrdem(tabela, coluna, valor) {
  const linhas = conferir(
    await db.from(tabela).select('ordem').eq(coluna, valor).order('ordem', { ascending: false }).limit(1)
  );
  return (linhas.length ? linhas[0].ordem : 0) + 1;
}

// ---------- acoes ----------

const acoes = {

  async obterPainel() {
    const [checklists, secoes, itens] = await Promise.all([
      buscarTudo(function () { return db.from('checklists').select('*').order('criado_em').order('id'); }),
      buscarTudo(function () { return db.from('secoes').select('*').order('ordem').order('id'); }),
      buscarTudo(function () {
        return db.from('itens').select('*, fotos_item(id, caminho, nome, criado_em)').order('ordem').order('id');
      })
    ]);

    return {
      checklists: checklists.map(function (c) {
        return {
          id: c.id,
          nome: c.nome,
          registrarHistorico: c.registrar_historico,
          zerarDiario: c.zerar_diario,
          secoes: secoes
            .filter(function (s) { return s.checklist_id === c.id; })
            .map(function (s) { return { id: s.id, nome: s.nome }; }),
          itens: itens
            .filter(function (i) { return i.checklist_id === c.id; })
            .map(function (i) {
              const fotos = (i.fotos_item || []).slice().sort(function (a, b) {
                return String(a.criado_em).localeCompare(String(b.criado_em));
              });
              for (const f of fotos) caminhosFotos[f.id] = f.caminho;
              return {
                id: i.id,
                descricao: i.descricao,
                ordem: i.ordem,
                marcado: i.marcado,
                idSecao: i.secao_id || '',
                fotos: fotos.map(function (f) { return { id: f.id, nome: f.nome }; })
              };
            })
        };
      })
    };
  },

  async criarChecklist(d) {
    const id = uuid();
    conferir(await db.from('checklists').insert({ id: id, nome: d.nome }));
    return { id: id };
  },

  async renomearChecklist(d) {
    conferir(await db.from('checklists').update({ nome: d.nome }).eq('id', d.idChecklist));
    return {};
  },

  async excluirChecklist(d) {
    const caminhos = await caminhosDeItens(await idsDeItens('checklist_id', d.idChecklist));
    conferir(await db.from('checklists').delete().eq('id', d.idChecklist));
    await apagarArquivos(caminhos);
    return {};
  },

  async duplicarChecklist(d) {
    const [secoes, itens] = await Promise.all([
      db.from('secoes').select('*').eq('checklist_id', d.idChecklist).order('ordem'),
      buscarTudo(function () {
        return db.from('itens').select('*').eq('checklist_id', d.idChecklist).order('ordem').order('id');
      })
    ]);
    const secoesOrigem = conferir(secoes);

    const idNovo = uuid();
    conferir(await db.from('checklists').insert({ id: idNovo, nome: d.nome }));

    const mapa = {};
    const novasSecoes = secoesOrigem.map(function (s) {
      mapa[s.id] = uuid();
      return { id: mapa[s.id], checklist_id: idNovo, nome: s.nome, ordem: s.ordem };
    });
    if (novasSecoes.length) await inserirEmLotes('secoes', novasSecoes);

    const novosItens = itens.map(function (i) {
      return {
        id: uuid(),
        checklist_id: idNovo,
        secao_id: i.secao_id ? mapa[i.secao_id] : null,
        descricao: i.descricao,
        ordem: i.ordem,
        marcado: false
      };
    });
    if (novosItens.length) await inserirEmLotes('itens', novosItens);

    return {
      id: idNovo,
      nome: d.nome,
      secoes: novasSecoes.map(function (s) { return { id: s.id, nome: s.nome }; }),
      itens: novosItens.map(function (i) {
        return { id: i.id, descricao: i.descricao, ordem: i.ordem, marcado: false, idSecao: i.secao_id || '', fotos: [] };
      })
    };
  },

  async enviarChecklist(d) {
    conferir(await db.rpc('enviar_checklist', { p_checklist_id: d.idChecklist, p_email: d.email }));
    return {};
  },

  async listarEnvios() {
    const linhas = conferir(
      await db.from('envios_checklist').select('id, nome_remetente, nome_checklist').order('criado_em')
    );
    return { envios: linhas };
  },

  async aceitarEnvio(d) {
    conferir(await db.rpc('aceitar_checklist', { p_envio_id: d.idEnvio }));
    return {};
  },

  async recusarEnvio(d) {
    conferir(await db.from('envios_checklist').delete().eq('id', d.idEnvio));
    return {};
  },

  async definirConfigChecklist(d) {
    conferir(await db.from('checklists')
      .update({ registrar_historico: !!d.registrarHistorico, zerar_diario: !!d.zerarDiario })
      .eq('id', d.idChecklist));
    return {};
  },

  async criarSecao(d) {
    return enfileirar(async function () {
      const id = uuid();
      const ordem = await proximaOrdem('secoes', 'checklist_id', d.idChecklist);
      conferir(await db.from('secoes').insert({ id: id, checklist_id: d.idChecklist, nome: d.nome, ordem: ordem }));
      return { id: id };
    });
  },

  async renomearSecao(d) {
    conferir(await db.from('secoes').update({ nome: d.nome }).eq('id', d.idSecao));
    return {};
  },

  async excluirSecao(d) {
    const caminhos = await caminhosDeItens(await idsDeItens('secao_id', d.idSecao));
    conferir(await db.from('secoes').delete().eq('id', d.idSecao));
    await apagarArquivos(caminhos);
    return {};
  },

  async reordenarSecoes(d) {
    const resultados = await Promise.all(d.ids.map(function (id, i) {
      return db.from('secoes').update({ ordem: i + 1 }).eq('id', id);
    }));
    resultados.forEach(conferir);
    return {};
  },

  async adicionarItem(d) {
    return enfileirar(async function () {
      const id = uuid();
      const ordem = await proximaOrdem('itens', 'checklist_id', d.idChecklist);
      conferir(await db.from('itens').insert({
        id: id,
        checklist_id: d.idChecklist,
        secao_id: d.idSecao || null,
        descricao: String(d.descricao).slice(0, 500),
        ordem: ordem
      }));
      return { id: id };
    });
  },

  async renomearItem(d) {
    conferir(await db.from('itens').update({ descricao: String(d.descricao).slice(0, 500) }).eq('id', d.idItem));
    return {};
  },

  async excluirItem(d) {
    const caminhos = await caminhosDeItens([d.idItem]);
    conferir(await db.from('itens').delete().eq('id', d.idItem));
    await apagarArquivos(caminhos);
    return {};
  },

  async marcarItem(d) {
    conferir(await db.from('itens').update({ marcado: !!d.marcar }).eq('id', d.idItem));
    return {};
  },

  async reordenarItens(d) {
    const resultados = await Promise.all(d.ids.map(function (id, i) {
      return db.from('itens').update({ ordem: i + 1 }).eq('id', id);
    }));
    resultados.forEach(conferir);
    return {};
  },

  async copiarSecao(d) {
    const origem = conferir(await db.from('secoes').select('*').eq('id', d.idSecaoOrigem).single());
    const itensOrigem = conferir(
      await db.from('itens').select('descricao, ordem').eq('secao_id', d.idSecaoOrigem).order('ordem')
    );

    let idDestino = d.idChecklistDestino;
    let nomeDestino;
    if (d.nomeNovoChecklist) {
      idDestino = uuid();
      nomeDestino = d.nomeNovoChecklist;
      conferir(await db.from('checklists').insert({ id: idDestino, nome: nomeDestino }));
    } else {
      nomeDestino = conferir(await db.from('checklists').select('nome').eq('id', idDestino).single()).nome;
    }

    const secaoNova = { id: uuid(), nome: origem.nome };
    const ordemSecao = await proximaOrdem('secoes', 'checklist_id', idDestino);
    conferir(await db.from('secoes').insert({
      id: secaoNova.id, checklist_id: idDestino, nome: secaoNova.nome, ordem: ordemSecao
    }));

    const base = (await proximaOrdem('itens', 'checklist_id', idDestino)) - 1;
    const novosItens = itensOrigem.map(function (i, n) {
      return {
        id: uuid(),
        checklist_id: idDestino,
        secao_id: secaoNova.id,
        descricao: i.descricao,
        ordem: base + n + 1,
        marcado: false
      };
    });
    if (novosItens.length) await inserirEmLotes('itens', novosItens);

    return {
      idChecklistDestino: idDestino,
      nomeChecklistDestino: nomeDestino,
      secaoNova: secaoNova,
      itens: novosItens.map(function (i) {
        return { id: i.id, descricao: i.descricao, ordem: i.ordem, marcado: false, idSecao: secaoNova.id, fotos: [] };
      })
    };
  },

  async salvarHistorico(d) {
    const checklist = conferir(await db.from('checklists').select('id, nome').eq('id', d.idChecklist).single());
    const itens = await buscarTudo(function () {
      return db.from('itens').select('marcado').eq('checklist_id', d.idChecklist).order('id');
    });
    const quando = agoraLocal();
    conferir(await db.from('historico').insert({
      checklist_id: checklist.id,
      nome_checklist: checklist.nome,
      itens_total: itens.length,
      itens_marcados: itens.filter(function (i) { return i.marcado; }).length,
      data: quando.data,
      hora: quando.hora
    }));
    return { data: quando.data, hora: quando.hora };
  },

  async obterHistorico() {
    const linhas = conferir(
      await db.from('historico').select('*').order('criado_em', { ascending: false }).limit(300)
    );
    return {
      entradas: linhas.map(function (l) {
        return {
          nomeChecklist: l.nome_checklist,
          itensTotal: l.itens_total,
          itensMarcados: l.itens_marcados,
          data: l.data,
          hora: l.hora
        };
      })
    };
  },

  async obterFotoItem(d) {
    let caminho = caminhosFotos[d.idArquivo];
    if (!caminho) {
      caminho = conferir(await db.from('fotos_item').select('caminho').eq('id', d.idArquivo).single()).caminho;
      caminhosFotos[d.idArquivo] = caminho;
    }
    const blob = conferir(await db.storage.from('fotos').download(caminho));
    return { dadosBase64: await blobParaBase64(blob), tipoMime: 'image/jpeg' };
  },

  async adicionarFotoItem(d) {
    const existentes = conferir(await db.from('fotos_item').select('id').eq('item_id', d.idItem));
    if (existentes.length >= 10) throw new Error('Limite de 10 fotos por item.');

    const caminho = usuarioAtual.id + '/' + d.idItem + '/' + uuid() + '.jpg';
    const blob = base64ParaBlob(d.dadosBase64, 'image/jpeg');
    const envio = await db.storage.from('fotos').upload(caminho, blob, { contentType: 'image/jpeg', upsert: false });
    if (envio.error) throw envio.error;

    const registro = await db.from('fotos_item')
      .insert({ item_id: d.idItem, caminho: caminho, nome: d.nomeArquivo || 'foto.jpg' })
      .select('id')
      .single();
    if (registro.error) {
      await apagarArquivos([caminho]);
      throw registro.error;
    }
    caminhosFotos[registro.data.id] = caminho;
    return { id: registro.data.id, fotos: await listarFotos(d.idItem) };
  },

  async apagarFotoItem(d) {
    const foto = conferir(await db.from('fotos_item').select('caminho').eq('id', d.idArquivo).single());
    conferir(await db.from('fotos_item').delete().eq('id', d.idArquivo));
    await apagarArquivos([foto.caminho]);
    delete caminhosFotos[d.idArquivo];
    return { fotos: await listarFotos(d.idItem) };
  }
};

async function chamarBackend(acao, dados) {
  const funcao = acoes[acao];
  if (!funcao) return { ok: false, erro: 'Este recurso ainda não está disponível.' };
  try {
    const resultado = await funcao(dados || {});
    return Object.assign({ ok: true }, resultado);
  } catch (erro) {
    console.error('Falha em ' + acao, erro);
    return { ok: false, erro: (erro && erro.message) || 'Não foi possível concluir. Tente novamente.' };
  }
}
