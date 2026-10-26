# Guia completo: ME-List com GitHub + Supabase

Este guia leva você do zero até um app publicado, seguro e pronto para vender. Siga na ordem. Cada etapa diz o que fazer, por que fazer e como conferir que deu certo.

Observação: os nomes de menus do Supabase, do Stripe e do GitHub mudam com o tempo. Se algum botão estiver em outro lugar, procure pelo nome citado na busca da própria tela.

---

## 0. Visão geral

```
Navegador / celular da cliente
        |
        |  HTTPS
        v
GitHub Pages (docs/)  ---- arquivos estáticos: index.html, app.js, style.css
        |
        |  supabase-js (HTTPS, com o token de login da cliente)
        v
Supabase
  - Auth      : login, senha, convite por e-mail
  - Postgres  : tabelas + RLS (cada cliente só enxerga o que é dela)
  - Storage   : bucket privado "fotos"
  - Edge Function "webhook-compra": recebe o aviso de pagamento e libera o acesso
        ^
        |  webhook assinado
Stripe (ou Hotmart / Kiwify / Mercado Pago)
```

Diferenças em relação ao sistema atual (Google Sheets + Apps Script):

- Cada cliente tem uma conta de verdade, e não uma planilha configurada à mão.
- A segurança é aplicada pelo banco (RLS), e não depende do front-end ou de IDs corretos.
- Fotos ficam num bucket privado, em pasta separada por cliente, e não no seu Drive.
- Não existe mais OAuth no navegador para foto, então desaparece o problema do popup bloqueado.
- Você pode vender: o pagamento cria a conta e libera o acesso sozinho.

O que esta primeira versão faz: login, checklists, seções, itens, marcar, editar, colar lista com várias linhas, duplicar checklist, copiar seção como texto, fotos por item, limpar marcações. O que fica para as próximas fases: arrastar para reordenar, agenda/notificações, histórico e recorrência, PWA instalável.

---

## 1. Pré-requisitos

- Conta no GitHub (github.com).
- Conta no Supabase (supabase.com), entre com o próprio GitHub.
- Git instalado no computador (git-scm.com). Opcional se você preferir subir arquivos pelo navegador.
- Node.js instalado (nodejs.org) apenas para usar o Supabase CLI na etapa de venda.
- Um editor de texto (VS Code).
- Para vender: conta no Stripe, ou em uma plataforma brasileira (Hotmart, Kiwify, Eduzz, Mercado Pago).

---

## 2. Criar o repositório no GitHub

### 2.1 Criar

1. Em github.com, clique em New repository.
2. Nome: `melist` (ou o que preferir). Sem espaços.
3. Visibilidade: Public é o mais simples para o GitHub Pages no plano gratuito. Não tem problema, porque no repositório não ficam segredos (veja a seção de segurança). Se escolher Private, o Pages exige plano pago.
4. Marque Add a README? Não. Já existe um no zip.
5. Create repository.

### 2.2 Subir os arquivos

Descompacte o zip numa pasta, por exemplo `melist`. Abra o terminal nessa pasta:

```
git init
git add .
git commit -m "Primeira versao do ME-List"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/melist.git
git push -u origin main
```

Sem terminal: na página do repositório, clique em Add file > Upload files e arraste as pastas `docs` e `supabase` e os arquivos soltos.

### 2.3 Ligar o GitHub Pages

1. No repositório: Settings > Pages.
2. Source: Deploy from a branch.
3. Branch: `main`, pasta `/docs`. Save.
4. Em um ou dois minutos o site aparece em `https://SEU-USUARIO.github.io/melist/`. Anote essa URL, você vai usá-la no Supabase.

Por que a pasta `docs`: o Pages só aceita a raiz ou `/docs`. Deixamos o site em `docs` e o banco/funções em `supabase`, sem misturar.

---

## 3. Criar o projeto no Supabase

1. Entre em supabase.com/dashboard e clique em New project.
2. Organization: a que já vem criada para você.
3. Name: `melist`.
4. Database password: clique em Generate a password e guarde num gerenciador de senhas. Você raramente usará, mas não dá para recuperar.
5. Region: South America (São Paulo). Quanto mais perto das clientes, mais rápido.
6. Create new project. Aguarde uns dois minutos.

