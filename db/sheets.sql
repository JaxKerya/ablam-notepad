-- ============================================================
-- Ablam Sheets — Animasyon İş Takip Sistemi
-- Supabase SQL Editor'da bu dosyanın tamamını çalıştırın.
-- ============================================================

-- updated_at trigger fonksiyonu (notes tablosundan zaten varsa atlanır)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- Projeler
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sheet_projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  naming_pattern  TEXT DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

DROP TRIGGER IF EXISTS set_sheet_projects_updated_at ON sheet_projects;
CREATE TRIGGER set_sheet_projects_updated_at
  BEFORE UPDATE ON sheet_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- Durumlar (proje bazında özelleştirilebilir)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sheet_statuses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES sheet_projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#6fa8dc',
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sheet_statuses_project ON sheet_statuses(project_id);

-- ------------------------------------------------------------
-- Pipeline kolonları (LYT, PB, R, CMP, CLR ... — checkbox kolonları)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sheet_pipeline_columns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES sheet_projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sheet_pipeline_project ON sheet_pipeline_columns(project_id);

-- ------------------------------------------------------------
-- Animatörler (kadro)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sheet_animators (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES sheet_projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#d4e4a5',
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sheet_animators_project ON sheet_animators(project_id);

-- ------------------------------------------------------------
-- Shot'lar (planlar) — her satır bir shot
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sheet_shots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES sheet_projects(id) ON DELETE CASCADE,
  animator_id    UUID REFERENCES sheet_animators(id) ON DELETE SET NULL,
  status_id      UUID REFERENCES sheet_statuses(id) ON DELETE SET NULL,
  shot_code      TEXT DEFAULT '',
  frame_count    INT DEFAULT 0,
  notes          TEXT DEFAULT '',
  revision_note  TEXT DEFAULT '',
  pipeline       JSONB DEFAULT '{}'::jsonb,
  position       INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sheet_shots_project ON sheet_shots(project_id);

DROP TRIGGER IF EXISTS set_sheet_shots_updated_at ON sheet_shots;
CREATE TRIGGER set_sheet_shots_updated_at
  BEFORE UPDATE ON sheet_shots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- Row Level Security — herkese açık okuma/yazma (site geçidi arkasında)
-- ------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sheet_projects', 'sheet_statuses', 'sheet_pipeline_columns',
    'sheet_animators', 'sheet_shots'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I REPLICA IDENTITY FULL;', t);

    EXECUTE format('DROP POLICY IF EXISTS "public_select" ON %I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "public_insert" ON %I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "public_update" ON %I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "public_delete" ON %I;', t);

    EXECUTE format('CREATE POLICY "public_select" ON %I FOR SELECT USING (true);', t);
    EXECUTE format('CREATE POLICY "public_insert" ON %I FOR INSERT WITH CHECK (true);', t);
    EXECUTE format('CREATE POLICY "public_update" ON %I FOR UPDATE USING (true);', t);
    EXECUTE format('CREATE POLICY "public_delete" ON %I FOR DELETE USING (true);', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- Realtime yayını (canlı senkron için)
-- ------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sheet_shots;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sheet_animators;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sheet_statuses;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sheet_pipeline_columns;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
