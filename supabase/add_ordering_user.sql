-- Adds the agent's Admin ORDERING login to a live mock database without re-running schema.sql (which wipes test data).
-- Safe to run more than once. Same rows as in schema.sql.
-- Test account of the mock, not a real credential: phone 251900000098, password mock-admin-ordering-test (stored as sha256).
-- An ordinary app user (not back office), MEMBER of every company, with Simenesh's delivery locations, so the shopper
-- calls (cart, bill, checkout, order history) work with this login's own token from POST /admin-api/v1/users/login.

insert into adm_users (id, name, phone, is_system) values
  (md5('adm-user-ordering')::uuid, 'Zeami ordering (test)', '251900000098', false)
  on conflict do nothing;

insert into adm_b2b_customer_users (b2b_customer_id, user_id, role) values
  (md5('adm-co-abay')::uuid,   md5('adm-user-ordering')::uuid, 'MEMBER'),
  (md5('adm-co-entoto')::uuid, md5('adm-user-ordering')::uuid, 'MEMBER'),
  (md5('adm-co-sheger')::uuid, md5('adm-user-ordering')::uuid, 'MEMBER'),
  (md5('adm-co-bole')::uuid,   md5('adm-user-ordering')::uuid, 'MEMBER')
  on conflict do nothing;

insert into adm_locations (id, user_id, name, location_title, contact_phone) values
  (md5('adm-loc-ordering-abay')::uuid,        md5('adm-user-ordering')::uuid, 'Abay Bar & Restaurant, Kazanchis',         'Abay',        '251900000101'),
  (md5('adm-loc-ordering-entoto')::uuid,      md5('adm-user-ordering')::uuid, 'Entoto View Hotel, Africa Avenue',         'Entoto',      '251900000102'),
  (md5('adm-loc-ordering-entoto-back')::uuid, md5('adm-user-ordering')::uuid, 'Entoto View Hotel, kitchen back door',     'Entoto back', '251900000102'),
  (md5('adm-loc-ordering-sheger')::uuid,      md5('adm-user-ordering')::uuid, 'Sheger Pharma PLC, Akaki factory canteen', 'Sheger',      '251900000103'),
  (md5('adm-loc-ordering-bole')::uuid,        md5('adm-user-ordering')::uuid, 'Bole Burger House, Bole Medhanialem',      'Bole Burger', '251900000104')
  on conflict do nothing;

insert into mock_accounts (system, login, password_sha256, user_id) values
  ('admin', '251900000098', '9b9f1eff0a6300cfde705896866ab52a2ac2ad8a269c5e954a8605a6e1da9181', md5('adm-user-ordering')::uuid)
  on conflict do nothing;
