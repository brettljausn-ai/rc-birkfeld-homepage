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

-- Seed: Termine
INSERT IGNORE INTO termine (title, date, location, detail_url, tag)
VALUES ('Trainingsausfahrt Laurentiberg', '2026-08-22', 'Friesis Bikery, Edelseestraße 27, Birkfeld', '/laurenzibergrennen', 'Vereinsrennen');

-- Seed: Galerie
INSERT IGNORE INTO gallery (id, filename, caption, sort_order) VALUES
  (1, 'foto-1.jpg', 'Trainingslager Porec',      1),
  (2, 'foto-2.jpg', 'Königskogler Koglkönig',    2),
  (3, 'foto-3.jpg', 'Startaufstellung Rennen',   3),
  (4, 'foto-4.jpg', 'MTB-Trail Joglland',        4),
  (5, 'foto-5.jpg', 'Laurentibergrennen 2022',   5),
  (6, 'foto-6.jpg', 'Trainingslager Porec 2026', 6);
