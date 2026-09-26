-- Carries a validated OAuth authorization request across the STEMLearn
-- login/linking detour (Microsoft/SU login can take longer than the OAuth
-- library's own short-lived consent handle is designed for). Nullable and
-- additive: existing legacy (bearer-started) linking sessions never set it.
ALTER TABLE linking_sessions ADD COLUMN oauth_request_json TEXT;
