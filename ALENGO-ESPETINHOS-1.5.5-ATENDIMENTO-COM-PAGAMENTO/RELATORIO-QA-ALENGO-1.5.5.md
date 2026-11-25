# Relatório QA — ALENGO ESPETINHOS 1.5.5

## Resultado automatizado
- Testes Node: 22/22 aprovados.
- `node --check`: módulos Electron, ponte remota, Web local, Cloudflare Pages e service workers.
- Transpilação de sintaxe JSX: `src/main.jsx` e `src/restaurant.jsx` sem diagnósticos.
- Pacotes ZIP: integridade verificada após geração.

## Alterações verificadas por contrato
- Permissões por operador salvas no SQLite Windows e fornecidas nos snapshots remotos.
- Atribuição opcional de responsável principal por mesa.
- Compartilhamento de mesas sem perder operador de origem do pedido.
- Recebimento remoto exige permissão individual concedida no Windows.
- Comando `PAY_TABLE` é processado automaticamente pelo serviço Windows, com caixa aberto obrigatório.
- Pagamento aceita até quatro formas de pagamento e exige que a soma dos valores-base corresponda ao total integral da conta.
- Chave de idempotência no site local e fila remota persistente para reduzir risco de duplicidade.
- App Android 1.3.4 não foi modificado.

## Não homologado neste ambiente
- Build real do Vite/React e instalador Windows NSIS.
- Execução da migração no Supabase de produção e publicação no Cloudflare Pages.
- Integração de ponta a ponta entre celulares, Windows, Supabase e impressora térmica.
- Pagamentos parciais, divisão da conta por pessoa e funcionamento com Windows servidor desligado não estão implementados nesta versão.
