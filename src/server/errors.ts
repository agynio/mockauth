export class DomainError extends Error {
  constructor(
    message: string,
    public readonly options: { status?: number; code?: string } = {},
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const toResponse = (error: unknown): Response => {
  if (error instanceof DomainError) {
    return Response.json(
      {
        error: error.options.code ?? "domain_error",
        error_description: error.message,
      },
      { status: error.options.status ?? 400 },
    );
  }

  console.error(error);
  return Response.json(
    {
      error: "server_error",
      error_description: "Unexpected error",
    },
    { status: 500 },
  );
};
