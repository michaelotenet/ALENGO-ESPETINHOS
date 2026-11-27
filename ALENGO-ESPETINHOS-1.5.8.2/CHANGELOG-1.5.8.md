# ALENGO ESPETINHOS 1.5.8 — Atendimento, auditoria e segurança operacional

## Windows
- Histórico de atividades com filtros diário, semanal e mensal.
- Histórico filtrado por operador; o administrador pode consultar todos, enquanto o operador comum fica restrito ao próprio usuário.
- Exportação CSV e XLSX do histórico de atividades.
- Configurações reorganizadas em seções expansíveis.
- Configuração separada das impressoras de comandas da cozinha e dos comprovantes do caixa.
- Histórico completo de pedidos por dia, incluindo pedidos pagos e cancelados.
- Notificações visuais para solicitações de apoio feitas pelo atendimento web.

## Atendimento web / PWA
- Ação de instalação para navegadores compatíveis e instruções para iPhone/iPad.
- Histórico de pedidos por data, respeitando o operador autenticado.
- Repetição de pedido a partir do histórico, usando preços atuais e exigindo conferência antes do envio.
- Rascunho do carrinho salvo localmente por usuário/aparelho e opção para retomá-lo.
- Filtros por categoria e seção de produtos mais pedidos nos últimos 30 dias.
- Ação para chamar o responsável, com confirmação do Windows antes de indicar sucesso.
- Mesmas melhorias aplicadas ao site remoto e à cópia web local.

## Segurança e sincronização
- Identificador de geração operacional nos snapshots e solicitações remotas.
- Solicitações antigas são rejeitadas pelo Windows após mudança de geração.
- Filas offline e respostas em cache de gerações anteriores são descartadas quando o atendimento recebe o novo snapshot.
- Recurso de limpeza de dados operacionais de teste, exclusivo do administrador, com confirmação textual, backup verificado, bloqueios para caixa/pedidos/impressões pendentes e proteção fiscal.
- Limpeza coordenada com Supabase: preserva usuários e vínculos dos operadores, limpa solicitações e snapshots operacionais e publica novos snapshots.
- A limpeza não é executada automaticamente nem durante a atualização.

## Dados preservados pela limpeza
- Produtos, preços, categorias, kits, fichas técnicas e cadastros de ingredientes.
- Quantidades atuais de estoque; apenas os históricos de movimentação são limpos.
- Clientes e cadastros, mesas, operadores, permissões, credenciais, impressoras e preferências.
- Sessões móveis e vínculos remotos dos operadores.
- Documentos fiscais: se houver qualquer documento fiscal, a limpeza é bloqueada.

## Verificações desta cópia de desenvolvimento
- 60 testes automatizados aprovados.
- Sintaxe JavaScript validada com `node --check`.
- Sintaxe JSX validada com TypeScript `transpileModule`.
- Simulação SQLite da ordem de exclusão validada com chaves estrangeiras ativadas.
- A compilação Vite e o instalador Windows ainda precisam ser executados em um ambiente com dependências instaladas. Neste ambiente, `vite` não estava disponível e a instalação npm não pôde ser concluída por falta de acesso ao pacote em cache.

## Android
- A pasta `android-unchanged` não foi modificada nesta versão.
