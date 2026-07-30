-- RC Birkfeld – MySQL Schema

CREATE TABLE IF NOT EXISTS news (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  image_url    TEXT,
  published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS termine (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  title       TEXT NOT NULL,
  date        DATE NOT NULL,
  location    TEXT,
  description TEXT,
  detail_url  TEXT,
  tag         VARCHAR(100) DEFAULT 'Vereinsrennen',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gallery (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  filename    TEXT NOT NULL,
  caption     TEXT,
  sort_order  INT DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS members (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  interesse  VARCHAR(50),
  status     VARCHAR(50) DEFAULT 'new',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS strava_cache (
  `key`      VARCHAR(100) PRIMARY KEY,
  data       JSON NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sponsors (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  logo        LONGTEXT NOT NULL,
  website_url TEXT,
  sort_order  INT DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE sponsors MODIFY COLUMN logo LONGTEXT NOT NULL;
DELETE FROM sponsors WHERE logo NOT LIKE 'data:%';

CREATE TABLE IF NOT EXISTS club_posts (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  author     VARCHAR(100) NOT NULL,
  content    TEXT NOT NULL,
  image_url  TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS image_url TEXT NULL;

CREATE TABLE IF NOT EXISTS club_chat (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  author     VARCHAR(100) NOT NULL,
  content    TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_rsvp (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  termine_id  INT NOT NULL,
  member_name VARCHAR(100) NOT NULL,
  status      ENUM('yes','no') NOT NULL,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rsvp (termine_id, member_name)
);

CREATE TABLE IF NOT EXISTS site_content (
  `key`      VARCHAR(100) PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO site_content (`key`, value) VALUES
  ('hero_eyebrow',     'Joglland · Oststeiermark · seit 1993'),
  ('hero_title_line1', 'Der Anstieg'),
  ('hero_title_line2', 'gehört uns.'),
  ('hero_lead',        'Rennrad, MTB und Gravel zwischen Birkfeld und dem Joglland – für Kinder, die ihr erstes Rennen fahren, für Familien am Samstagnachmittag und für alle, die den Ötztaler im Kalender stehen haben.'),
  ('stats_1_num',      '50+'),
  ('stats_1_lbl',      'Aktive Mitglieder'),
  ('stats_2_num',      '3'),
  ('stats_2_lbl',      'Disziplinen im Programm'),
  ('stats_3_num',      '1×'),
  ('stats_3_lbl',      'Ausfahrt pro Woche, fix'),
  ('stats_4_num',      'U13'),
  ('stats_4_lbl',      'Jüngste Jugendklasse'),
  ('verein_text',      'Der RC ASVÖ Birkfeld ist Treffpunkt für Hobbyfahrer:innen und Rennsportler:innen aus dem Joglland. Wir betreuen ein Jugendteam von U13 bis Junioren, fahren jeden Samstag gemeinsam aus und stehen bei den großen Marathons und Meisterschaften Österreichs am Start – ohne dass man dafür Rennfahrer:in sein muss, um dazuzugehören.'),
  ('result_1_rank',    '01'),
  ('result_1_title',   'Trainingsausfahrt Laurentiberg'),
  ('result_1_desc',    '28 Teilnehmer:innen, Gäste aus befreundeten Radclubs. Schnellster: Niklas Podhraski.'),
  ('result_1_meta',    '2025 · Bergwertung'),
  ('result_2_rank',    '02'),
  ('result_2_title',   'Königskogel Kogelkönig'),
  ('result_2_desc',    'Bestes RC-Mitglied: Obmann Johannes Wildt, Sieg in der Klasse Ü50.'),
  ('result_2_meta',    '2023 · Bergzeitfahren'),
  ('result_3_rank',    '03'),
  ('result_3_title',   'Laurentibergrennen'),
  ('result_3_desc',    'Christoph Spreitzhofer als bestes RC-Mitglied, Platz 2 in 23:33 Min.'),
  ('result_3_meta',    '2022 · Vereinsrennen');

-- Seed: Termine
DELETE FROM termine WHERE id NOT IN (
  SELECT min_id FROM (SELECT MIN(id) AS min_id FROM termine GROUP BY title, date) AS dedup
);

INSERT INTO termine (id, title, date, location, detail_url, tag)
VALUES (1, 'Trainingsausfahrt Laurentiberg', '2026-08-22', 'Friesis Bikery, Edelseestraße 27, Birkfeld', '/laurenzibergrennen', 'Vereinsrennen')
ON DUPLICATE KEY UPDATE title=VALUES(title), date=VALUES(date), location=VALUES(location), detail_url=VALUES(detail_url), tag=VALUES(tag);

-- Seed: Galerie (nur Bilder die als Dateien existieren)
INSERT IGNORE INTO gallery (id, filename, caption, sort_order) VALUES
  (1, 'foto-1.jpg', 'Trainingslager Porec',    1),
  (2, 'foto-2.jpg', 'Königskogler Koglkönig',  2),
  (3, 'foto-3.jpg', 'Startaufstellung Rennen', 3),
  (4, 'foto-4.jpg', 'MTB-Trail Joglland',      4);

DELETE FROM gallery WHERE filename IN ('foto-5.jpg', 'foto-6.jpg');

ALTER TABLE club_posts MODIFY COLUMN image_url MEDIUMTEXT NULL;
ALTER TABLE news MODIFY COLUMN image_url MEDIUMTEXT NULL;

CREATE TABLE IF NOT EXISTS club_oauth (
  id INT AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(20) NOT NULL,
  provider_id VARCHAR(200) NOT NULL,
  member_name VARCHAR(100) NOT NULL,
  email VARCHAR(200) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_provider (provider, provider_id)
);

CREATE TABLE IF NOT EXISTS club_members_auth (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(200) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email (email)
);
