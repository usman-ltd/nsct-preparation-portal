-- Replace the email below with the verified student's registered email.
UPDATE public.users
SET admin = true
WHERE email = lower(trim('student@example.com'))
RETURNING name, email, admin;
