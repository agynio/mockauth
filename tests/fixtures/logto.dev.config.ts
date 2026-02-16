/**
 * Logto dev configuration shared for local development and automated tests only.
 * Do not use these credentials in production or public deployments.
 */
export const logtoDevConfig = {
  endpoint: "https://hdjvaa.logto.app/",
  appId: "ra0mjq1bmt7u5wfcg298l",
  appSecret: "o4lvhz8xT5W6nKgAFOBNTqjArJYPcWYx",
  baseUrl: "http://localhost:3000",
  cookieSecret: "iTXDCvFnrE9tXc9j8w0SIgqR66lZMFz6",
  cookieSecure: process.env.NODE_ENV === "production",
};

export type LogtoDevConfig = typeof logtoDevConfig;
