import { mergeRouters } from "./trpc.js";
import { companiesRouter } from "./routers/companies.js";
import { contactsRouter } from "./routers/contacts.js";
import { invoicesRouter } from "./routers/invoices.js";
import { settingsRouter } from "./routers/settings.js";
import { filesAndLogsRouter } from "./routers/filesAndLogs.js";
import { authRouter } from "./routers/auth.js";
import { louisAiRouter } from "./routers/louisAi.js";
import { mailDraftsRouter } from "./routers/mailDrafts.js";

export const appRouter = mergeRouters(
  companiesRouter,
  contactsRouter,
  invoicesRouter,
  settingsRouter,
  filesAndLogsRouter,
  authRouter,
  louisAiRouter,
  mailDraftsRouter
);

export type AppRouter = typeof appRouter;
