# QA — ALENGO ESPETINHOS 1.5.8.2

## Verificações executadas
- Testes automatizados: 76 aprovados, 0 falhas.
- `node --check`: app web, service workers e módulos Electron validados.
- Testes de protocolo Push: assinatura VAPID ES256 verificada, payload aes128gcm descriptografado pelo teste com a chave do assinante e limpeza de endpoints expirados verificada.
- Arquivos de áudio WAV: 5 arquivos originais gerados e incluídos nas duas distribuições web.
- Cópias `cloudflare-pages` e `mobile-web`: JavaScript e CSS sincronizados; service workers mantêm escopos/cache próprios.
- Migration Web Push: inclui todos os tipos de solicitação remota existentes e os novos comandos de registro/remoção.
- Chave privada VAPID armazenada criptografada via Electron safeStorage; snapshot expõe somente a chave pública.
- A inscrição Push fica vinculada ao usuário autenticado e ao operador Windows; logout remove a inscrição do aparelho.
- Pasta Android original não foi modificada.

## Não executado neste ambiente
- `npm run build` e instalador Windows não foram gerados: `node_modules` não está presente e as dependências não foram instaladas.
- Não foi possível testar Push real contra serviços Google/Apple/Mozilla ou em aparelhos físicos.
- Migration SQL ainda precisa ser aplicada no projeto Supabase antes de registrar inscrições.
- O Windows precisa estar atualizado para 1.5.8.2, em execução e conectado à internet para enviar Push.
- Não houve publicação do pacote no Cloudflare Pages nem alteração no GitHub.

## Teste prático recomendado
1. Atualizar o Windows para a 1.5.8.2 e executar o PDV com acesso remoto habilitado.
2. Aplicar `supabase/migrations/20261125000100_alengo_web_push_commands.sql` no Supabase.
3. Publicar o conteúdo do pacote Cloudflare Pages.
4. Abrir o site, entrar como operador, acessar Notificações e ativar Push.
5. Com a página aberta, testar os cinco sons e volume.
6. Minimizar/bloquear o aparelho e marcar um pedido como parcialmente pronto e depois completamente pronto no Windows.
7. Confirmar notificação do sistema, vibração conforme suporte e ausência de duplicidade com a página visível.
8. Repetir no iPhone apenas após instalar o PWA pela Tela de Início.
