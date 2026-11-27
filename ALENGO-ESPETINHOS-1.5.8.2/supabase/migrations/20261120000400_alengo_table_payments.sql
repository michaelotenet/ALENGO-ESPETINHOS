-- ALENGO ESPETINHOS 1.5.5 — recebimentos remotos autorizados pelo Windows.
-- O Windows processa automaticamente as solicitações PAY_TABLE; não há confirmação manual por pagamento.
-- Caixa aberto, permissão individual, autenticação e idempotência continuam obrigatórios.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.remote_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%request_type%'
  loop
    execute format('alter table public.remote_requests drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.remote_requests
  add constraint remote_requests_request_type_check
  check (request_type in ('CREATE_ORDER','ITEM_DELIVERY','CANCEL_ORDER','ACK_NOTIFICATION','PAY_TABLE'));

comment on constraint remote_requests_request_type_check on public.remote_requests is
  'Comandos autenticados dos atendentes: pedidos, preparo, cancelamento, notificações e recebimento autorizado de contas.';
