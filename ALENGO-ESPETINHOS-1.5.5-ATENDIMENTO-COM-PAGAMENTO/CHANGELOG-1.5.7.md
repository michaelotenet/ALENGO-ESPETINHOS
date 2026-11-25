# ALENGO ESPETINHOS 1.5.7 — Atualização de interface e desempenho

## Windows
- Grade de mesas compactada, com cartões menores e dimensionamento fluido.
- Ajustes de espaçamento para telas paisagem, incluindo 1366x768.
- Redução de dimensões da navegação lateral e cabeçalho em telas menores.

## Atendimento web
- Central de notificações removida da tela inicial e disponibilizada em tela própria.
- Histórico de notificações com estados lido/não lido.
- Botão superior de voltar com navegação contextual entre as telas internas, preservando carrinho e dados digitados.
- Layout responsivo refinado para celular, tablet e desktop, mantendo a identidade grafite/dourado do ALENGO.
- Confirmação remota consulta o status com intervalo inicial menor e crescimento gradual, reduzindo a latência percebida sem aumentar indefinidamente a frequência.
- Polling de fila offline ajustado para 2,5 segundos; removida uma rotina redundante de atualização periódica.

## Compatibilidade e segurança
- Mantidos contratos de autenticação e tabelas Supabase, SQLite, pagamentos, impressão e idempotência.
- Nenhuma migração SQL nova.
- Nenhuma Secret Key incluída no pacote.
- Aplicativo Android 1.3.4 não foi alterado.
