-- Product catalog, immutable versions, knowledge, and pgvector.
-- Forward-only. Does not alter earlier migrations.
-- Exact similarity search. No ANN index until measured volume requires one.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.products (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  product_type text NOT NULL,
  category text NOT NULL DEFAULT '',
  short_description text NOT NULL DEFAULT '',
  detailed_description text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ACTIVE',
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  target_markets text[] NOT NULL DEFAULT ARRAY[]::text[],
  languages text[] NOT NULL DEFAULT ARRAY[]::text[],
  currency char(3) NOT NULL DEFAULT 'USD',
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  archived_at timestamptz(6),
  CONSTRAINT products_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT products_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
  CONSTRAINT products_status_check CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT products_type_check CHECK (product_type IN ('SOFTWARE', 'PHYSICAL', 'PROFESSIONAL_SERVICE', 'SUBSCRIPTION', 'DIGITAL', 'CUSTOM', 'OTHER'))
);

CREATE INDEX products_tenant_status_updated_idx ON public.products (tenant_id, status, updated_at);

CREATE TABLE public.product_versions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  version_number integer NOT NULL,
  status text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  snapshot jsonb NOT NULL,
  published_at timestamptz(6),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT product_versions_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT product_versions_product_fk FOREIGN KEY (tenant_id, product_id) REFERENCES public.products (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT product_versions_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
  CONSTRAINT product_versions_number_unique UNIQUE (tenant_id, product_id, version_number),
  CONSTRAINT product_versions_status_check CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED'))
);

CREATE INDEX product_versions_lookup_idx ON public.product_versions (tenant_id, product_id, status);