### 3.1 Pegar as chaves

Menu Project Settings > API (ou API Keys, conforme a versão do painel).

| Item | Para que serve | Pode ir para o GitHub? |
|---|---|---|
| Project URL | endereço do seu projeto | Sim |
| anon key (ou publishable key) | chave pública usada pelo navegador | Sim |
| service_role key (ou secret key) | chave administrativa que ignora todas as regras de segurança | NUNCA |

A chave anon é pública por desenho. Ela sozinha não dá acesso a nada, porque as tabelas só respondem a quem está logado e ainda passam pelo RLS. A chave service_role ignora o RLS: se vazar, qualquer pessoa lê e apaga tudo. Ela só será usada dentro da Edge Function, que a recebe do próprio Supabase.

### 3.2 Colocar as chaves no front-end

Edite `docs/config.js`:

```js
export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'sua-chave-anon-ou-publishable';
```

Salve, faça commit e push.

---

## 4. Criar as tabelas e as regras de segurança

1. No Supabase, menu SQL Editor > New query.
2. Abra `supabase/schema.sql`, copie tudo, cole e clique em Run.
3. Deve aparecer Success. Se der erro, não rode de novo pela metade: apague as tabelas criadas (Table Editor) ou crie um projeto novo e rode o arquivo inteiro de uma vez.

Conferir:

- Table Editor mostra: perfis, assinaturas, checklists, secoes, itens, fotos_item.
- Em cada tabela, o ícone de RLS aparece como ativado.
- Storage mostra o bucket `fotos` marcado como privado.

O que o arquivo criou, em linguagem simples:

- `assinaturas`: guarda se a cliente pagou (`status = 'ativa'`). A cliente pode ler a própria linha, mas não pode alterar. Só você (SQL Editor) e a Edge Function alteram.
- `checklists`, `secoes`, `itens`, `fotos_item`: cada linha tem `user_id`, preenchido automaticamente com o id de quem está logado.
- Regras RLS: cada cliente só enxerga e altera linhas em que `user_id` é o dela, e só se `tem_acesso()` for verdadeiro (assinatura ativa e dentro da validade).
- Regras extras de integridade: não dá para criar um item dentro de um checklist de outra pessoa, mesmo adulterando a requisição.
- Gatilho: quando uma conta nasce, o banco cria perfil e uma assinatura `inativa`.
- Bucket `fotos`: privado, só JPEG, máximo 2 MB por arquivo, com regras que só permitem acessar a pasta cujo nome é o id da própria cliente.

---

## 5. Configurar o login (Authentication)

Menu Authentication.

### 5.1 URLs

Authentication > URL Configuration:

- Site URL: `https://SEU-USUARIO.github.io/melist/` (com a barra final).
- Redirect URLs: adicione a mesma URL. Para testar no computador, adicione também `http://localhost:8000/`.

Isso faz os links dos e-mails (convite, recuperar senha) voltarem para o seu site e impede que alguém use o seu projeto para redirecionar para um site malicioso.

### 5.2 Desligar cadastro público

Authentication > Sign In / Providers (ou Settings): desative Allow new users to sign up.

Por que: o app é pago. Sem isso, qualquer pessoa que descobrisse a URL poderia criar conta (mesmo sem acesso, polui o banco e abre superfície de abuso). Com o cadastro desligado, só entram contas criadas por você ou pelo convite automático da compra. O convite por e-mail (feito pelo servidor) continua funcionando.

### 5.3 E-mail e senha

- Provider Email: ativado. Mantenha Confirm email ativado.
- Em Password requirements (se disponível): mínimo de 10 caracteres.
- Se o seu plano tiver a opção de bloquear senhas vazadas (leaked password protection), ative.

### 5.4 Templates de e-mail em português

Authentication > Email Templates. Traduza ao menos "Invite user" (convite) e "Reset password". Mantenha a variável do link (`{{ .ConfirmationURL }}`). Exemplo de convite:

```
Assunto: Seu acesso ao ME-List foi liberado
Corpo: Sua compra foi confirmada. Clique no link para criar sua senha e entrar: {{ .ConfirmationURL }}
```

### 5.5 SMTP próprio (importante para vender)

