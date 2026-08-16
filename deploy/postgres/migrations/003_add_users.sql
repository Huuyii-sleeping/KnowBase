DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kh_user_role_enum') THEN
    CREATE TYPE kh_user_role_enum AS ENUM ('ADMIN', 'MEMBER');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kh_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(128) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role kh_user_role_enum NOT NULL DEFAULT 'MEMBER',
  team VARCHAR(128),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO kh_user (username, display_name, email, password_hash, role)
VALUES (
  'admin', 'KnowBase Admin', 'admin@knowbase.local',
  '$2b$10$lf0QzUcRA5fPq0rHmhqSQexG6pIOTzet/QBEBcR43Nv4K4lRxUc7.',
  'ADMIN'
)
ON CONFLICT (username) DO NOTHING;
