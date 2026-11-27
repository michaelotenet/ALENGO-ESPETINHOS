# Relatório de QA — ALENGO ESPETINHOS 1.5.8 (cópia de desenvolvimento)

## Resultado automatizado

- Testes: 60 aprovados, 0 falhas.
- `node --check`: arquivos JavaScript do Electron, Cloudflare Pages, mobile-web e testes.
- JSX: `src/main.jsx` e `src/restaurant.jsx` passaram pela análise sintática TypeScript.
- Geração XLSX testada: o arquivo de teste foi aberto e verificado como ZIP sem erros.
- SQLite: simulação de exclusão operacional com foreign keys ativadas passou, preservando os cadastros mestres usados no teste.

## Não executado neste ambiente

- `npm run build` não foi concluído porque o executável Vite não estava instalado.
- `npm ci` não pôde completar: a rede não respondeu dentro do tempo disponível e o modo offline indicou dependência ausente no cache local.
- Instalador Electron/Windows x64 não foi gerado.
- Não houve conexão com Supabase de produção para executar a limpeza ou validar a publicação dos novos snapshots.
- Não foram executados pedidos, pagamentos, cancelamentos ou impressão em equipamentos reais.

## Cuidados

- A limpeza operacional não foi executada.
- O banco de dados do usuário não foi acessado ou alterado.
- O repositório GitHub não foi alterado.
- A pasta `android-unchanged` foi mantida sem alterações.

## Próximo teste no Windows de desenvolvimento

1. Extrair a fonte em uma pasta de teste separada.
2. Executar `npm install`.
3. Executar `npm test`.
4. Executar `npm run build`.
5. Executar `BUILD-ALENGO-ESPETINHOS-WINDOWS.bat` para gerar o instalador.
6. Testar login, impressoras, histórico, sincronização e PWA antes de publicar.
