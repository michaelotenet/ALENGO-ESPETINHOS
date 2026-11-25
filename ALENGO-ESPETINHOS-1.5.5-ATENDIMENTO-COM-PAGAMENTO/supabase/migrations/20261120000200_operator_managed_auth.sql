-- ALENGO ESPETINHOS 1.5.1
-- Remove os vínculos do fluxo antigo por e-mail/UUID.
-- O Windows criará novos vínculos, exclusivamente para operadores habilitados em Configurações > Operadores.
-- A remoção também libera a restrição UNIQUE(operator_id) para o novo usuário gerenciado.
delete from public.remote_operator_links;
delete from public.remote_state;
