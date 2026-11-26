/** Only messages deliberately written for the caller belong in HTTP responses. */
export class PublicRequestError extends Error {
  constructor(message: string, readonly status = 400, options?: ErrorOptions) {
    super(message, options)
  }
}
