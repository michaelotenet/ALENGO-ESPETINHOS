-- ALENGO ESPETINHOS 1.5.4 — permite confirmação de leitura de notificações
-- por meio da fila autenticada já existente. Nenhuma chave secreta é publicada.
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
  check (request_type in ('CREATE_ORDER','ITEM_DELIVERY','CANCEL_ORDER','ACK_NOTIFICATION'));

comment on constraint remote_requests_request_type_check on public.remote_requests is
  'Comandos autenticados dos atendentes: pedidos, atualização de itens, cancelamento e leitura de notificações.';