O envio de e-mails padrão do Supabase é só para testes e tem limite muito baixo por hora. Para vender, configure um SMTP próprio em Authentication > SMTP Settings. Opções comuns: Resend, Brevo, Amazon SES. Você precisará de um domínio seu para o remetente (ex.: `acesso@seudominio.com.br`) e configurar SPF/DKIM no DNS, senão os convites caem no spam.

### 5.6 Login com Google (opcional)

Só faça depois do básico funcionando. É preciso criar credenciais OAuth no Google Cloud Console e colar o Client ID e o Secret em Authentication > Providers > Google. Depois, em `docs/index.html`, remova o atributo `hidden` do botão `btn-google`. Com o cadastro público desligado, só entra pelo Google quem já tem conta com o mesmo e-mail.

---

## 6. Testar no seu computador

Na pasta do projeto:

```
cd docs
python -m http.server 8000
```

Abra `http://localhost:8000`. (Abrir o arquivo com duplo clique não funciona: módulos JavaScript exigem um servidor.)

### 6.1 Criar a sua conta e liberar seu acesso

1. Supabase > Authentication > Users > Add user > Create new user.
2. Digite seu e-mail e uma senha forte, marque Auto Confirm User. Create.
3. SQL Editor, rode (troque o e-mail):

```sql
update public.assinaturas
set status = 'ativa', plano = 'dono', provedor = 'manual', valido_ate = null
where user_id = public.user_id_por_email('camila.nanya@gmail.com');
```

4. Entre no app com esse e-mail e senha. Crie um checklist, adicione itens, cole uma lista de várias linhas, marque, anexe uma foto.

### 6.2 Conferir o que foi gravado

- Table Editor > itens: as linhas aparecem com o seu `user_id`.
- Storage > fotos: aparece uma pasta com o seu id e o arquivo `.jpg` dentro.

### 6.3 Teste de isolamento (faça uma vez, é o teste mais importante)

1. Crie uma segunda conta de teste (Add user) e libere com o SQL acima.
2. Entre com a segunda conta em outra janela anônima. Ela deve ver zero checklists.
3. Crie um checklist com ela. Volte à primeira conta: não deve aparecer.
4. Crie uma terceira conta sem liberar acesso: deve cair na tela "Acesso não liberado".

Se algum desses testes falhar, não venda. Reveja o `schema.sql`.

---

## 7. Segurança de login

O que o Supabase faz por você:

- Senhas guardadas com hash (nunca em texto puro).
- Sessão por token (JWT) de curta duração, renovado automaticamente.
- Limite de tentativas e de envios de e-mail.
- Links de convite e recuperação de uso único e com validade.

O que você configura (seção 5): cadastro público desligado, senha mínima de 10 caracteres, confirmação de e-mail, lista de URLs permitidas, SMTP próprio.

Boas práticas adicionais:

- Ative autenticação em dois fatores na sua conta do GitHub, do Supabase e do Stripe. Quem controla essas contas controla o produto.
- Para a sua conta de administradora, use senha longa e única.
- O Supabase oferece MFA (código no aplicativo autenticador) para usuários. Pode ser uma etapa futura, inclusive como diferencial.
- Opcional: ative CAPTCHA (Cloudflare Turnstile) em Authentication > Attack Protection se notar tentativas de abuso no login.

---

## 8. Segurança dos dados

Três camadas, todas ativas:

1. Login obrigatório: sem token válido, as tabelas não respondem. O papel `anon` teve todas as permissões revogadas no `schema.sql`.
2. RLS: mesmo logada, a cliente só enxerga linhas com o `user_id` dela. Isso é aplicado dentro do banco, então não adianta alguém alterar o JavaScript no navegador.
3. Bloqueio por assinatura: `tem_acesso()` faz o banco recusar tudo quando a assinatura não está ativa. Se a cliente cancelar, os dados ficam guardados, mas ela não consegue ler nem alterar.

Regras de ouro:

