ALTER TABLE "push_subscriptions" ALTER COLUMN "topics" SET DEFAULT '["plan","prices","errors","daily","doorbell"]'::jsonb;--> statement-breakpoint
-- Someone at the door is worth a notification by default: devices that already had notifications on get it too (only experimental households ever receive it)
UPDATE "push_subscriptions" SET "topics" = "topics" || '["doorbell"]'::jsonb WHERE NOT ("topics" ? 'doorbell');
