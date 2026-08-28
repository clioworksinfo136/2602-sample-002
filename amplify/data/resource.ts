import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/*== STEP 1 ===============================================================
The section below creates a Todo database table with a "content" field. Try
adding a new "isDone" field as a boolean. The authorization rule below
specifies that any user authenticated via an API key can "create", "read",
"update", and "delete" any "Todo" records.
=========================================================================*/
const schema = a.schema({
  // One attachment on a Location: its S3 key plus an optional note.
  PhotoItem: a.customType({
    key: a.string().required(),
    note: a.string(),
  }),
  Project: a
    .model({
      name: a.string().required(),
      number: a.string(),
    })
    .authorization((allow) => [allow.publicApiKey()]),
  Location: a
    .model({
      date: a.date().required(),
      task: a.string(),
      description: a.string(),
      phase: a.string().required(),
      // Legacy: bare S3 keys. Superseded by `photos`, still read as a
      // fallback so entries attached before notes existed keep working.
      media: a.string().array(),
      // Attachments with their notes.
      photos: a.ref("PhotoItem").array(),
    })
    .authorization((allow) => [allow.authenticated()]),
  Date: a
    .model({
      date: a.date(),
      weather: a.string(),
      hight: a.float(),
      lowt: a.float(),
      supervisor: a.string(),
      inspector: a.string(),
      labor: a.integer(),
      observation: a.string(),
      equipment: a.string(),
    })
    .authorization((allow) => [allow.authenticated()]),

  Task: a
    .model({
      taskid: a.string(),
      task: a.string(),
    })
    .authorization((allow) => [allow.authenticated()]),

  Equipment: a
    .model({
      primeSub: a.string(),
      model: a.string(),
      equipment: a.string(),
    })
    .authorization((allow) => [allow.authenticated()]),  
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "apiKey",
    // API Key is used for a.allow.public() rules
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
  },
});

/*== STEP 2 ===============================================================
Go to your frontend source code. From your client-side code, generate a
Data client to make CRUDL requests to your table. (THIS SNIPPET WILL ONLY
WORK IN THE FRONTEND CODE FILE.)

Using JavaScript or Next.js React Server Components, Middleware, Server 
Actions or Pages Router? Review how to generate Data clients for those use
cases: https://docs.amplify.aws/gen2/build-a-backend/data/connect-to-API/
=========================================================================*/

/*
"use client"
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

const client = generateClient<Schema>() // use this Data client for CRUDL requests
*/

/*== STEP 3 ===============================================================
Fetch records from the database and use them in your frontend component.
(THIS SNIPPET WILL ONLY WORK IN THE FRONTEND CODE FILE.)
=========================================================================*/

/* For example, in a React component, you can use this snippet in your
  function's RETURN statement */
// const { data: todos } = await client.models.Todo.list()

// return <ul>{todos.map(todo => <li key={todo.id}>{todo.content}</li>)}</ul>