CREATE TABLE public.knowledge_documents (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  version_id uuid,
  file_name text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  status text NOT NULL,
  failure_reason text,
  semantic_status text NOT NULL DEFAULT 'UNAVAILABLE',
  embedding_model text,
  page_count integer,
  replaces_document_id uuid,
  approved_by uuid,
  approved_at timestamptz(6),
  rejected_reason text,
  retain_until timestamptz(6),
  created_by uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  deleted_at timestamptz(6),
  CONSTRAINT knowledge_documents_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT knowledge_documents_product_fk FOREIGN KEY (tenant_id, product_id) REFERENCES public.products (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT knowledge_documents_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
  CONSTRAINT knowledge_documents_sha_unique UNIQUE (tenant_id, sha256),
  CONSTRAINT knowledge_documents_status_check CHECK (status IN ('UPLOAD', 'VALIDATING', 'PROCESSING', 'EXTRACTED', 'INDEXED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'FAILED', 'DELETED'))
);

CREATE INDEX knowledge_documents_lookup_idx ON public.knowledge_documents (tenant_id, product_id, status);

CREATE TABLE public.knowledge_chunks (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  product_id uuid NOT NULL,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  page integer,
  section text,
  CONSTRAINT knowledge_chunks_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT knowledge_chunks_document_fk FOREIGN KEY (tenant_id, document_id) REFERENCES public.knowledge_documents (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT knowledge_chunks_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
  CONSTRAINT knowledge_chunks_position_unique UNIQUE (tenant_id, document_id, chunk_index)
);

CREATE INDEX knowledge_chunks_product_idx ON public.knowledge_chunks (tenant_id, product_id);

CREATE TABLE public.knowledge_embeddings (
  tenant_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  model text NOT NULL,
  dimensions integer NOT NULL,
  embedding vector(384) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_embeddings_pkey PRIMARY KEY (tenant_id, chunk_id),
  CONSTRAINT knowledge_embeddings_chunk_fk FOREIGN KEY (tenant_id, chunk_id) REFERENCES public.knowledge_chunks (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT knowledge_embeddings_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
  CONSTRAINT knowledge_embeddings_dimensions_check CHECK (dimensions = 384)
);

CREATE TABLE public.embedding_indexes (
  tenant_id uuid NOT NULL,
  model text NOT NULL,
  dimensions integer NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT embedding_indexes_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT embedding_indexes_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
  CONSTRAINT embedding_indexes_dimensions_check CHECK (dimensions = 384),
  CONSTRAINT embedding_indexes_status_check CHECK (status IN ('ACTIVE'))
);

CREATE TABLE public.organization_product_defaults (
  tenant_id uuid NOT NULL,
  positioning jsonb NOT NULL DEFAULT '{}'::jsonb,
  pricing jsonb NOT NULL DEFAULT '{}'::jsonb,
  knowledge_retention_days integer NOT NULL DEFAULT 0,
  updated_by uuid NOT NULL,
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT organization_product_defaults_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT organization_product_defaults_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
  CONSTRAINT organization_product_defaults_retention_check CHECK (knowledge_retention_days BETWEEN 0 AND 3650)
);

CREATE OR REPLACE FUNCTION public.guard_product_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $body$
BEGIN
  IF OLD.snapshot IS DISTINCT FROM NEW.snapshot THEN
    IF OLD.status = 'DRAFT' AND NEW.status = 'DRAFT' THEN
      NULL;
    ELSIF OLD.status = 'APPROVED'
      AND NEW.status = 'PUBLISHED'
      AND (OLD.snapshot - 'knowledgeDocumentIds') = (NEW.snapshot - 'knowledgeDocumentIds') THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'only draft product versions can change';
    END IF;
  END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.product_id IS DISTINCT FROM NEW.product_id
     OR OLD.version_number IS DISTINCT FROM NEW.version_number THEN
    RAISE EXCEPTION 'product version identity is immutable';
  END IF;
  IF OLD.status = 'PUBLISHED' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'SUPERSEDED' THEN
    RAISE EXCEPTION 'published version can only be superseded';
  END IF;
  IF OLD.status IN ('SUPERSEDED', 'ARCHIVED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'closed product version cannot change status';
  END IF;
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS product_versions_guard ON public.product_versions;
CREATE TRIGGER product_versions_guard
  BEFORE UPDATE ON public.product_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_product_version();

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.products,
  public.product_versions,
  public.knowledge_documents,
  public.knowledge_chunks,
  public.knowledge_embeddings,
  public.embedding_indexes,
  public.organization_product_defaults
TO salesos_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.products,
  public.product_versions,
  public.knowledge_documents,
  public.knowledge_chunks,
  public.knowledge_embeddings,
  public.embedding_indexes,
  public.organization_product_defaults
TO salesos_worker;

REVOKE ALL ON TABLE
  public.products,
  public.product_versions,
  public.knowledge_documents,
  public.knowledge_chunks,
  public.knowledge_embeddings,
  public.embedding_indexes,
  public.organization_product_defaults
FROM salesos_identity;

GRANT SELECT (tenant_id, id, status, retain_until, byte_size)
  ON TABLE public.knowledge_documents
  TO salesos_outbox;

DO $body$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'products',
    'product_versions',
    'knowledge_documents',
    'knowledge_chunks',
    'knowledge_embeddings',
    'embedding_indexes',
    'organization_product_defaults'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name
    );
  END LOOP;
END
$body$;

CREATE FUNCTION public.list_due_knowledge_deletions(batch_size integer)
RETURNS TABLE (
  tenant_id uuid,
  id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  SELECT document.tenant_id, document.id
  FROM public.knowledge_documents AS document
  WHERE document.status = 'DELETED'
    AND document.retain_until IS NOT NULL
    AND document.retain_until <= now()
    AND document.byte_size > 0
  ORDER BY document.retain_until
  LIMIT LEAST(GREATEST(batch_size, 0), 100);
$body$;

ALTER FUNCTION public.list_due_knowledge_deletions(integer) OWNER TO salesos_outbox;
REVOKE ALL ON FUNCTION public.list_due_knowledge_deletions(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_due_knowledge_deletions(integer) FROM salesos_app;
GRANT EXECUTE ON FUNCTION public.list_due_knowledge_deletions(integer) TO salesos_worker;
