COLOURS FLEX PRINTING - V12 SECURE PORTAL + SUPABASE

WHAT'S NEW
- Portal login screen using Supabase Auth email/password.
- Main billing app and Balance tab are hidden until sign-in.
- Sign Out button.
- Invoice records sync to Supabase public.invoices when configured.
- Existing browser invoices are merged into the signed-in account's cloud list.
- Balance tab and monthly/yearly transaction view retained.

SETUP REQUIRED BEFORE USE
1. Create a separate Supabase project for Colours Flex Printing (do NOT use the Immigrants Guide project).
2. In Supabase SQL Editor, run supabase-schema.sql.
3. In Supabase Authentication > Users, create the portal user (email + password). Disable public sign-ups if only an admin should create accounts.
4. In Supabase Project Settings > API, copy the Project URL and anon/publishable key.
5. Open supabase-config.js and replace both PASTE_ placeholders.
6. Upload all files to the ColoursFP/Colours GitHub repository and commit.
7. In Supabase Auth URL Configuration, add https://coloursfp.github.io/Colours/ as the Site URL and Redirect URL.
8. Sign in with the account created in Authentication > Users.

SECURITY
- Do not put the service_role/secret key in this repository.
- RLS is enabled; only authenticated users can access invoice rows.
- Any authenticated user created in this project currently has shared access to all invoices. Only create trusted users.
- Browser-local invoices are merged to cloud after sign-in. Review the data before using for production.
- Supabase URL/key are intentionally placeholders until you provide your project's values.
