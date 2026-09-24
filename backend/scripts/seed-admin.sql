-- Bootstraps an Admin user so they can sign in and approve everyone else via
-- the (not-yet-built) access-request UI. Needed because Kosha has no
-- user-creation path until that UI exists — every fresh DB needs one.
INSERT INTO users (email, role, status)
VALUES ('nitish.anyarambhatla@divami.com', 'admin', 'active')
ON CONFLICT (email) DO UPDATE SET role = 'admin', status = 'active';
