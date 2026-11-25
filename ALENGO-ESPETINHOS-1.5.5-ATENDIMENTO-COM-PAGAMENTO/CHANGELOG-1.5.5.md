# ALENGO ESPETINHOS 1.5.5

- Permissões individuais do atendimento Web gerenciadas no Windows.
- Responsável principal opcional por mesa e atendimento compartilhado.
- Painel Web de mesas e recebimento autorizado.
- Recebimento integral sem confirmação manual no Windows; o serviço Windows processa a fila automaticamente.
- Pagamento com até quatro formas combinadas, taxa de crédito e parcelamento.
- Idempotência local/remota e persistência da tentativa de recebimento no navegador.
- Caixa aberto obrigatório e auditoria por operador.
- Android 1.3.4 preservado.

Limitação desta versão: não inclui pagamento parcial com saldo remanescente nem divisão da conta por pessoa.

## 1.5.5.1 — estabilidade de entrada no Windows
- Campos de usuário e senha passaram a usar entrada nativa por referência, sem atualização React a cada caractere.
- A autenticação continua ocorrendo somente ao enviar o formulário.
- Removidos filtros de desfoque e transições pesadas da tela de login para reduzir custo de composição gráfica no Windows 10.
- Adicionados atributos de preenchimento automático e foco visível nos campos.
- Nenhuma alteração no aplicativo Android.


## 1.5.6 — correção de empacotamento
- Normalizada a versão SemVer para `1.5.6`, aceita pelo electron-builder.
- Substituído o ícone Lucide inexistente `ClipboardClock` por `ClipboardList`.