- A `service_role` nunca vai para o GitHub, para o `config.js` nem para o navegador.
- Toda tabela nova que você criar no futuro precisa de `enable row level security` e de policies. Tabela sem RLS em `public` é pública para quem tem a chave anon.
- No front-end, textos digitados pelas clientes são inseridos com `textContent` (função `h()` do `app.js`), nunca com `innerHTML`. Isso evita XSS. Mantenha essa regra ao evoluir o código.
- O `app.js` importa o supabase-js de uma CDN (esm.sh). Quando o app estiver estável, fixe a versão exata na URL de importação (por exemplo `@2.x.y`) para que uma atualização inesperada não altere o seu sistema. Uma melhoria futura é baixar a biblioteca e servi-la do próprio repositório.
- Endurecimento opcional: adicionar uma Content Security Policy via meta tag permitindo apenas seu próprio site, `esm.sh` e `*.supabase.co`.
- Backups: confira no painel (Database > Backups) o que o seu plano inclui. No plano gratuito você deve exportar o banco por conta própria. Para vender, use plano pago.

---

## 9. Segurança das imagens

- O bucket `fotos` é privado: não existe URL pública permanente.
- Cada arquivo fica em `<id_da_cliente>/<id_do_item>/<uuid>.jpg`. As policies de Storage só liberam leitura, envio e exclusão na pasta cujo primeiro nível é o id da própria cliente, e só com assinatura ativa.
- Para exibir, o app pede ao Supabase uma URL assinada que expira em 1 hora (`createSignedUrls`). Quem copiar o link não consegue usá-lo depois.
- O bucket só aceita JPEG e até 2 MB. O app já reduz a imagem (lado maior 1600 px, qualidade 0,75) antes do envio, então fica bem abaixo do limite.
- Ao excluir item, seção ou checklist, o app também apaga os arquivos do Storage (apagar a linha do banco sozinha não remove o arquivo).
- Limite de 10 fotos por item no front-end. Para um limite rígido por cliente, o caminho é criar uma regra no banco que conte as fotos antes de aceitar a inserção.
- Cuidado com o espaço: o plano gratuito tem limite de armazenamento. Avalie o plano pago antes de ter muitas clientes enviando fotos.

---

## 10. Como vender

### 10.1 Escolha do modelo

- Assinatura mensal ou anual: receita recorrente. O acesso é bloqueado se o pagamento falhar ou for cancelado.
- Pagamento único (acesso vitalício): mais simples, mas sem receita recorrente, e o custo de armazenamento fica por sua conta para sempre.
- Teste gratuito: use `valido_ate` na tabela `assinaturas` (veja `liberar_acesso.sql`).

### 10.2 Escolha da plataforma de pagamento

| Opção | Pontos fortes | Observação |
|---|---|---|
| Stripe | Link de pagamento pronto, assinaturas, webhooks bem documentados. A função deste projeto já está escrita para o Stripe. | Confirme no Stripe os meios de pagamento disponíveis para contas brasileiras (cartão, Pix, boleto) e as taxas atuais. |
| Hotmart, Kiwify, Eduzz | Muito usadas no Brasil, aceitam Pix e boleto, cuidam de checkout, afiliados e emissão de recibos. | Enviam webhook com formato próprio. A função precisa ser adaptada (veja 10.7). |
| Mercado Pago | Conhecido do público brasileiro. | Também exige adaptação. |

Como você tem CNPJ, verifique com a sua contabilidade a emissão de nota fiscal e o enquadramento da atividade (software/licenciamento) antes de começar a vender.

### 10.3 Publicar a Edge Function (webhook de compra)

A Edge Function é o código que roda no servidor do Supabase e recebe o aviso do Stripe. Ela usa a service_role de forma segura.

Instale o Supabase CLI e entre:

```
npm install -g supabase
supabase login
```

Na pasta do projeto (onde está a pasta `supabase`):

```
supabase link --project-ref SEU_PROJECT_REF
```

O project ref é o trecho do endereço do projeto: `https://SEU_PROJECT_REF.supabase.co`.

Cadastre os segredos (use `sk_test_` enquanto testa):

```
supabase secrets set STRIPE_SECRET_KEY=sk_test_xxx
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
supabase secrets set SITE_URL=https://SEU-USUARIO.github.io/melist/
```

O `STRIPE_WEBHOOK_SECRET` você só terá no passo 10.4; pode cadastrar um valor provisório e trocar depois.

Publique a função. O Stripe não envia o token do Supabase, então a verificação de JWT precisa ficar desligada; a segurança vem da assinatura do Stripe, que a função confere:

