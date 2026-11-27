# ALENGO ESPETINHOS 1.5.8.2 — Redesign do atendimento e Web Push

## Atendimento web
- Reformulação do painel inicial com saudação, status de conexão, ações de Mesa/Retirada em cartões compactos e atalhos operacionais.
- Navegação inferior persistente para Início, Pedidos e Avisos.
- Redesign global de cartões, campos, mesas, listas, cabeçalho, central de notificações e espaçamentos.
- Layout responsivo para celulares pequenos, tablets, orientação paisagem e áreas seguras de iOS.
- Manifestos PWA permitem orientação retrato ou paisagem.

## Áudio de notificações
- Cinco amostras sonoras originais em WAV: pedido pronto, parcialmente pronto, novo pedido, chamado do responsável e aviso geral.
- Cada evento tem assinatura rítmica e timbre próprios, com prévia individual.
- Volume ajustável de 0 a 100%, vibração opcional e controles independentes para alertas prioritários e gerais.
- Sons em cache no service worker e carregados por AudioContext para controle de volume.

## Web Push
- Service workers recebem eventos Push e exibem notificações do sistema em segundo plano.
- Inscrição por aparelho mediante permissão explícita, registrada por comando autenticado e processada pelo Windows.
- O Windows gera chave VAPID e protege a chave privada com Electron safeStorage/DPAPI; somente a chave pública é publicada no snapshot.
- Assinaturas ficam no SQLite do Windows, vinculadas ao operador e aparelho. O envio usa os avisos persistidos para aquele operador.
- Inscrições inválidas/expiradas são removidas. Logout remove a inscrição do aparelho para evitar notificações do operador anterior em aparelhos compartilhados.
- Nova migration Supabase amplia os tipos permitidos na fila remota para registrar/remover inscrições Push.

## Limitações de plataforma
- Em iPhone/iPad, Web Push exige versão compatível do iOS/iPadOS e o site adicionado à Tela de Início; abrir pelo ícone antes de ativar.
- O som personalizado é reproduzido pelo site enquanto o navegador mantém a página ativa. Em segundo plano/tela bloqueada, o sistema operacional controla o som e a vibração da notificação Push; o site não pode impor um toque personalizado ao sistema.
- O volume do site não altera o volume físico do telefone nem contorna o modo silencioso, Não Perturbe ou restrições do sistema.

## Segurança e dados
- A chave privada VAPID não é incluída no frontend, Cloudflare Pages, snapshots ou ZIP público.
- Preferências de som continuam locais por operador/aparelho.
- Inscrições Push são preservadas na limpeza operacional; histórico técnico de entregas/cursor é reiniciado.
- Android nativo permanece sem alterações.
