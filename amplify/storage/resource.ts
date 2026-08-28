import { defineStorage } from "@aws-amplify/backend";

/**
 * Media captured against a daily report entry.
 * Files are keyed location-media/{date}/{task-slug}/{file}, which is the same
 * date + task pairing the Location "Apply" button uses to find its record.
 */
export const storage = defineStorage({
  name: "dailyReportMedia",
  access: (allow) => ({
    "location-media/*": [
      allow.authenticated.to(["read", "write", "delete"]),
    ],
  }),
});
