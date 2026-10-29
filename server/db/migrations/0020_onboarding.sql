-- Households from before onboarding are set up already (NULL = done); new ones start at the first step (setup.ts)
ALTER TABLE "sites" ADD COLUMN "onboarding" text;
