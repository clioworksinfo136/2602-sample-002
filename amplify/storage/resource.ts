import { defineStorage } from "@aws-amplify/backend";

/**
 * Media captured against a daily report entry.
 * Files are keyed location-media/{date}/{uuid}-{file}. The key itself carries
 * no ownership: the Location record stores its own keys in its `media` field,
 * so attachments survive renaming a task.
 */
export const storage = defineStorage({
  name: "dailyReportMedia",
  access: (allow) => ({
    "location-media/*": [
      allow.authenticated.to(["read", "write", "delete"]),
    ],
  }),
});