```
supabase functions deploy webhook-compra --no-verify-jwt
```

O endereço da função será:

```
https://SEU_PROJECT_REF.supabase.co/functions/v1/webhook-compra
```

### 10.4 Configurar o Stripe

1. Em dashboard.stripe.com, ative o Test mode.
2. Products > Add product: nome ME-List, preço recorrente mensal (ou único).
3. Payment Links > New: escolha o produto. Em opções, ative a coleta do e-mail do cliente (o Stripe sempre coleta no checkout). Copie o link de pagamento: é a sua página de venda mais simples.
4. Developers > Webhooks > Add endpoint:
   - URL: o endereço da função acima.
   - Eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`.
5. Copie o Signing secret (`whsec_...`) e cadastre com `supabase secrets set STRIPE_WEBHOOK_SECRET=...`.

### 10.5 Testar a venda ponta a ponta

1. Abra o Payment Link em modo de teste e pague com o cartão de teste do Stripe `4242 4242 4242 4242`, qualquer data futura e qualquer CVC. Use um e-mail seu que ainda não exista no projeto.
2. Em Developers > Webhooks, veja se o evento foi entregue com resposta 200.
3. Em Supabase > Authentication > Users, a conta deve ter sido criada.
4. Na caixa de entrada, chega o convite. Clique, defina a senha, entre.
5. No SQL Editor, rode o `select` do final de `liberar_acesso.sql`: a linha deve estar `ativa`.
6. Teste também o cancelamento: no Stripe, cancele a assinatura de teste e confirme que o status vira `cancelada` e o app mostra "Acesso não liberado".
7. Se algo falhar, veja os logs em Supabase > Edge Functions > webhook-compra > Logs.

Quando tudo funcionar, repita a configuração no Stripe em modo real (chaves `sk_live_`, novo webhook, novo `whsec_`).

### 10.6 Página de venda

O app (`docs/index.html`) é só para quem já comprou. Faça uma página separada de vendas (pode ser outra página no mesmo repositório, em Instagram/link na bio, ou na própria Hotmart/Kiwify) com o botão que leva ao link de pagamento. Inclua: o que o app faz, preço, política de reembolso, Termos de Uso e Política de Privacidade.

### 10.7 Se usar Hotmart, Kiwify, Eduzz ou Mercado Pago

A lógica é a mesma, só muda o formato do aviso:

1. Crie a função nova copiando `webhook-compra` (por exemplo `webhook-hotmart`).
2. Troque a verificação do Stripe pela verificação da plataforma (a Hotmart envia um token fixo no cabeçalho, conhecido como hottok; confira a documentação atual de cada plataforma).
3. Leia o e-mail, o nome e o status da compra no JSON recebido.
4. Mantenha o restante igual: buscar usuário por e-mail, convidar se não existir, atualizar `assinaturas`.
5. Mapeie os eventos de compra aprovada (liberar) e de reembolso, chargeback ou cancelamento (bloquear).

Se quiser, peça numa próxima conversa a versão pronta para a plataforma que escolher.

---

## 11. Como enviar o acesso quando alguém comprar

### 11.1 Fluxo automático (o normal)

1. A cliente paga no link do Stripe (ou da plataforma).
2. O webhook chama a função `webhook-compra`.
3. A função verifica a assinatura do aviso, cria a conta e dispara o e-mail de convite do Supabase.
4. A cliente clica no link do e-mail, cai no app já logada, na tela "Definir senha".
5. Ela define a senha, e a partir daí entra com e-mail e senha.
6. A função grava `assinaturas.status = 'ativa'`.

Você não precisa fazer nada. A mensagem de boas-vindas (o e-mail de convite) é o template da seção 5.4. Acrescente, na confirmação da compra do Stripe ou da plataforma, a URL do app e um e-mail de suporte.

### 11.2 Liberar manualmente (venda por Pix direto, cortesia, parceira)

1. Authentication > Users > Invite user, digite o e-mail. A pessoa recebe o convite.
2. SQL Editor, rode o primeiro comando de `supabase/liberar_acesso.sql` com o e-mail dela.

Para dar acesso por 30 dias de teste, use o segundo comando. Para bloquear, o terceiro.

### 11.3 Problemas comuns

- A cliente diz que não recebeu o e-mail: confira a pasta de spam, se o SMTP próprio está configurado e se o e-mail digitado na compra está correto. Você pode reenviar o convite em Authentication > Users.
- O link do convite expirou: apague a conta no painel e reenvie o convite, ou use "Send password recovery" para gerar um novo link.
- Cliente que já tinha conta e comprou de novo: a função reconhece o e-mail e só reativa a assinatura.
- Ela entra, mas vê "Acesso não liberado": veja no `select` do `liberar_acesso.sql` se `status` está `ativa`. Em pagamento por boleto ou Pix pode haver demora até o pagamento ser confirmado.

---

## 12. Custos e limites

Confira sempre a página de preços atual do Supabase, do GitHub e do Stripe. Pontos de atenção:

- O plano gratuito do Supabase é bom para desenvolver e testar. Projetos gratuitos podem ser pausados por inatividade, têm limite de banco e de armazenamento e menos garantias de backup. Para vender, planeje usar o plano pago.
- O Stripe cobra taxa por transação.
- Domínio próprio (opcional, mas recomendado) e SMTP têm custo baixo ou plano gratuito inicial.

---

## 13. LGPD e responsabilidades

Você passa a guardar dados pessoais de clientes (e-mail, nome, conteúdo das listas e fotos). Antes de vender:

- Publique Política de Privacidade e Termos de Uso, informando quais dados são guardados, para que, e onde (servidores do Supabase).
- Ofereça um canal para a cliente pedir exportação ou exclusão da conta. Para excluir: Authentication > Users > Delete user apaga a conta e, por causa do `on delete cascade`, todas as linhas dela. Os arquivos em Storage precisam ser apagados manualmente (Storage > fotos > pasta com o id da cliente).
- Não peça mais dados do que o necessário.
- Consulte um profissional jurídico para revisar os textos.

---

## 14. Lista de conferência antes de lançar

- [ ] Teste de isolamento entre duas contas passou (seção 6.3).
- [ ] Cadastro público desligado.
- [ ] SMTP próprio configurado e convite chegando na caixa de entrada.
- [ ] Nenhuma chave `service_role`, `sk_live_` ou `whsec_` no repositório (busque no GitHub por essas palavras).
- [ ] 2FA ativado no GitHub, Supabase e Stripe.
- [ ] Venda de teste e cancelamento de teste funcionando.
- [ ] Venda real de baixo valor feita por você mesma, com reembolso depois.
- [ ] Termos, Política de Privacidade e e-mail de suporte publicados.
- [ ] Plano do Supabase adequado e backups conferidos.

---

## 15. Próximas fases sugeridas

1. Reordenar itens e seções arrastando (Pointer Events, como no sistema antigo), gravando a coluna `ordem`.
2. PWA instalável: `manifest.json`, ícones e service worker.
3. Recorrência e histórico: as colunas `registrar_historico` e `zerar_diario` já existem em `checklists`. Falta criar a tabela `historico` e uma rotina agendada (pg_cron ou Edge Function agendada) para zerar marcações.
4. Notificações push (por exemplo OneSignal) e lembretes.
5. Importar seus checklists atuais da planilha: exportar as abas para CSV e importar pelo Table Editor, ou gerar um script de migração.
6. Área de administração para ver clientes e status sem usar SQL.
7. Página de vendas própria e domínio personalizado no GitHub Pages.

---

## 16. Mapa dos arquivos

| Arquivo | O que faz |
|---|---|
| `docs/index.html` | telas: login, definir senha, sem acesso, app |
| `docs/style.css` | visual com tema claro e escuro automático |
| `docs/config.js` | URL e chave pública do Supabase (você edita) |
| `docs/app.js` | toda a lógica: login, listas, itens, fotos |
| `supabase/schema.sql` | tabelas, RLS, funções, bucket de fotos |
| `supabase/liberar_acesso.sql` | comandos para liberar, limitar, bloquear e listar clientes |
| `supabase/functions/webhook-compra/index.ts` | libera o acesso quando o pagamento é confirmado |
| `supabase/.env.example` | modelo dos segredos da função (não suba o arquivo real) |
