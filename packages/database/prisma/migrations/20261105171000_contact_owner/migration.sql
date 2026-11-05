-- Contacts did not have an owner column. Assignment history already lives in
-- crm_assignments. This adds the current owner on the contact row.
-- Recovery: ALTER TABLE public.crm_contacts DROP COLUMN owner_user_id;

ALTER TABLE public.crm_contacts
  ADD COLUMN owner_user_id uuid;
