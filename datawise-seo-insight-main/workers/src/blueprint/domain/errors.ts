export interface FieldError {
  path: string;
  message: string;
}

export class BlueprintValidationError extends Error {
  constructor(
    public code: 'invalid_input' | 'invalid_domain' | 'invalid_url' | 'invalid_website_url',
    public fieldErrors: FieldError[] = []
  ) {
    super(fieldErrors[0]?.message ?? code);
    this.name = 'BlueprintValidationError';
  }
}
