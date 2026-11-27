# Relatório de QA — ALENGO ESPETINHOS 1.5.7

## Verificações executadas neste ambiente
- Sintaxe JavaScript do atendimento web (`node --check cloudflare-pages/app.js`): aprovada.
- Suíte automatizada existente: 24/24 testes aprovados.
- Contratos existentes de fila remota, autenticação, pagamentos, notificações, permissões, clientes e DPAPI: mantidos e cobertos pela suíte.
- Nenhuma migração SQL nova.
- Configuração pública do Cloudflare continua contendo somente a publishable key.
- Service worker recebeu novo identificador de cache para disponibilizar a interface atualizada.

## Limitações da validação
- Dependências `node_modules` não estão instaladas neste ambiente; portanto, não foi executado `vite build` nem `electron-builder`.
- Não foi gerado instalador Windows neste ambiente.
- Ajuste visual 1366x768 precisa de conferência no notebook Windows 10 real.
- Tempo real de sincronização precisa de homologação com o Windows ligado e o celular em rede externa.

## Homologação recomendada
1. Fazer backup normal do banco SQLite pelo próprio sistema.
2. Compilar e instalar a versão 1.5.7 no Windows.
3. Conferir mesas em 1366x768 e em outra resolução paisagem.
4. Publicar `cloudflare-pages` no projeto Pages existente.
5. No celular, sair e entrar novamente se necessário; o novo cache do PWA será instalado ao atualizar.
6. Testar pedido por 4G/5G, confirmação no Windows, impressão, notificação de pedido pronto e pagamento remoto autorizado.
7. Confirmar que pedido pendente não é reenviado como uma nova operação.
