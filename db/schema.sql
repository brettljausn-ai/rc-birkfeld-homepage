-- RC Birkfeld – PostgreSQL Schema

CREATE TABLE IF NOT EXISTS news (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  image_url    TEXT,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS termine (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  date        DATE NOT NULL,
  location    TEXT,
  description TEXT,
  detail_url  TEXT,
  tag         TEXT DEFAULT 'Vereinsrennen',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gallery (
  id          SERIAL PRIMARY KEY,
  filename    TEXT NOT NULL,
  caption     TEXT,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS members (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  interesse  TEXT,
  status     TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strava_cache (
  key        TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- express-session Tabelle
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    VARCHAR NOT NULL COLLATE "default",
  "sess"   JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- Seed: Termine
INSERT INTO termine (title, date, location, detail_url, tag)
VALUES ('Trainingsausfahrt Laurentiberg', '2026-08-22', 'Friesi''s Bikery, Edelseestraße 27, Birkfeld', '/laurenzibergrennen', 'Vereinsrennen')
ON CONFLICT DO NOTHING;

-- Seed: Galerie
INSERT INTO gallery (filename, caption, sort_order) VALUES
  ('foto-1.jpg', 'Trainingslager Porec',      1),
  ('foto-2.jpg', 'Königskogler Koglkönig',    2),
  ('foto-3.jpg', 'Startaufstellung Rennen',   3),
  ('foto-4.jpg', 'MTB-Trail Joglland',        4),
  ('foto-5.jpg', 'Laurentibergrennen 2022',   5),
  ('foto-6.jpg', 'Trainingslager Porec 2026', 6)
ON CONFLICT DO NOTHING;
