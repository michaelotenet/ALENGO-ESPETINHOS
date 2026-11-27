-- ALENGO ESPETINHOS 1.5.8.2 — registro e remoção de inscrições Web Push.
-- As inscrições ficam no SQLite do Windows; a fila remota autentica o operador.
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid='public.remote_requests'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%request_type%'
  loop execute format('alter table public.remote_requests drop constraint %I',c.conname); end loop;
end $$;
alter table public.remote_requests add constraint remote_requests_request_type_check
  check (request_type in ('CREATE_ORDER','ITEM_DELIVERY','CANCEL_ORDER','ACK_NOTIFICATION','CALL_RESPONSIBLE','LIST_ORDERS_BY_DAY','PAY_TABLE','REGISTER_PUSH','UNREGISTER_PUSH'));
comment on constraint remote_requests_request_type_check on public.remote_requests is 'Inclui registro e remoção de inscrições Web Push autenticadas por operador.';
