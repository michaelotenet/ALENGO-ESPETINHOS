# ALENGO ESPETINHOS 1.5.8.1 — Preferências de som das notificações

## Atendimento web
- Preferências individuais de notificações salvas localmente por operador e aparelho.
- Quatro toques genéricos: Clássico, Campainha, Duplo e Alerta.
- Controle de volume de 0 a 100%, com prévia de áudio.
- Opções independentes para som de pedido pronto e demais avisos.
- Opção de vibração quando suportada pelo navegador e aparelho.
- Atualização da cópia mobile-web e incremento do cache PWA para evitar uso de arquivos antigos.

## Limitações conhecidas
- O volume do site controla o áudio gerado pela página; o volume geral do aparelho e o modo silencioso continuam sob controle do sistema.
- Navegadores podem suspender áudio e JavaScript em segundo plano ou com a tela bloqueada.
- Notificações do sistema podem continuar visíveis, mas não permitem escolher um arquivo de som personalizado pelo site.
- Recomenda-se que o operador abra a Central de notificações, toque em “Ativar avisos” e teste o toque antes de iniciar o atendimento.

## Verificação
- Testes automatizados do projeto: 66 aprovados.
- Sintaxe JavaScript validada com `node --check`.
- Ainda requer validação prática em Android/iPhone e publicação no Cloudflare Pages.
