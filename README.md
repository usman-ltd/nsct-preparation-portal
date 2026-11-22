# Riphah International University Sahiwal · NSCT Preparation Portal

## Run on this computer

Use Node.js 22 or later. Open a terminal in this folder and run:

```sh
npm ci
npm start
```

Open **http://localhost:8743**. Register a student with their full name, university or college, email and password. The local server saves the latest verification email in `.local/latest-email.txt`. Enter its six-digit code in the browser. Local development runs PostgreSQL through PGlite and keeps the database in `.local/pg` across restarts. Only the loopback interface serves this development app. The production function sends verification emails through Resend. Email verification is performed at registration. Persistent session cookies are valid for 90 days and renew during continued use. Logout revokes the session in the database.

To grant admin access locally, register and verify the account, stop the server, run `npm run local:admin -- YOUR-EMAIL-ADDRESS`, and restart. The Admin page lists verified students, the last time each used the portal, and their paper counts. Open a student's record to review papers, progress and submitted results. Administrators can also remove a question from future papers or restore it. Already-issued papers retain their original questions and grading.

## Prepare a production installation

The source includes a Netlify Functions adapter. Use the deployment project and address chosen by the site owner. The supplied public URL identifies the original Practice Studio.

1. Create a Neon PostgreSQL database. Run **db.sql**, followed by **server/practice.sql**, in the database SQL editor. Use a database role scoped to this application.
2. Verify a sending domain with Resend. Configure the following environment variables in the host's **Functions** scope. Use separate databases, keys and sender configuration for development, staging and production.

   | Variable | Value |
   | --- | --- |
   | DATABASE_URL | Neon PostgreSQL connection string with TLS |
   | RESEND_API_KEY | Restricted Resend sending key |
   | MAIL_FROM | Sender address on your verified domain |
   | AUTH_SECRET | A server-only, base64-encoded random secret of at least 32 bytes |

3. Deploy this folder as the project root using a Git-connected Netlify build or the Netlify CLI with build support. The included netlify.toml configures the public directory, function bundle, validation command and browser security headers. A drag-and-drop upload of the public folder alone cannot run the API.
4. Register and verify the first administrator normally. In the production database SQL editor, run [the admin grant script](scripts/grant-admin.sql) with the verified student's email address and check the returned account. Changing roles is an owner operation. Use a separate student account to check student access.
5. Open the production address over HTTPS and complete one registration, email verification, paper submission and logout. Check the sender, delivery and portal in the intended deployment context.

Never copy .local, .env files, service keys or database dumps into published assets. Back up the production PostgreSQL database using your provider's backup controls. The private question bank ships with the server function.

## Papers and reports

- Choose 20, 50 or 100 questions. The combined paper follows [HEC's published competency weights](https://nsct.hec.gov.pk/AreasOfCompetencies). Selected-subject papers rescale those weights and allocate remaining whole questions by largest remainder.
- Every paper has unique questions. Within each subject, questions issued least often to that student come first. This exhausts unused questions before reuse. A paper's question and option order is shuffled independently.
- Learning mode locks the first answer and reveals feedback. Exam mode permits revisions and reveals grading after submission. The server stores answers and grades completed papers. Reports include subject performance, printable review and CSV export.
- Each verified student starts with an empty account history. Only papers created in this portal appear in their dashboard and reports.
- There are 2,506 active questions. Among 7,518 distractors, 3,576 use the shared worked rationale. The remaining distractors have additional option-specific feedback or comparisons.
- data/import-report.json identifies source exclusions. The import keeps the original question source and separates original keys from explanatory material. A four-choice answer key is available to the client only after the relevant feedback becomes available in the account-based portal.

## Verification

Run `npm run check` and `npm test`. The database integration tests use isolated, in-memory PostgreSQL and a captured verification email. They do not require production credentials.

## Publishing updates

For OTP delivery to classmates without a sending domain, set `GMAIL_USER` to the sending Gmail address and `GMAIL_APP_PASSWORD` to its Google app password in Netlify's Production Functions environment. Enable 2-Step Verification on the Google account to create an app password. Redeploy after saving the variables. This configuration takes precedence over Resend. With both Gmail variables absent, the original Resend configuration continues to work. The Resend testing sender only delivers to the Resend account owner's email.

The production site at https://riphahsahiwalnsct.netlify.app builds from the main branch of https://github.com/usman-ltd/nsct-preparation-portal. Push a tested commit to main to deploy it. Keep service credentials in the existing Netlify project environment settings. The public repository includes the practice question bank and its answer keys.
