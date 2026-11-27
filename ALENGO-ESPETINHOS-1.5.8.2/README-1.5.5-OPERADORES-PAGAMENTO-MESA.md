# ALENGO ESPETINHOS 1.5.5 — Atendimento compartilhado e recebimento na mesa

## Escopo desta evolução
- Permissões individuais dos operadores administradas exclusivamente em **Configurações → Operadores** no Windows.
- Permissões para enviar pedidos, compartilhar mesas, visualizar todas as mesas, receber pagamentos na mesa e cancelar pedidos remotos.
- Responsável principal opcional por mesa, configurado no Windows.
- Mesas compartilhadas: mais de um atendente pode trabalhar na mesma conta, mantendo o autor de cada pedido e pagamento.
- Site com painel de mesas e tela de recebimento, exibida somente quando o operador tem permissão.
- Pagamento integral da conta com até quatro formas de pagamento combinadas, incluindo taxa e parcelamento de cartão de crédito.
- Pagamento remoto processado automaticamente pelo serviço do Windows, sem confirmação manual de cada operação.
- Cada recebimento cria uma venda vinculada ao caixa aberto, registra o operador, gera histórico de auditoria e pode imprimir o comprovante na impressora do caixa.
- Chaves idempotentes para impedir duplicidade em repetição, timeout e sincronização.
- App Android 1.3.4 mantido sem alterações; o site local utiliza prefixo de identificação `web_` para aplicar permissões sem mudar o comportamento do app Android.

## Regras financeiras e de conectividade
1. O Windows concede previamente a permissão de recebimento ao operador.
2. O operador pode finalizar o recebimento no site sem ação manual no Windows.
3. O caixa precisa estar aberto. A permissão não permite receber com o caixa fechado.
4. O serviço Windows processa automaticamente os comandos `PAY_TABLE` pela fila remota, usando a rotina de pagamento já existente no SQLite.
5. Se o Windows estiver sem comunicação, o site mantém a solicitação pendente; não deve mostrar a conta como quitada antes do processamento. Ao restabelecer a comunicação, o mesmo identificador é reutilizado para evitar duplicidade.
6. A conta é quitada integralmente nesta versão. A interface aceita divisão do valor entre formas de pagamento (por exemplo, PIX + dinheiro). Divisão da conta por pessoa e pagamentos parciais com saldo remanescente não fazem parte deste pacote.
7. O estoque não é baixado novamente no pagamento; a baixa já ocorreu no registro da comanda.

## Instalação / atualização
1. Faça backup do banco de dados do Windows e do diretório de dados do aplicativo.
2. No Supabase SQL Editor, execute `supabase/migrations/20261120000400_alengo_table_payments.sql` depois das migrações 1.5.1, 1.5.2, 1.5.3 e 1.5.4 já aplicadas.
3. No Windows de desenvolvimento, extraia a fonte e execute `BUILD-ALENGO-ESPETINHOS-WINDOWS.bat`. O script instala dependências e gera o instalador 1.5.5.
4. Instale o Windows 1.5.5 no computador servidor. A migração SQLite de permissões e responsável por mesa é aditiva e automática.
5. Publique o conteúdo de `ALENGO-ATENDIMENTO-1.5.5-CLOUDFLARE-PAGES.zip` no projeto Pages existente `alengo-atendimento`.
6. Feche e abra novamente o site. Sessões locais antigas podem solicitar novo login uma vez para receber o identificador `web_` necessário à aplicação das permissões.
7. Em **Configurações → Operadores**, habilite o acesso remoto e configure as permissões de cada colaborador. Para receber na mesa, marque **Receber e finalizar pagamentos diretamente na mesa**.
8. Em **Pedidos e mesas**, atribua opcionalmente um responsável principal a cada mesa. A permissão de mesas compartilhadas permite apoio de outros operadores.
9. Abra o caixa no Windows antes de iniciar recebimentos pelo site.

## Validações ainda necessárias
- A suíte automatizada cobre contratos, permissões, fila, idempotência e interface. Ela não substitui teste com Supabase real, implantação Cloudflare, Windows instalado, impressora térmica e celulares reais.
- A confirmação de pagamento remoto depende do Windows servidor estar online e conectado ao Supabase para processar a fila; não há liquidação financeira autônoma no navegador enquanto o servidor estiver totalmente desligado.
- Não foi gerado instalador NSIS neste ambiente porque as dependências de build (`node_modules`) não estão instaladas.
