-- Ajustes no banco JA EXISTENTE (rodar uma vez no SQL Editor)
-- 1) vendas: coluna do celular do comprador (para marcar PAGO/PENDENTE por usuario)
ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS celular_cli VARCHAR(20);

-- 2) admins: flag de admin principal
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS principal BOOLEAN NOT NULL DEFAULT false;